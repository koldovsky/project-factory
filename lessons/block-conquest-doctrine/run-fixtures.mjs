// Lesson fixture runner — block-conquest-doctrine.
//
// Proves the pattern executably by scoring the SAME candidate two ways:
//
//   PAGE-AVERAGE  — the naive verdict: mean per-block pixel score >= floor.
//                   A single high scalar; blind to categorical defects.
//   BLOCK-CONQUEST — the doctrine: DONE iff EVERY block independently meets its
//                   definition-of-done — unpaired 0 / geometry 0 / paint 0 /
//                   asset 0 / pixel >= floor.
//
// The red candidate is engineered so the page average passes (~0.9965 >= floor)
// while the `hero` block is NOT done (3 unpaired, 1 geometry break, 1 missing
// asset the scalar cannot see). Per-block conquest catches what the average
// hides. The green candidate drives every block to DoD, so both verdicts agree.
//
// Grounded (abstractly) in the multi-layer visual-parity campaign: the
// full-page pixel scalar (desktop ~0.9449 / mobile ~0.9052) was DEMOTED to
// telemetry precisely because a page average launders per-block debt; the
// acceptance roll-up became per-section overlay >= floor with zero unpaired /
// geometry / paint / asset per block. The feedback loop that made this
// tractable was the OVERLAY / ONION-SKIN pattern — difference-blend and 50%
// onion-skin composites per section, reviewed by eye/vision, so a block's
// residual is localized and driven to zero before moving on.
//
// Browser-free and deterministic: per-block metrics are read from the
// candidate page's <section data-block ...> attributes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FLOOR = 0.985;
const DOD_DIMS = ["unpaired", "geometry", "paint", "asset"];

function parseBlocks(html) {
  const blocks = [];
  for (const m of html.matchAll(/<section\s+([^>]*data-block[^>]*)>/g)) {
    const attrs = m[1];
    const get = (name) => {
      const a = attrs.match(new RegExp(`data-${name}="([^"]+)"`));
      return a ? a[1] : null;
    };
    blocks.push({
      id: get("block"),
      pixel: Number(get("pixel")),
      unpaired: Number(get("unpaired")),
      geometry: Number(get("geometry")),
      paint: Number(get("paint")),
      asset: Number(get("asset")),
    });
  }
  return blocks;
}

function score(dir) {
  const blocks = parseBlocks(readFileSync(join(dir, "candidate.html"), "utf8"));
  const avg = blocks.reduce((s, b) => s + b.pixel, 0) / blocks.length;
  const pageAveragePass = avg >= FLOOR;
  const notDone = [];
  for (const b of blocks) {
    const fails = DOD_DIMS.filter((d) => b[d] !== 0);
    if (b.pixel < FLOOR) fails.push(`pixel ${b.pixel} < ${FLOOR}`);
    if (fails.length) notDone.push({ id: b.id, fails });
  }
  return { avg, pageAveragePass, conquestPass: notDone.length === 0, notDone };
}

let bad = 0;
const red = score(join(here, "fixtures", "red"));
// The teaching contract: page-average GREEN, conquest RED on the same input.
if (red.pageAveragePass && !red.conquestPass && red.notDone.some((b) => b.id === "hero")) {
  console.log(`ok    red fixture: page-average PASS (avg ${red.avg.toFixed(4)}) but conquest FAIL — ${red.notDone.map((b) => `${b.id}[${b.fails.join(",")}]`).join(" ")}`);
} else {
  bad += 1;
  console.error(`FAIL  red fixture expected page-average PASS + conquest FAIL(hero), got avg=${red.avg.toFixed(4)} pageAverage=${red.pageAveragePass} conquest=${red.conquestPass}`);
}
const green = score(join(here, "fixtures", "green"));
if (green.pageAveragePass && green.conquestPass) {
  console.log(`ok    green fixture: every block meets DoD — page-average and conquest agree (avg ${green.avg.toFixed(4)})`);
} else {
  bad += 1;
  console.error(`FAIL  green fixture expected both verdicts PASS, got pageAverage=${green.pageAveragePass} conquest=${green.conquestPass} notDone=${JSON.stringify(green.notDone)}`);
}

console.log("\nScope: 2 fixture(s)");
console.log(`Result: ${bad ? "FAIL" : "PASS"}`);
process.exit(bad ? 1 : 0);
