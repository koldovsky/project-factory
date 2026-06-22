// REFERENCE IMPLEMENTATION — automated, headless recording + validation harness.
//
// Replaces the old stack-coupled `record-demos.reference.ts` /
// `record-proof-recordings.reference.ts`. Lessons paid for in a real run:
//   - NEVER use the user's browser and NEVER trigger a Save-As dialog. This runs
//     its OWN background Playwright Chromium, fully headless, no interaction.
//   - "Record" and "prove the requirement" are the SAME step: every clip DRIVES
//     a real flow and ASSERTS the FRs it proves. The assertion IS the validation
//     — a clip that doesn't assert is not evidence.
//   - Pace clips so async content (maps, charts, fetches) actually renders before
//     the screenshot; capture a SETTLED full-page still, not the wrong moment.
//   - Stack-agnostic: needs only a running app at BASE_URL. No DB/ORM imports.
//     Seeding (if any) is a project hook, not baked in here.
//
// Output (consumed by scripts/check-recordings.mjs and the vision-verify workflow):
//   docs/qa/<outDir>/<id>.webm     video
//   docs/qa/<outDir>/<id>.png      settled full-page still
//   docs/qa/<outDir>/<id>.md       explainer (steps -> requirement)
//   docs/qa/<outDir>/manifest.json { results: [{ id, proof, video, screenshot, explainer, asserted }] }
//
// Run: `node scripts/record-demos.mjs`  (env: BASE_URL, OUT_DIR). Requires
// `@playwright/test` (or `playwright`) installed and the app already running.
import { chromium } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = join("docs/qa", process.env.OUT_DIR ?? "demo-recordings");
const VIEWPORT = { width: 1280, height: 800 };
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};
// `settle` paces a clip so async content renders before we screenshot it.
const settle = async (page, ms = 1500) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};

// ---- CLIPS: one per capability. Each `run` DRIVES the flow and ASSERTS the FRs
// it proves (replace these with the project's real flows). `proof` lists the ids.
const CLIPS = [
  {
    id: "01-home-loads",
    title: "Home renders the primary content",
    proof: "FR-1",
    run: async (page) => {
      await page.goto(BASE_URL);
      await settle(page);
      assert(await page.getByRole("heading", { level: 1 }).isVisible(), "an <h1> is visible");
    },
  },
  // … add one clip per capability; the security-negative clip asserts a redirect.
];

async function ensureServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok || res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`app not reachable at ${BASE_URL} — start it first (this harness never launches the user's browser)`);
}

async function main() {
  await ensureServer();
  if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(join(OUT_DIR, "raw"), { recursive: true });
  const browser = await chromium.launch(); // headless by default
  const results = [];
  let anyFailed = false;

  for (const clip of CLIPS) {
    const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: join(OUT_DIR, "raw"), size: VIEWPORT } });
    const page = await context.newPage();
    let asserted = true;
    let error = null;
    try {
      await clip.run(page);
      await settle(page); // settle again before the proof still
    } catch (e) {
      asserted = false;
      anyFailed = true;
      error = e.message;
    }
    const shot = join(OUT_DIR, `${clip.id}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    const video = page.video();
    await page.close();
    await context.close();
    const videoPath = join(OUT_DIR, `${clip.id}.webm`);
    if (video) await video.saveAs(videoPath).catch(() => {});

    await writeFile(
      join(OUT_DIR, `${clip.id}.md`),
      `# ${clip.title}\n\n**Proves:** ${clip.proof}\n\n**Result:** ${asserted ? "asserted ✓" : `FAILED — ${error}`}\n\n![still](${clip.id}.png)\n`,
    );
    results.push({ id: clip.id, title: clip.title, proof: clip.proof, video: videoPath.replaceAll("\\", "/"), screenshot: shot.replaceAll("\\", "/"), explainer: join(OUT_DIR, `${clip.id}.md`).replaceAll("\\", "/"), asserted });
    console.log(`${asserted ? "✓" : "✗"} ${clip.id} (${clip.proof})${error ? ` — ${error}` : ""}`);
  }

  await rm(join(OUT_DIR, "raw"), { recursive: true, force: true });
  await writeFile(join(OUT_DIR, "manifest.json"), `${JSON.stringify({ kind: "demo", results }, null, 2)}\n`);
  await browser.close();
  console.log(`\nwrote ${results.length} clip(s) to ${OUT_DIR}. Validate: node scripts/check-recordings.mjs`);
  // A clip whose assertions failed is NOT evidence — fail so it gets fixed and re-recorded.
  process.exit(anyFailed ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
