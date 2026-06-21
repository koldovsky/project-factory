// REFERENCE IMPLEMENTATION (proven in the Ordering & Fulfillment Platform).
// Capability DEMO recorder: one Playwright-recorded clip per capability plus
// a security-negative clip, each with a title card, a real UI walkthrough, a
// full-page screenshot, and a manifest.json + README index under
// docs/qa/demo-recordings/.
//
// To adapt: replace the demoUsers/dataIds seed with the new project's
// domains, rewrite makeClips() scenes from docs/qa/demo-script.md, keep the
// infrastructure (server check, lock file, timeouts, manifest writing).
// Wire as: "qa:record-demos": "tsx scripts/record-demos.ts".
// Run against an already-running dev server.
import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { chromium, type Browser, type Page } from "playwright";
import { hashPassword } from "@/lib/auth/password";
import { Role } from "@/lib/auth/roles";
import {
  account,
  customer,
  customerTier,
  item,
  itemCategory,
  itemDiscount,
  receivingMethod,
  tierItemDiscount,
  user,
} from "@/db/schema";

config({ path: [".env.local", ".env"] });

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const START_SERVER = process.env.DEMO_START_SERVER === "true";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoPass1!";
const OUT_DIR = path.resolve("docs/qa/demo-recordings");
const VIDEO_DIR = path.join(OUT_DIR, "raw");
const LOCK_FILE = path.resolve(".demo-recorder.lock");
const CLIP_TIMEOUT_MS = Number(process.env.DEMO_CLIP_TIMEOUT_MS ?? 90_000);
const childProcesses = new Set<ChildProcess>();

const demoUsers = {
  admin: {
    id: "demo-admin-user",
    accountId: "demo-admin-account",
    email: "demo.admin@example.com",
    name: "Demo Admin",
    role: Role.Admin,
    isActive: true,
    customerId: null,
  },
  manager: {
    id: "demo-manager-user",
    accountId: "demo-manager-account",
    email: "demo.manager@example.com",
    name: "Demo Orders Manager",
    role: Role.OrdersManager,
    isActive: true,
    customerId: null,
  },
  customer: {
    id: "demo-customer-user",
    accountId: "demo-customer-account",
    email: "demo.customer@example.com",
    name: "Demo Portal Customer",
    role: Role.Customer,
    isActive: true,
    customerId: "demo-customer",
  },
  disabled: {
    id: "demo-disabled-user",
    accountId: "demo-disabled-account",
    email: "demo.disabled@example.com",
    name: "Demo Disabled User",
    role: Role.OrdersManager,
    isActive: false,
    customerId: null,
  },
} as const;

const dataIds = {
  tier: "demo-tier",
  receivingMethod: "demo-receiving-method",
  customer: "demo-customer",
  category: "demo-category",
  itemApple: "demo-item-apple",
  itemPear: "demo-item-pear",
  discount: "demo-discount",
  tierDiscount: "demo-tier-discount",
};

type DemoSeed = {
  internalOrderId: string;
  portalOrderId: string;
  invoiceId: string;
  transferId: string | null;
};

type Clip = {
  id: string;
  title: string;
  proof: string;
  actor?: keyof typeof demoUsers;
  /** Viewport for the WHOLE clip (default 1280x720). Playwright's
   * recordVideo frame size is fixed per context: resizing the viewport
   * mid-recording produces stretched/distorted frames that look like a
   * broken responsive layout in the video. Responsive scenarios therefore
   * get ONE CLIP PER VIEWPORT (e.g. a separate 360px clip) — never a
   * setViewportSize inside a clip; recordClip enforces this with a hard
   * guard. (Calibration-run finding R20.) */
  viewport?: { width: number; height: number };
  run: (page: Page, seed: DemoSeed) => Promise<void>;
};

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

async function main() {
  await acquireLock();
  await mkdir(VIDEO_DIR, { recursive: true });
  let browser: Browser | null = null;
  let server: ChildProcess | null = null;

  try {
    server = await ensureServer();
    const seed = await seedDemoData();
    browser = await chromium.launch({ headless: true });
    const clips = makeClips();
    const results = [];

    for (const clip of clips) {
      console.log(`Recording ${clip.id}: ${clip.title}`);
      results.push(
        await withTimeout(
          recordClip(browser, clip, seed),
          CLIP_TIMEOUT_MS,
          `Timed out recording ${clip.id}`,
        ),
      );
    }

    await writeManifest(results);
    console.log(`Demo recordings written to ${OUT_DIR}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    if (server) {
      killProcess(server);
    }
    await releaseLock();
  }
}

async function seedDemoData(): Promise<DemoSeed> {
  console.log("Seeding deterministic demo data...");
  const { db } = await import("@/db");
  const { createOrder, addOrderNote, transitionOrderStatus } = await import(
    "@/lib/orders/service"
  );
  const { OrderStatus } = await import("@/lib/orders/status");
  const { generateInvoice } = await import("@/lib/invoices/service");
  const { InvoiceCategory, InvoiceType } = await import("@/lib/invoices/types");
  const { generateQuickBooksTransfer } = await import("@/lib/quickbooks/service");

  const passwordHash = await hashPassword(PASSWORD);

  await db
    .insert(customerTier)
    .values({
      id: dataIds.tier,
      name: "Demo Tier",
      description: "Tier used for QA demo recordings",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: customerTier.id,
      set: { name: "Demo Tier", description: "Tier used for QA demo recordings", isActive: true },
    });

  await db
    .insert(receivingMethod)
    .values({
      id: dataIds.receivingMethod,
      name: "Demo Receiving Method",
      description: "QA demo receiving method",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: receivingMethod.id,
      set: { name: "Demo Receiving Method", description: "QA demo receiving method", isActive: true },
    });

  await db
    .insert(customer)
    .values({
      id: dataIds.customer,
      name: "Demo Customer",
      address: "123 Demo Market St",
      notes: "QA demo customer",
      tierId: dataIds.tier,
      receivingMethodId: dataIds.receivingMethod,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: customer.id,
      set: {
        name: "Demo Customer",
        address: "123 Demo Market St",
        notes: "QA demo customer",
        tierId: dataIds.tier,
        receivingMethodId: dataIds.receivingMethod,
        isActive: true,
      },
    });

  for (const demoUser of Object.values(demoUsers)) {
    await db
      .insert(user)
      .values({
        id: demoUser.id,
        name: demoUser.name,
        email: demoUser.email,
        emailVerified: true,
        role: demoUser.role,
        isActive: demoUser.isActive,
        customerId: demoUser.customerId,
      })
      .onConflictDoUpdate({
        target: user.id,
        set: {
          name: demoUser.name,
          email: demoUser.email,
          emailVerified: true,
          role: demoUser.role,
          isActive: demoUser.isActive,
          customerId: demoUser.customerId,
        },
      });

    await db
      .insert(account)
      .values({
        id: demoUser.accountId,
        userId: demoUser.id,
        accountId: demoUser.email,
        providerId: "credential",
        password: passwordHash,
      })
      .onConflictDoUpdate({
        target: account.id,
        set: {
          userId: demoUser.id,
          accountId: demoUser.email,
          providerId: "credential",
          password: passwordHash,
        },
      });
  }

  await db
    .insert(itemCategory)
    .values({
      id: dataIds.category,
      name: "Demo Produce",
      description: "QA demo category",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: itemCategory.id,
      set: { name: "Demo Produce", description: "QA demo category", isActive: true },
    });

  await upsertDemoItem(dataIds.itemApple, "DEMO-APPLE", "Demo Apples", 1250, true);
  await upsertDemoItem(dataIds.itemPear, "DEMO-PEAR", "Demo Pears", 975, false);

  await db
    .insert(itemDiscount)
    .values({
      id: dataIds.discount,
      itemId: dataIds.itemApple,
      name: "Demo 10% Tier Discount",
      discountBps: 1000,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: itemDiscount.id,
      set: {
        itemId: dataIds.itemApple,
        name: "Demo 10% Tier Discount",
        discountBps: 1000,
        isActive: true,
      },
    });

  await db
    .insert(tierItemDiscount)
    .values({
      id: dataIds.tierDiscount,
      tierId: dataIds.tier,
      itemId: dataIds.itemApple,
      discountId: dataIds.discount,
    })
    .onConflictDoUpdate({
      target: tierItemDiscount.id,
      set: {
        tierId: dataIds.tier,
        itemId: dataIds.itemApple,
        discountId: dataIds.discount,
      },
    });

  const internalOrderId = await getOrCreateOrder("DEMO-INTERNAL-001", async () => {
    const orderId = await createOrder(
      {
        customerId: dataIds.customer,
        customerOrderNumber: "DEMO-INTERNAL-001",
        invoiceNumber: "DEMO-INV",
        poNumber: "DEMO-PO",
        poNumber2: "DEMO-PO-2",
        orderDate: new Date(),
        soldByUserId: demoUsers.manager.id,
        soldByName: demoUsers.manager.name,
        paymentMethod: "Card",
        charge: "Delivery",
        taxCents: 125,
        receivedBy: "Demo Receiver",
        isTotalOverridden: false,
        manualTotalCents: null,
        manualTotalReason: "",
        lines: [
          { itemId: dataIds.itemApple, pack: "case", quantity: 3, rejectedQuantity: 0, sortOrder: 0, isActive: true },
          { itemId: dataIds.itemPear, pack: "case", quantity: 2, rejectedQuantity: 0, sortOrder: 1, isActive: true },
        ],
      },
      { userId: demoUsers.manager.id, userName: demoUsers.manager.name },
    );
    await addOrderNote({
      orderId,
      body: "Demo note for acceptance recording.",
      actor: { userId: demoUsers.manager.id, userName: demoUsers.manager.name },
    });
    await transitionOrderStatus({
      orderId,
      status: OrderStatus.InProgress,
      actor: { userId: demoUsers.manager.id, userName: demoUsers.manager.name },
    });
    return orderId;
  });

  const portalOrderId = await getOrCreateActivePortalOrder(async () =>
    createOrder(
      {
        customerId: dataIds.customer,
        customerOrderNumber: "DEMO-PORTAL-001",
        invoiceNumber: "",
        poNumber: "PORTAL-PO",
        poNumber2: "",
        orderDate: new Date(),
        soldByUserId: demoUsers.customer.id,
        soldByName: demoUsers.customer.name,
        paymentMethod: "Portal Card",
        charge: "",
        taxCents: 0,
        receivedBy: "Customer Portal",
        isTotalOverridden: false,
        manualTotalCents: null,
        manualTotalReason: "",
        lines: [
          { itemId: dataIds.itemApple, pack: "box", quantity: 1, rejectedQuantity: 0, sortOrder: 0, isActive: true },
        ],
      },
      { userId: demoUsers.customer.id, userName: demoUsers.customer.name },
    ),
  );

  const existingInvoice = await db.query.invoice.findFirst({
    where: (rows, { eq }) => eq(rows.orderId, internalOrderId),
  });
  const invoiceId =
    existingInvoice?.id ??
    (await generateInvoice(
      {
        orderId: internalOrderId,
        invoiceType: InvoiceType.Pink,
        invoiceCategory: InvoiceCategory.WalkIn,
      },
      { userId: demoUsers.manager.id },
    ));

  const existingTransferRow = await db.query.quickbooksTransferInvoice.findFirst({
    where: (rows, { eq }) => eq(rows.invoiceId, invoiceId),
  });
  const transferId =
    existingTransferRow?.transferId ??
    (await generateQuickBooksTransfer([invoiceId], { userId: demoUsers.manager.id }));

  async function upsertDemoItem(
    id: string,
    code: string,
    description: string,
    priceCents: number,
    isFavorite: boolean,
  ) {
    await db
      .insert(item)
      .values({
        id,
        code,
        description,
        priceCents,
        categoryId: dataIds.category,
        isFavorite,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: item.id,
        set: { code, description, priceCents, categoryId: dataIds.category, isFavorite, isActive: true },
      });
  }

  async function getOrCreateOrder(
    customerOrderNumber: string,
    create: () => Promise<string>,
  ) {
    const existingOrder = await db.query.order.findFirst({
      where: (rows, { eq }) => eq(rows.customerOrderNumber, customerOrderNumber),
    });
    return existingOrder?.id ?? create();
  }

  async function getOrCreateActivePortalOrder(create: () => Promise<string>) {
    const existingOrder = await db.query.order.findFirst({
      where: (rows, { and, eq, isNull }) =>
        and(
          eq(rows.customerOrderNumber, "DEMO-PORTAL-001"),
          eq(rows.createdByUserId, demoUsers.customer.id),
          isNull(rows.deletedAt),
        ),
    });
    return existingOrder?.id ?? create();
  }

  console.log("Demo seed data ready.");
  return { internalOrderId, portalOrderId, invoiceId, transferId };
}

function makeClips(): Clip[] {
  return [
    {
      id: "01-admin-login-and-user-management",
      title: "Admin login and user management",
      proof: "FR-1, FR-4, FR-5, FR-6, FR-7",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/users");
        await visit(page, "/admin/users/new");
      },
    },
    {
      id: "02-catalog-customers-pricing",
      title: "Catalog, customers, pricing",
      proof: "FR-8 through FR-16",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/catalog");
        await visit(page, "/admin/customers");
        await visit(page, "/admin/pricing");
      },
    },
    {
      id: "03-order-create-status-notes",
      title: "Order create, status, notes",
      proof: "FR-19, FR-20, FR-22, FR-23",
      actor: "manager",
      run: async (page, seed) => {
        await visit(page, "/orders");
        await visit(page, `/orders/${seed.internalOrderId}`);
      },
    },
    {
      id: "04-partial-rejection-and-total-override",
      title: "Partial rejection and total override",
      proof: "FR-21, FR-28",
      actor: "manager",
      run: async (page, seed) => {
        await visit(page, `/orders/${seed.internalOrderId}`);
        await visit(page, `/orders/${seed.internalOrderId}/partial-rejection`);
      },
    },
    {
      id: "05-invoice-generation-and-download",
      title: "Invoice generation and download",
      proof: "FR-24 through FR-27",
      actor: "manager",
      run: async (page, seed) => {
        await visit(page, "/invoices");
        await visit(page, `/invoices/${seed.invoiceId}`);
        await visit(page, `/orders/${seed.internalOrderId}`);
      },
    },
    {
      id: "06-quickbooks-export-and-reconciliation",
      title: "QuickBooks export and reconciliation",
      proof: "FR-30 through FR-32, TC-4",
      actor: "manager",
      run: async (page, seed) => {
        await visit(page, "/quickbooks");
        if (seed.transferId) {
          await visit(page, `/quickbooks/${seed.transferId}`);
        }
      },
    },
    {
      id: "07-admin-daily-report",
      title: "Admin daily report",
      proof: "FR-36, BC-4",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/reports");
      },
    },
    {
      id: "08-customer-portal-invite-order-cancel",
      title: "Customer portal invite, order, cancel",
      proof: "FR-39 through FR-45, TC-6",
      actor: "customer",
      run: async (page) => {
        await visit(page, "/portal");
        await visit(page, "/portal/profile");
        await visit(page, "/portal/orders");
        await visit(page, "/portal/orders/new");
      },
    },
    {
      id: "09-security-negative-tests",
      title: "Security negative tests",
      proof: "FR-4, FR-7, FR-39",
      run: async (page) => {
        await titleCard(page, "Anonymous user redirected from Customer Portal");
        await visit(page, "/portal");
        await login(page, demoUsers.manager.email);
        await titleCard(page, "Orders Manager denied from Admin user management");
        await visit(page, "/admin/users");
        await login(page, demoUsers.customer.email);
        await titleCard(page, "Customer denied from internal Orders workspace");
        await visit(page, "/orders");
        await login(page, demoUsers.disabled.email);
        await titleCard(page, "Inactive user cannot enter protected workspace");
        await visit(page, "/orders");
      },
    },
  ];
}

async function recordClip(browser: Browser, clip: Clip, seed: DemoSeed) {
  // Video frame size MUST equal the viewport for the whole clip — a
  // mismatch (or a mid-clip resize) makes Playwright scale frames and the
  // video looks like a broken layout. One clip per viewport, always.
  const viewport = clip.viewport ?? DEFAULT_VIEWPORT;
  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: viewport },
    viewport,
  });
  const page = await context.newPage();
  // Hard guard: a scene attempting a mid-clip resize fails loudly instead
  // of silently producing a distorted video.
  page.setViewportSize = async () => {
    throw new Error(
      `Clip "${clip.id}" attempted setViewportSize mid-recording. ` +
        "recordVideo's frame size is fixed per context - resizing distorts " +
        "the video. Create a separate clip with its own `viewport` instead.",
    );
  };
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const screenshotPath = path.join(OUT_DIR, `${clip.id}.png`);
  const videoPath = path.join(OUT_DIR, `${clip.id}.webm`);

  try {
    await titleCard(page, `${clip.title}\n${clip.proof}`);
    if (clip.actor) {
      await login(page, demoUsers[clip.actor].email);
    }
    await clip.run(page, seed);
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      const rawPath = await video.path();
      await copyFile(rawPath, videoPath);
    }
  }

  return {
    id: clip.id,
    title: clip.title,
    proof: clip.proof,
    video: `docs/qa/demo-recordings/${clip.id}.webm`,
    screenshot: `docs/qa/demo-recordings/${clip.id}.png`,
  };
}

async function login(page: Page, email: string) {
  console.log(`  login ${email}`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForTimeout(1_500);
}

async function visit(page: Page, route: string) {
  console.log(`  visit ${route}`);
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1200);
}

async function titleCard(page: Page, title: string) {
  await page.setContent(`
    <main style="font-family: Arial, sans-serif; padding: 72px; color: #111">
      <p style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.12em; color: #555">MVP QA Demo</p>
      <h1 style="font-size: 40px; line-height: 1.2; white-space: pre-line">${escapeHtml(title)}</h1>
      <p style="font-size: 18px; color: #555">Base URL: ${escapeHtml(BASE_URL)}</p>
    </main>
  `);
  await page.waitForTimeout(1200);
}

async function ensureServer(): Promise<ChildProcess | null> {
  console.log(`Checking demo server at ${BASE_URL}...`);
  if (await isServerReady()) {
    console.log("Demo server already reachable.");
    return null;
  }
  if (!START_SERVER) {
    throw new Error(
      `Demo server is not reachable at ${BASE_URL}. Start one server manually first, or run with DEMO_START_SERVER=true if you intentionally want this script to spawn it.`,
    );
  }

  console.log("Starting demo server with npm run dev...");
  const server = spawn("npm", ["run", "dev"], {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
  childProcesses.add(server);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(1000);
    if (await isServerReady()) {
      console.log("Demo server ready.");
      return server;
    }
  }

  killProcess(server);
  throw new Error(`Timed out waiting for demo server at ${BASE_URL}`);
}

async function isServerReady() {
  try {
    const response = await fetch(new URL("/login", BASE_URL), {
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    return response.status >= 200 && response.status < 400 && text.includes("Sign in");
  } catch {
    return false;
  }
}

async function writeManifest(
  results: Array<{
    id: string;
    title: string;
    proof: string;
    video: string;
    screenshot: string;
  }>,
) {
  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "manifest.json");
  const markdownPath = path.join(OUT_DIR, "README.md");
  await writeFile(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  await writeFile(
    markdownPath,
    `# Demo Recordings

Generated by \`npm run qa:record-demos\`.

| Clip | Proof | Video | Screenshot |
|---|---|---|---|
${results
  .map(
    (result) =>
      `| ${result.id} | ${result.proof} | [webm](${path.basename(result.video)}) | [png](${path.basename(result.screenshot)}) |`,
  )
  .join("\n")}
`,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    throw new Error(
      `Demo recorder lock exists at ${LOCK_FILE}. If no recorder is running, delete it and retry.`,
    );
  }
  await writeFile(
    LOCK_FILE,
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function releaseLock() {
  await rm(LOCK_FILE, { force: true }).catch(() => undefined);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function killProcess(child: ChildProcess) {
  if (!child.pid) return;
  childProcesses.delete(child);
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      shell: true,
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGTERM");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (!existsSync(path.resolve("package.json"))) {
  throw new Error("Run this script from the project root.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const child of childProcesses) {
      killProcess(child);
    }
    releaseLock().finally(() => process.exit(1));
  });
}
