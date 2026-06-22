// REFERENCE IMPLEMENTATION — accessibility / contrast gate (axe-core).
//
// Runs axe-core (WCAG 2 A/AA, incl. color-contrast) headless against the running
// app, in BOTH light and dark color schemes, over the configured routes. Fails
// on serious/critical violations.
//
// IMPORTANT: axe is necessary but NOT sufficient. In a real run axe passed an app
// a human (and the vision-judge) judged poorly contrasted. ALWAYS pair this with
// the vision-verify workflow — structural a11y here, eyes-on-pixels there.
//
// Requires `@playwright/test` + `@axe-core/playwright`, and the app running.
// Run: `node scripts/check-a11y.mjs`  (env: BASE_URL, A11Y_ROUTES="/,/about").
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ROUTES = (process.env.A11Y_ROUTES ?? "/").split(",").map((s) => s.trim()).filter(Boolean);
const SCHEMES = ["light", "dark"];

async function ensureServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE_URL);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`app not reachable at ${BASE_URL} — start it first`);
}

const failures = [];
async function main() {
  await ensureServer();
  const browser = await chromium.launch();
  for (const colorScheme of SCHEMES) {
    const ctx = await browser.newContext({ colorScheme });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      try {
        await page.goto(BASE_URL + route, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle").catch(() => {});
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        for (const v of violations) {
          if (v.impact === "serious" || v.impact === "critical") {
            failures.push(`[${colorScheme}] ${route} — ${v.id} (${v.impact}, ${v.nodes.length} node(s)): ${v.help}`);
          }
        }
      } catch (e) {
        failures.push(`[${colorScheme}] ${route} — could not analyze: ${e.message}`);
      }
    }
    await ctx.close();
  }
  await browser.close();

  for (const f of failures) console.error(`FAIL  ${f}`);
  console.log(`\na11y: ${ROUTES.length} route(s) × ${SCHEMES.length} scheme(s) — ${failures.length} serious/critical violation(s).`);
  console.log(failures.length ? "Fix the violations, then re-run. (Also run vision-verify — axe misses perceived contrast.)" : "axe clean. Still run vision-verify for eyes-on-pixels.");
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
