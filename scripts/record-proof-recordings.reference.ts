// REFERENCE IMPLEMENTATION (proven in the Ordering & Fulfillment Platform).
// UAT PROOF recorder: one clip per fixed bug that RE-EXECUTES the QA report's
// reproduction steps and shows the fixed behavior. Every clip ships as a
// triplet: .webm video + .png final screenshot + .md explainer (QA quote,
// root cause, fix, what-the-video-shows, expected outcome), plus README index
// and manifest.json under docs/qa/bugfix-recordings/<round>/.
//
// To adapt: replace the seed with the new project's domains, rewrite
// makeClips() so each clip's `run` performs the tester's exact steps, keep:
// idempotent seed that RE-PINS baseline state (manual testers share the DB),
// cleanup of users created by previous runs, login that waits for the actual
// redirect (cold dev servers are slow), and alert checks scoped to
// `main [role="alert"]` (the framework's route announcer is also role=alert).
// Wire as: "qa:record-proof": "tsx scripts/record-bugfix-demos.ts".
//
// Original header:
// Records video + screenshot + explainer markdown for every fixed defect from
// the external QA report (docs/qa/2026-06-05-ordering-platform-bugreport.pdf).
//
// Unlike scripts/record-demos.ts (capability walkthroughs), each clip here
// re-executes the reproduction steps from the QA report and shows the fixed
// behavior. Output: docs/qa/bugfix-recordings/<round>/ with one
// .webm + .png + .md triplet per clip, plus README.md and manifest.json.
//
// Usage: start a dev server (npm run dev), then `npm run qa:record-bugfix-demos`.
import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { eq, like } from "drizzle-orm";
import { chromium, type Browser, type Page } from "playwright";
import { hashPassword } from "@/lib/auth/password";
import { Role } from "@/lib/auth/roles";
import {
  account,
  customer,
  customerTier,
  invitation,
  item,
  itemCategory,
  itemDiscount,
  order,
  passwordHistory,
  receivingMethod,
  session,
  tierItemDiscount,
  user,
} from "@/db/schema";

config({ path: [".env.local", ".env"] });

const ROUND = process.env.BUGFIX_ROUND ?? "2026-06-10";
const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const START_SERVER = process.env.DEMO_START_SERVER === "true";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoPass1!";
const OUT_DIR = path.resolve("docs/qa/bugfix-recordings", ROUND);
const VIDEO_DIR = path.join(OUT_DIR, "raw");
const LOCK_FILE = path.resolve(".bugfix-recorder.lock");
const CLIP_TIMEOUT_MS = Number(process.env.DEMO_CLIP_TIMEOUT_MS ?? 120_000);
const INVITED_EMAIL = "demo.invited@example.com";
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
  roletest: {
    id: "demo-roletest-user",
    accountId: "demo-roletest-account",
    email: "demo.roletest@example.com",
    name: "Demo Role Test User",
    role: Role.OrdersManager,
    isActive: true,
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
  itemPlum: "demo-item-plum",
  discount: "demo-discount",
  tierDiscount: "demo-tier-discount",
};

type BugSeed = {
  internalOrderId: string;
};

type Clip = {
  id: string;
  title: string;
  bugRefs: string;
  requirements: string;
  qaIssue: string;
  rootCause: string;
  fixSummary: string;
  steps: string[];
  expected: string;
  actor?: keyof typeof demoUsers;
  run: (page: Page, seed: BugSeed) => Promise<void>;
};

async function main() {
  await acquireLock();
  await mkdir(VIDEO_DIR, { recursive: true });
  let browser: Browser | null = null;
  let server: ChildProcess | null = null;

  try {
    server = await ensureServer();
    const seed = await seedBugfixData();
    browser = await chromium.launch({ headless: true });
    const results = [];

    for (const clip of makeClips()) {
      console.log(`Recording ${clip.id}: ${clip.title}`);
      results.push(
        await withTimeout(
          recordClip(browser, clip, seed),
          CLIP_TIMEOUT_MS,
          `Timed out recording ${clip.id}`,
        ),
      );
    }

    await writeExplainers(results);
    await writeIndex(results);
    await rm(VIDEO_DIR, { recursive: true, force: true });
    console.log(`Bug-fix recordings written to ${OUT_DIR}`);
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

// Idempotent seed: reuses the deterministic demo data from record-demos.ts,
// adds an inactive item (bug 1), a dedicated role-test user (bug 14), removes
// any previously invited demo user (bugs 15/16), and re-pins the seeded
// internal order to In Progress (bugs 9/10/11) so re-runs are repeatable.
async function seedBugfixData(): Promise<BugSeed> {
  console.log("Seeding deterministic bug-fix demo data...");
  const { db } = await import("@/db");
  const { createOrder, transitionOrderStatus } = await import("@/lib/orders/service");
  const { OrderStatus } = await import("@/lib/orders/status");

  const passwordHash = await hashPassword(PASSWORD);

  await db
    .insert(customerTier)
    .values({ id: dataIds.tier, name: "Demo Tier", description: "Tier used for QA demo recordings", isActive: true })
    .onConflictDoUpdate({
      target: customerTier.id,
      set: { name: "Demo Tier", description: "Tier used for QA demo recordings", isActive: true },
    });

  await db
    .insert(receivingMethod)
    .values({ id: dataIds.receivingMethod, name: "Demo Receiving Method", description: "QA demo receiving method", isActive: true })
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
        set: { userId: demoUser.id, accountId: demoUser.email, providerId: "credential", password: passwordHash },
      });
  }

  // Remove the user/invitations produced by a previous invitation-flow clip.
  const invitedUsers = await db.query.user.findMany({
    where: (users, { eq }) => eq(users.email, INVITED_EMAIL),
  });
  for (const invited of invitedUsers) {
    await db.delete(session).where(eq(session.userId, invited.id));
    await db.delete(passwordHistory).where(eq(passwordHistory.userId, invited.id));
    await db.delete(account).where(eq(account.userId, invited.id));
    await db.delete(user).where(eq(user.id, invited.id));
  }
  await db.delete(invitation).where(like(invitation.email, INVITED_EMAIL));

  await db
    .insert(itemCategory)
    .values({ id: dataIds.category, name: "Demo Produce", description: "QA demo category", isActive: true })
    .onConflictDoUpdate({
      target: itemCategory.id,
      set: { name: "Demo Produce", description: "QA demo category", isActive: true },
    });

  await upsertDemoItem(db, dataIds.itemApple, "DEMO-APPLE", "Demo Apples", 1250, true, true);
  await upsertDemoItem(db, dataIds.itemPear, "DEMO-PEAR", "Demo Pears", 975, false, true);
  // Inactive on purpose: bug 1 needs an item that only shows with "Include inactive".
  await upsertDemoItem(db, dataIds.itemPlum, "DEMO-PLUM", "Demo Plums (inactive)", 800, false, false);

  await db
    .insert(itemDiscount)
    .values({ id: dataIds.discount, itemId: dataIds.itemApple, name: "Demo 10% Tier Discount", discountBps: 1000, isActive: true })
    .onConflictDoUpdate({
      target: itemDiscount.id,
      set: { itemId: dataIds.itemApple, name: "Demo 10% Tier Discount", discountBps: 1000, isActive: true },
    });

  await db
    .insert(tierItemDiscount)
    .values({ id: dataIds.tierDiscount, tierId: dataIds.tier, itemId: dataIds.itemApple, discountId: dataIds.discount })
    .onConflictDoUpdate({
      target: tierItemDiscount.id,
      set: { tierId: dataIds.tier, itemId: dataIds.itemApple, discountId: dataIds.discount },
    });

  const existingOrder = await db.query.order.findFirst({
    where: (rows, { eq }) => eq(rows.customerOrderNumber, "DEMO-INTERNAL-001"),
  });
  let internalOrderId = existingOrder?.id;
  if (!internalOrderId) {
    internalOrderId = await createOrder(
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
    await transitionOrderStatus({
      orderId: internalOrderId,
      status: OrderStatus.InProgress,
      actor: { userId: demoUsers.manager.id, userName: demoUsers.manager.name },
    });
  }

  // Re-pin baseline so the status clip can repeat In Progress -> Delivering.
  await db
    .update(order)
    .set({ status: OrderStatus.InProgress, deletedAt: null, updatedAt: new Date() })
    .where(eq(order.id, internalOrderId));

  console.log("Bug-fix demo seed ready.");
  return { internalOrderId };
}

async function upsertDemoItem(
  db: Awaited<typeof import("@/db")>["db"],
  id: string,
  code: string,
  description: string,
  priceCents: number,
  isFavorite: boolean,
  isActive: boolean,
) {
  await db
    .insert(item)
    .values({ id, code, description, priceCents, categoryId: dataIds.category, isFavorite, isActive })
    .onConflictDoUpdate({
      target: item.id,
      set: { code, description, priceCents, categoryId: dataIds.category, isFavorite, isActive },
    });
}

function makeClips(): Clip[] {
  return [
    {
      id: "bug-01-catalog-inactive-filter-reset",
      title: "Catalog filters reset together with the data",
      bugRefs: "QA bug 1",
      requirements: "FR-9, FR-10",
      qaIssue:
        "Inactive items are not displayed if the user returns to the Catalog page (the “Include inactive” checkbox remains checked).",
      rootCause:
        "The filter checkboxes were uncontrolled inputs, so the browser kept their state across client-side navigations while the data followed the (now empty) URL parameters.",
      fixSummary:
        "The filter form is keyed by the active URL filters, so it re-mounts and re-syncs with the data on every navigation.",
      steps: [
        "Sign in as Demo Admin and open the Catalog.",
        "Check “Include inactive” and click Filter — the inactive item DEMO-PLUM appears in the table.",
        "Navigate to Catalog again via the header link.",
        "The checkbox is now unchecked and the inactive item is hidden — checkbox and data agree.",
      ],
      expected:
        "Filter controls always match the displayed data after navigation; no stale checkbox state.",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/catalog");
        await page.getByLabel("Include inactive").check();
        await page.getByRole("button", { name: "Filter" }).click();
        await page
          .locator("tbody tr", { hasText: "DEMO-PLUM" })
          .first()
          .waitFor({ timeout: 15_000 });
        await pause(page, 1500);
        await page
          .getByRole("navigation")
          .getByRole("link", { name: "Catalog" })
          .click();
        await page.waitForFunction(
          () =>
            window.location.pathname === "/admin/catalog" &&
            !window.location.search.includes("includeInactive") &&
            !(document.querySelector('input[name="includeInactive"]') as HTMLInputElement | null)?.checked,
          undefined,
          { timeout: 20_000 },
        );
        await pause(page, 1500);
      },
    },
    {
      id: "bug-02-category-delete-friendly-error",
      title: "Deleting an in-use category shows an inline message (no 500)",
      bugRefs: "QA bug 2",
      requirements: "FR-8",
      qaIssue:
        "A 500 error occurs when a user tries to delete a category that has already been assigned to an item.",
      rootCause:
        "The foreign-key violation thrown by the database crashed the Server Action, which renders as a generic 500 page in production.",
      fixSummary:
        "Delete actions translate constraint violations into a friendly inline banner and suggest deactivating instead.",
      steps: [
        "Sign in as Demo Admin and open the Catalog.",
        "Expand the “Demo Produce” category (it has items assigned) and click “Delete category”.",
        "A red inline banner explains the category is still referenced — the page stays functional, no error screen.",
      ],
      expected:
        "Friendly message: “Could not delete this category because items still reference it. Mark it inactive instead.”",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/catalog");
        const categoryCard = page.locator("aside details", { hasText: "Demo Produce" });
        await categoryCard.locator("summary").click();
        await pause(page, 800);
        await categoryCard.getByRole("button", { name: "Delete category" }).click();
        await page.locator('main [role="alert"]').waitFor({ timeout: 20_000 });
        await pause(page, 2000);
      },
    },
    {
      id: "bug-03-favorite-toggle-sync",
      title: "Favorite toggle and open edit form stay in sync",
      bugRefs: "QA bug 3",
      requirements: "FR-10",
      qaIssue:
        "The “Favorite” status (Yes/No) of an item does not change if the user clicks on the status hyperlink in edit mode, and saving reverts the toggle.",
      rootCause:
        "The row hyperlink and the open edit form were two uncontrolled views of the same value; the form kept its stale checkbox and overwrote the toggle on Save.",
      fixSummary:
        "Edit forms are keyed by the saved row state, so an open form re-mounts with fresh values after every change.",
      steps: [
        "Sign in as Demo Admin, open the Catalog, and expand Edit for DEMO-PEAR (Favorite = No).",
        "Click the “No” hyperlink — it flips to “Yes” and the Favorite checkbox in the open form updates too.",
        "Click “Save item” — the status stays “Yes” (previously it silently reverted).",
        "Toggle back to “No” to restore the demo data.",
      ],
      expected:
        "Hyperlink, edit-form checkbox, and saved value always agree; saving never reverts a toggle.",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/catalog");
        const row = page.locator("tbody tr", { hasText: "DEMO-PEAR" });
        await row.locator("summary").click();
        await pause(page, 1000);
        await row.getByRole("button", { name: "No", exact: true }).click();
        await row.getByRole("button", { name: "Yes", exact: true }).waitFor({ timeout: 20_000 });
        await pause(page, 1500);
        await row.getByRole("button", { name: "Save item" }).click();
        await row.getByRole("button", { name: "Yes", exact: true }).waitFor({ timeout: 20_000 });
        await pause(page, 1500);
        await row.getByRole("button", { name: "Yes", exact: true }).click();
        await row.getByRole("button", { name: "No", exact: true }).waitFor({ timeout: 20_000 });
        await pause(page, 1000);
      },
    },
    {
      id: "bug-04-price-extra-decimals",
      title: "Price with extra decimal zeros saves correctly (no 500)",
      bugRefs: "QA bug 4 (same fix covers QA bug 7)",
      requirements: "FR-8",
      qaIssue:
        "Error 500 occurs when a user enters more zeros after the decimal point (in the Price field).",
      rootCause:
        "The money parser only accepted up to two decimal places, while Chrome number inputs legally submit values like 12.510; locale decimal commas were rejected too.",
      fixSummary:
        "The parser normalizes trailing zeros and decimal commas; genuinely invalid input shows an inline message instead of crashing.",
      steps: [
        "Sign in as Demo Admin, open the Catalog, and expand Edit for DEMO-APPLE.",
        "Enter the price 12.510 (three decimals) and click “Save item”.",
        "The item saves and the table shows $12.51 — no error page.",
        "The price is then restored to $12.50 for the demo data.",
      ],
      expected: "Values like 12.510 or 12,51 are accepted and stored as $12.51.",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/catalog");
        const row = page.locator("tbody tr", { hasText: "DEMO-APPLE" });
        await row.locator("summary").click();
        await pause(page, 800);
        await row.locator('input[name="price"]').fill("12.510");
        await pause(page, 800);
        await row.getByRole("button", { name: "Save item" }).click();
        await row.getByText("$12.51").waitFor({ timeout: 20_000 });
        await pause(page, 1500);
        await row.locator('input[name="price"]').fill("12.50");
        await row.getByRole("button", { name: "Save item" }).click();
        await row.getByText("$12.50").waitFor({ timeout: 20_000 });
        await pause(page, 1000);
      },
    },
    {
      id: "bug-05-06-customers-notes-and-validation",
      title: "Customer register shows Notes; oversized input gets an inline message",
      bugRefs: "QA bugs 5, 6",
      requirements: "FR-11, FR-12",
      qaIssue:
        "Notes field is missing in the table. Error 500 occurs when a user enters values that are too large in the input fields while editing or creating a new customer.",
      rootCause:
        "The Notes column required by FR-11 was simply not rendered; oversized values failed validation inside the Server Action and crashed with a 500.",
      fixSummary:
        "Notes column added to the Customer register; validation errors are shown as a friendly inline banner.",
      steps: [
        "Sign in as Demo Admin and open Customers — the table now has a Notes column (Demo Customer shows “QA demo customer”).",
        "In “Add customer”, enter a 200-character name plus valid other fields and submit.",
        "An inline banner says “Customer name must be 160 characters or fewer.” — no error page.",
      ],
      expected:
        "Notes are visible in the register (FR-11); invalid input is explained inline.",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/customers");
        await page.getByRole("columnheader", { name: "Notes" }).waitFor({ timeout: 15_000 });
        await pause(page, 1500);
        const addForm = page.locator("aside form").first();
        await addForm.getByPlaceholder("Customer name").fill("X".repeat(200));
        await addForm.getByPlaceholder("Address").fill("123 Long Name Street");
        await addForm.getByPlaceholder("Notes").fill("Oversized input demo");
        await addForm.locator('select[name="tierId"]').selectOption({ label: "Demo Tier" });
        await addForm
          .locator('select[name="receivingMethodId"]')
          .selectOption({ label: "Demo Receiving Method" });
        await pause(page, 800);
        await addForm.getByRole("button", { name: "Add customer" }).click();
        await page.locator('main [role="alert"]').waitFor({ timeout: 20_000 });
        await pause(page, 2000);
      },
    },
    {
      id: "bug-07-pricing-percent-decimals",
      title: "Discount percentage with extra decimal zeros saves (no 500)",
      bugRefs: "QA bug 7",
      requirements: "FR-15",
      qaIssue:
        "Error 500 occurs when a user enters more zeros after the decimal point (in the percentage field).",
      rootCause: "Same strict decimal parsing as the Price field (QA bug 4).",
      fixSummary:
        "The shared percentage parser now accepts trailing zeros and decimal commas; out-of-range or invalid values show an inline message.",
      steps: [
        "Sign in as Demo Admin and open Pricing.",
        "Expand Edit for “Demo 10% Tier Discount”, enter 10.000 (three decimals), and save.",
        "The discount saves and still displays 10% — no error page.",
      ],
      expected: "Values like 10.000 or 50,000 are accepted (10% / 50%).",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/pricing");
        const row = page
          .locator("tbody tr", { hasText: "Demo 10% Tier Discount" })
          .first();
        await row.locator("summary").click();
        await pause(page, 800);
        await row.locator('input[name="discountPercent"]').fill("10.000");
        await pause(page, 800);
        await row.getByRole("button", { name: "Save discount" }).click();
        await pause(page, 2000);
        const hasAlert = await page.locator('main [role="alert"]').count();
        if (hasAlert > 0) {
          throw new Error("Unexpected error banner while saving 10.000%");
        }
      },
    },
    {
      id: "bug-08-blank-order-inline-error",
      title: "Creating an order without items shows an inline message (no 500)",
      bugRefs: "QA bug 8",
      requirements: "FR-19, FR-20",
      qaIssue:
        "Error 500 occurs when a user creates a new order and leaves all fields blank (except Customer name).",
      rootCause:
        "The “at least one order line” validation threw inside the Server Action and crashed with a 500 instead of being shown to the user.",
      fixSummary:
        "Order validation errors redirect back to the form with an inline banner.",
      steps: [
        "Sign in as Demo Orders Manager and open New order.",
        "Select Demo Customer, leave everything else blank, and click “Create order”.",
        "An inline banner says “Add at least one item line before saving the order.”",
      ],
      expected: "Clear inline validation; the form page never crashes.",
      actor: "manager",
      run: async (page) => {
        await visit(page, "/orders/new");
        await page
          .locator('select[name="customerId"]')
          .selectOption({ label: "Demo Customer" });
        await pause(page, 800);
        await page.getByRole("button", { name: "Create order" }).click();
        await page.locator('main [role="alert"]').waitFor({ timeout: 20_000 });
        await pause(page, 2000);
      },
    },
    {
      id: "bug-09-10-status-dropdown-forward-only",
      title: "Order status dropdown re-syncs and only offers valid transitions",
      bugRefs: "QA bugs 9, 10",
      requirements: "FR-22 (forward-only lifecycle per order-management spec)",
      qaIssue:
        "Order status dropdown displays old value after changing it. Error 500 occurs when a user changes status of the order to a previous one (e.g. Delivering → In Progress).",
      rootCause:
        "The dropdown was an uncontrolled select that kept stale browser state, and it offered every status while the server correctly rejects backward moves — the rejection surfaced as a 500.",
      fixSummary:
        "The dropdown is keyed by the saved status (always re-syncs) and only lists reachable statuses, with a hint that orders move forward only.",
      steps: [
        "Sign in as Demo Orders Manager and open order DEMO-INTERNAL-001 (status: In Progress).",
        "The Status dropdown offers only In Progress, Delivering, and Rejected — backward moves like Draft are not offered.",
        "Change the status to Delivering and click “Update status”.",
        "The page header and the dropdown both show Delivering immediately; the dropdown now offers Delivering, Delivered and Accepted, Rejected.",
      ],
      expected:
        "Dropdown always matches the saved status; invalid transitions cannot be submitted.",
      actor: "manager",
      run: async (page, seed) => {
        await visit(page, `/orders/${seed.internalOrderId}`);
        await page.locator('select[name="status"]').waitFor({ timeout: 15_000 });
        await pause(page, 1500);
        await page
          .locator('select[name="status"]')
          .selectOption({ label: "Delivering" });
        await page.getByRole("button", { name: "Update status" }).click();
        await page.waitForFunction(
          () =>
            (document.querySelector('select[name="status"]') as HTMLSelectElement | null)
              ?.value === "delivering",
          undefined,
          { timeout: 20_000 },
        );
        await pause(page, 2000);
      },
    },
    {
      id: "bug-11-tier-discount-applied",
      title: "Tier-mapped discounts are applied automatically (works as specified)",
      bugRefs: "QA bug 11 — works as specified (FR-16)",
      requirements: "FR-15, FR-16",
      qaIssue: "The discount has not been applied to the price.",
      rootCause:
        "Not a defect: per FR-16 a discount applies only after it is mapped to the customer’s tier. The tester created an item discount without a tier mapping.",
      fixSummary:
        "Behavior unchanged (it matches FR-16). The Pricing page and order form now explain that a discount needs a tier mapping, so this is self-explanatory.",
      steps: [
        "Sign in as Demo Admin and open Pricing — the right panel shows the tier mapping: Demo Tier + DEMO-APPLE → Demo 10% Tier Discount.",
        "Open order DEMO-INTERNAL-001 for Demo Customer (who is in Demo Tier).",
        "The DEMO-APPLE line shows discount “Demo 10% Tier Discount” and the discounted unit price $11.25 (base $12.50).",
      ],
      expected:
        "With a tier mapping in place the discount is applied automatically, exactly as FR-16 requires.",
      actor: "admin",
      run: async (page, seed) => {
        await visit(page, "/admin/pricing");
        await page.getByText("Demo 10% Tier Discount").first().waitFor({ timeout: 15_000 });
        await pause(page, 2000);
        await visit(page, `/orders/${seed.internalOrderId}`);
        await page.getByText("Demo 10% Tier Discount").first().waitFor({ timeout: 15_000 });
        await pause(page, 2000);
      },
    },
    {
      id: "bug-12-long-values-inline-error",
      title: "Long values in order fields show an inline message (no 500)",
      bugRefs: "QA bug 12",
      requirements: "FR-20",
      qaIssue:
        "Error 500 occurs when the user enters long values into the New order fields.",
      rootCause:
        "Field-length validation threw inside the Server Action and crashed with a 500.",
      fixSummary:
        "Length limits are reported inline: “Keep text fields to 255 characters or fewer.”",
      steps: [
        "Sign in as Demo Orders Manager and open New order.",
        "Select Demo Customer and paste a 300-character value into PO number.",
        "Submit — an inline banner explains the 255-character limit.",
      ],
      expected: "Friendly inline limit message; no crash.",
      actor: "manager",
      run: async (page) => {
        await visit(page, "/orders/new");
        await page
          .locator('select[name="customerId"]')
          .selectOption({ label: "Demo Customer" });
        await page.locator('input[name="poNumber"]').fill("L".repeat(300));
        await pause(page, 800);
        await page.getByRole("button", { name: "Create order" }).click();
        await page.locator('main [role="alert"]').waitFor({ timeout: 20_000 });
        await pause(page, 2000);
      },
    },
    {
      id: "bug-13-invoices-filter-reset",
      title: "Invoice filters reset when navigating via the header",
      bugRefs: "QA bug 13",
      requirements: "FR-27",
      qaIssue:
        "The values selected in the Type and Category dropdowns are not cleared when the user navigates to the Invoices section via header.",
      rootCause:
        "Same stale-uncontrolled-form cause as the Catalog filters (QA bug 1).",
      fixSummary: "The filter form is keyed by the active URL filters.",
      steps: [
        "Sign in as Demo Orders Manager, open Invoices, select Type = Pink and Category = Walk-in, and click Filter.",
        "Navigate to Invoices again via the header link.",
        "Both dropdowns are back to “All”, matching the unfiltered data.",
      ],
      expected: "Filters and data always agree after navigation.",
      actor: "manager",
      run: async (page) => {
        await visit(page, "/invoices");
        await page.locator('select[name="invoiceType"]').selectOption({ label: "Pink" });
        await page
          .locator('select[name="invoiceCategory"]')
          .selectOption({ label: "Walk-in" });
        await page.getByRole("button", { name: "Filter" }).click();
        await page.waitForFunction(
          () => window.location.search.includes("invoiceType=pink"),
          undefined,
          { timeout: 20_000 },
        );
        await pause(page, 1500);
        await page
          .getByRole("navigation")
          .getByRole("link", { name: "Invoices" })
          .click();
        await page.waitForFunction(
          () =>
            window.location.pathname === "/invoices" &&
            window.location.search === "" &&
            (document.querySelector('select[name="invoiceType"]') as HTMLSelectElement | null)
              ?.value === "",
          undefined,
          { timeout: 20_000 },
        );
        await pause(page, 2000);
      },
    },
    {
      id: "bug-14-user-role-dropdown-sync",
      title: "User role dropdown reflects the saved value",
      bugRefs: "QA bug 14",
      requirements: "FR-7",
      qaIssue: "Role dropdown displays old value after changing it (Edit user page).",
      rootCause:
        "The role select was uncontrolled and could keep stale state after the save refreshed the page data.",
      fixSummary:
        "The select is keyed by the persisted role, so it re-syncs with the database value after saving.",
      steps: [
        "Sign in as Demo Admin, open Users, and edit “Demo Role Test User” (Orders Manager).",
        "Change the role to Admin and click “Save changes” — the dropdown shows Admin.",
        "Reload the page — the dropdown still shows Admin, proving the database value.",
        "The role is then changed back to Orders Manager to restore the demo data.",
      ],
      expected: "The dropdown always shows the persisted role after saving.",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/users");
        const row = page.locator("tbody tr", { hasText: demoUsers.roletest.email });
        await row.getByRole("link", { name: "Edit" }).click();
        await page.locator("select#role").waitFor({ timeout: 15_000 });
        await pause(page, 1000);
        await page.locator("select#role").selectOption({ label: "Admin" });
        await page.getByRole("button", { name: "Save changes" }).click();
        await pause(page, 2500);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () =>
            (document.querySelector("select#role") as HTMLSelectElement | null)?.value ===
            "admin",
          undefined,
          { timeout: 20_000 },
        );
        await pause(page, 1500);
        await page.locator("select#role").selectOption({ label: "Orders Manager" });
        await page.getByRole("button", { name: "Save changes" }).click();
        await pause(page, 2000);
      },
    },
    {
      id: "bug-15-16-invitation-flow-end-to-end",
      title: "Invitation flow: honest email status + working sign-in after accept",
      bugRefs: "QA bugs 15, 16 (bug 15 also needs the Resend domain ops step)",
      requirements: "FR-7, FR-39, NFR-4",
      qaIssue:
        "An invitation mail is not being sent (a new user creation). The creation of a new user process stucks in a pending state (but user was created).",
      rootCause:
        "Email: the configured sender uses Resend’s sandbox domain, which only delivers to the Resend account owner — and the UI claimed “Invitation sent” even when delivery failed. Sign-in: the Better Auth nextCookies plugin was missing, so the session created at the end of the accept flow never reached the browser.",
      fixSummary:
        "The UI now reports email-delivery failure honestly and always provides the invitation link as a manual fallback; the nextCookies plugin makes the automatic sign-in actually work. Full email delivery additionally requires verifying a real domain in Resend (ops step, see the bug-fix report).",
      steps: [
        "Sign in as Demo Admin and invite demo.invited@example.com as Orders Manager.",
        "Because the sandbox sender cannot deliver to that address, an amber banner says the email could not be delivered and shows the invitation link to share manually (previously it falsely said “Invitation sent”).",
        "Open the invitation link, set a display name and a policy-compliant password, and submit.",
        "The new user is signed in immediately and lands on the Orders workspace — the flow no longer dead-ends.",
      ],
      expected:
        "Admins always end up with a working invite link and truthful delivery status; accepted invitees are signed in right away.",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/admin/users/new");
        await page.locator("#email").fill(INVITED_EMAIL);
        await page.locator("#role").selectOption({ label: "Orders Manager" });
        await pause(page, 800);
        await page.getByRole("button", { name: "Send invitation" }).click();
        const code = page.locator("code");
        await code.waitFor({ timeout: 45_000 });
        await pause(page, 2500);
        const acceptUrl = (await code.textContent())?.trim();
        if (!acceptUrl) {
          throw new Error("No invitation link displayed");
        }
        await page.goto(acceptUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.locator("#name").fill("Demo Invited User");
        await page.locator("#password").fill(PASSWORD);
        await pause(page, 800);
        await page
          .getByRole("button", { name: "Set password and sign in" })
          .click();
        await page.waitForURL("**/orders", { timeout: 45_000 });
        await pause(page, 2000);
      },
    },
    {
      id: "bug-18-unified-header-navigation",
      title: "Unified header: same navigation everywhere, logo returns home",
      bugRefs: "QA bug 18",
      requirements: "NFR-15, responsive-application-shell spec",
      qaIssue:
        "The header structure and link to the home page change if the user navigates to the Orders, Invoices, or QuickBooks sections and cannot return to the home page via the product logo.",
      rootCause:
        "Each section layout defined its own navigation items and brand link (/admin/users vs /orders).",
      fixSummary:
        "One shared role-based navigation (lib/navigation.ts); the logo always links to the role-aware home page.",
      steps: [
        "Sign in as Demo Admin and open Orders — the header shows the full admin navigation, identical to the Admin section.",
        "Navigate to Invoices and QuickBooks — the header stays the same.",
        "Click the “Ordering Platform” logo — it returns to the admin home page (/admin/users).",
      ],
      expected:
        "Identical header in every section for a given role; the logo always leads home.",
      actor: "admin",
      run: async (page) => {
        await visit(page, "/orders");
        await page
          .getByRole("navigation")
          .getByRole("link", { name: "My account" })
          .waitFor({ timeout: 15_000 });
        await pause(page, 1500);
        await page.getByRole("navigation").getByRole("link", { name: "Invoices" }).click();
        await page.waitForURL("**/invoices", { timeout: 20_000 });
        await pause(page, 1200);
        await page
          .getByRole("navigation")
          .getByRole("link", { name: "QuickBooks" })
          .click();
        await page.waitForURL("**/quickbooks", { timeout: 20_000 });
        await pause(page, 1200);
        await page.locator("header a").first().click();
        await page.waitForURL("**/admin/users", { timeout: 20_000 });
        await pause(page, 1500);
      },
    },
  ];
}

async function recordClip(browser: Browser, clip: Clip, seed: BugSeed) {
  // Video frame size MUST equal the viewport for the whole clip; resizing
  // mid-recording distorts the video (fixed recordVideo frame). If a bug's
  // reproduction needs another viewport, give that clip its own dimensions
  // here — one clip per viewport, always. (Calibration-run finding R20.)
  const viewport = { width: 1280, height: 720 };
  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: viewport },
    viewport,
  });
  const page = await context.newPage();
  page.setViewportSize = async () => {
    throw new Error(
      `Clip "${clip.id}" attempted setViewportSize mid-recording - this ` +
        "distorts the video. Record a separate clip with its own viewport.",
    );
  };
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const screenshotPath = path.join(OUT_DIR, `${clip.id}.png`);
  const videoPath = path.join(OUT_DIR, `${clip.id}.webm`);

  try {
    await titleCard(page, clip);
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

  return clip;
}

async function login(page: Page, email: string) {
  console.log(`  login ${email}`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Cold dev servers compile the destination route on first hit; wait for the
  // actual redirect instead of a fixed pause so the session cookie is in
  // place before the clip navigates further.
  await page.waitForFunction(
    () => !window.location.pathname.startsWith("/login"),
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(800);
}

async function visit(page: Page, route: string) {
  console.log(`  visit ${route}`);
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1200);
}

async function pause(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

async function titleCard(page: Page, clip: Clip) {
  await page.setContent(`
    <main style="font-family: Arial, sans-serif; padding: 64px; color: #111">
      <p style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.12em; color: #555">
        Bug-fix proof · QA round ${escapeHtml(ROUND)} · ${escapeHtml(clip.bugRefs)}
      </p>
      <h1 style="font-size: 36px; line-height: 1.25; max-width: 28ch">${escapeHtml(clip.title)}</h1>
      <p style="font-size: 18px; color: #444; max-width: 70ch"><strong>QA issue:</strong> ${escapeHtml(clip.qaIssue)}</p>
      <p style="font-size: 16px; color: #555">Requirements: ${escapeHtml(clip.requirements)} · Base URL: ${escapeHtml(BASE_URL)}</p>
    </main>
  `);
  await page.waitForTimeout(2500);
}

async function writeExplainers(clips: Clip[]) {
  const generatedAt = new Date().toISOString();
  for (const clip of clips) {
    const body = `# ${clip.title}

**Bug reference:** ${clip.bugRefs} · mapped in [docs/qa/2026-06-10-bugfix-report.md](../../2026-06-10-bugfix-report.md)
**Requirements:** ${clip.requirements}

## Reported issue (QA, 2026-06-05)

> ${clip.qaIssue}

## Root cause

${clip.rootCause}

## Fix

${clip.fixSummary}

## What the video shows

${clip.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

**Expected outcome:** ${clip.expected}

**Files:** [video](${clip.id}.webm) · [final screenshot](${clip.id}.png)

_Recorded automatically by \`npm run qa:record-bugfix-demos\` on ${generatedAt} against ${BASE_URL}._
`;
    await writeFile(path.join(OUT_DIR, `${clip.id}.md`), body);
  }
}

async function writeIndex(clips: Clip[]) {
  const generatedAt = new Date().toISOString();
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        generatedAt,
        round: ROUND,
        baseUrl: BASE_URL,
        bugReport: "docs/qa/2026-06-05-ordering-platform-bugreport.pdf",
        fixReport: "docs/qa/2026-06-10-bugfix-report.md",
        results: clips.map((clip) => ({
          id: clip.id,
          title: clip.title,
          bugRefs: clip.bugRefs,
          requirements: clip.requirements,
          video: `docs/qa/bugfix-recordings/${ROUND}/${clip.id}.webm`,
          screenshot: `docs/qa/bugfix-recordings/${ROUND}/${clip.id}.png`,
          explainer: `docs/qa/bugfix-recordings/${ROUND}/${clip.id}.md`,
        })),
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    path.join(OUT_DIR, "README.md"),
    `# Bug-Fix Proof Recordings — QA round ${ROUND}

Generated by \`npm run qa:record-bugfix-demos\` on ${generatedAt}.

Each clip re-executes the reproduction steps from the external QA report
([2026-06-05-ordering-platform-bugreport.pdf](../../2026-06-05-ordering-platform-bugreport.pdf))
and shows the fixed behavior. Bug numbers refer to the traceability table in
[2026-06-10-bugfix-report.md](../../2026-06-10-bugfix-report.md). Every video
has a same-named \`.md\` explainer and \`.png\` final screenshot next to it.

| Clip | Bugs | Requirements | Video | Screenshot | Explainer |
|---|---|---|---|---|---|
${clips
  .map(
    (clip) =>
      `| ${clip.title} | ${clip.bugRefs} | ${clip.requirements} | [webm](${clip.id}.webm) | [png](${clip.id}.png) | [md](${clip.id}.md) |`,
  )
  .join("\n")}

## Not coverable on video

- **QA bug 17 (password recovery)** — the reset flow code is correct, but
  delivery requires a verified sender domain in Resend (the current sandbox
  sender only delivers to the Resend account owner). The same root cause and
  required ops step are demonstrated for invitations in the
  \`bug-15-16-invitation-flow-end-to-end\` clip; once the domain is verified,
  both flows use the identical email path. Failures are now logged server-side.
`,
  );
}

async function ensureServer(): Promise<ChildProcess | null> {
  console.log(`Checking server at ${BASE_URL}...`);
  if (await isServerReady()) {
    console.log("Server already reachable.");
    return null;
  }
  if (!START_SERVER) {
    throw new Error(
      `Server is not reachable at ${BASE_URL}. Start one manually first, or run with DEMO_START_SERVER=true.`,
    );
  }

  console.log("Starting server with npm run dev...");
  const server = spawn("npm", ["run", "dev"], {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });
  childProcesses.add(server);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(1000);
    if (await isServerReady()) {
      console.log("Server ready.");
      return server;
    }
  }

  killProcess(server);
  throw new Error(`Timed out waiting for server at ${BASE_URL}`);
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    throw new Error(
      `Bug-fix recorder lock exists at ${LOCK_FILE}. If no recorder is running, delete it and retry.`,
    );
  }
  await writeFile(
    LOCK_FILE,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), baseUrl: BASE_URL }, null, 2),
    "utf8",
  );
}

async function releaseLock() {
  await rm(LOCK_FILE, { force: true }).catch(() => undefined);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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
