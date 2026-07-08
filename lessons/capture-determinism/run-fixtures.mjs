// Lesson fixture runner — capture-determinism.
//
// Proves the pattern executably. A parity capture is trustworthy only if it
// NEUTRALIZES every known non-determinism source before shooting. The runner
// applies the gotchas ledger to each fixture's capture.json and flags every
// un-neutralized hazard. The red capture leaves several live (a clean-looking
// capture that would ghost between runs); the green capture neutralizes all.
//
// The gotchas ledger (each entry a real defect from the parity campaign,
// 2026-07-02-pixel-perfect-forensics.md + follow-on parity work):
//   1. Carousel free-run timers surviving autoplay.stop — stopping autoplay is
//      NOT enough; the free-running interval/RAF timers must be cleared or the
//      slide advances mid-capture.
//   2. Sub-pixel clip-origin ghosts — a non-integer clip origin resamples the
//      raster and leaves 1px anti-aliased ghosts; clip origin must be integer.
//   3. captureBeyondViewport fixed-chrome bleed — beyond-viewport capture
//      duplicates position:fixed chrome down the page; disable it when fixed
//      chrome is present.
//   4. Lazy third-party widgets — late-rendering embeds come back blank under a
//      fast capture path; they must be settled / render-gated first.
//   5. In-context persistence probes — localStorage/cookie/state left from a
//      prior capture perturbs the next one; persistence must be cleared.
//
// Browser-free and deterministic: reads the recorded capture invariants.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function violations(dir) {
  const c = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"));
  const v = [];
  if (!c.carousel?.freeRunTimersCleared)
    v.push("carousel free-run timers not cleared (autoplay.stop alone is insufficient)");
  if (c.clipOrigin !== "integer")
    v.push(`clip origin is "${c.clipOrigin}" — sub-pixel origin ghosts the raster (use integer)`);
  if (c.captureBeyondViewport && c.hasFixedChrome)
    v.push("captureBeyondViewport with fixed chrome present — the fixed bar bleeds down the page");
  if (!c.lazyWidgetsSettled)
    v.push("lazy third-party widget not settled — comes back blank under fast capture");
  if (!c.persistenceCleared)
    v.push("in-context persistence probe not cleared — prior-run state perturbs this capture");
  return v;
}

let bad = 0;
const red = violations(join(here, "fixtures", "red"));
if (red.length >= 3) {
  console.log(`ok    red fixture: ${red.length} un-neutralized hazard(s) => capture NOT deterministic`);
  for (const r of red) console.log(`        - ${r}`);
} else {
  bad += 1;
  console.error(`FAIL  red fixture expected multiple hazards flagged, got ${red.length}`);
}
const green = violations(join(here, "fixtures", "green"));
if (green.length === 0) {
  console.log("ok    green fixture: every known non-determinism source neutralized => deterministic capture");
} else {
  bad += 1;
  console.error(`FAIL  green fixture expected 0 hazards, got ${green.length}: ${green.join("; ")}`);
}

console.log("\nScope: 2 fixture(s)");
console.log(`Result: ${bad ? "FAIL" : "PASS"}`);
process.exit(bad ? 1 : 0);
