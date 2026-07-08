// Red-to-green proof for the PURE decision core of the parity harness
// (scripts/lib/parity-capture.reference.mjs). Plain Node (>= 18), self-contained:
// exits non-zero when any assertion fails. No browser — these are the earned
// ALGORITHMS proven directly on synthetic inputs:
//   - full-subtree diff  : pairSubtree + diffPair (identical -> clean; deltas ->
//                          unpaired + paint + geometry mismatches)
//   - sweep band detection: seriesForBlock + computeBands (aligned tiers -> 0
//                          bands; a narrow-width reflow -> a divergence band)
//   - suite verdict       : rollupVerdict (all layers clean -> passed; any dirty
//                          -> failing)
//   - pixel overlay       : sectionDiff (identical PNGs -> 1.0; different -> < floor)
//   - config loader       : validateConfig (valid -> defaults applied; loosened
//                          floor -> warning; malformed -> errors)
//   - width grids + picks : sweepWidths, pixelWidths, resolveElementSelectors
//
// sectionDiff needs pngjs; it is proven when resolvable (normally, or via
// PARITY_DEPS_DIR) and gracefully reported as skipped otherwise — the pure
// algorithm layers above always run.
//
// Run: node tests/parity-core.test.mjs
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "scripts", "lib", "parity-capture.reference.mjs");
const {
  pairSubtree,
  diffPair,
  seriesForBlock,
  computeBands,
  geomDistance,
  rollupVerdict,
  sectionDiff,
  validateConfig,
  resolveElementSelectors,
  sweepWidths,
  pixelWidths,
  loadDep,
  DEFAULT_FLOORS,
  DEFAULT_PICK_MAP,
  PAINT_KEYS,
} = await import(pathToFileURL(LIB).href);

let passed = 0;
let skipped = 0;
const failed = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok    ${name}`);
  } catch (err) {
    failed.push(name);
    console.error(`FAIL  ${name}\n      ${String(err.message).split("\n").join("\n      ")}`);
  }
}

// ---------- helpers to build synthetic walkSubtree-shaped nodes ----------
function node(key, tag, text, rect, styles = {}) {
  const s = {};
  for (const k of PAINT_KEYS) s[k] = styles[k] ?? "";
  return { path: key, tag, key, text: text ?? "", rect, styles: s };
}
const ROOT = (styles) => node("__root__", "section", "", { x: 0, y: 0, w: 600, h: 300 }, styles);

// ============================================ 1. full-subtree diff (subtree)
await test("subtree diff GREEN: identical subtrees -> 0 unpaired, 0 geometry, 0 paint", () => {
  const ref = [
    ROOT({ backgroundColor: "rgb(255, 255, 255)" }),
    node("h1:Welcome Home", "h1", "Welcome Home", { x: 24, y: 24, w: 300, h: 40 }, { fontSize: "32px", color: "rgb(17, 17, 17)" }),
    node("a:Get Started", "a", "Get Started", { x: 24, y: 90, w: 140, h: 40 }, { backgroundColor: "rgb(17, 85, 204)" }),
  ];
  const local = ref.map((n) => ({ ...n, styles: { ...n.styles }, rect: { ...n.rect } }));
  const { pairs, unpairedRef, unpairedLocal } = pairSubtree(ref, local);
  assert.equal(unpairedRef.length, 0);
  assert.equal(unpairedLocal.length, 0);
  assert.equal(pairs.length, 3);
  const diffs = pairs.flatMap((p) => diffPair(p.ref, p.local));
  assert.deepEqual(diffs, [], `expected no diffs, got ${JSON.stringify(diffs)}`);
});

await test("subtree diff RED: extra local node -> unpaired; bg + rect deltas -> paint + geometry", () => {
  const ref = [
    ROOT({ backgroundColor: "rgb(255, 255, 255)" }),
    node("h1:Welcome Home", "h1", "Welcome Home", { x: 24, y: 24, w: 300, h: 40 }, { fontSize: "32px" }),
    node("a:Get Started", "a", "Get Started", { x: 24, y: 90, w: 140, h: 40 }, { backgroundColor: "rgb(17, 85, 204)" }),
  ];
  const local = [
    ROOT({ backgroundColor: "rgb(255, 238, 238)" }), // tinted hero -> paint mismatch on root
    node("span:NEW", "span", "NEW", { x: 24, y: 20, w: 40, h: 18 }, {}), // extra local-only node -> unpaired
    node("h1:Hello There", "h1", "Hello There", { x: 24, y: 44, w: 300, h: 40 }, { fontSize: "32px" }), // different text -> both unpaired
    node("a:Get Started", "a", "Get Started", { x: 30, y: 90, w: 140, h: 40 }, { backgroundColor: "rgb(17, 85, 204)" }), // x 24->30 -> geometry
  ];
  const { pairs, unpairedRef, unpairedLocal } = pairSubtree(ref, local);
  // "Welcome Home" (ref) and "Hello There" + "NEW" (local) do not pair by key.
  assert.ok(unpairedRef.some((n) => n.key.includes("Welcome Home")), "ref h1 should be unpaired");
  assert.ok(unpairedLocal.some((n) => n.key.includes("NEW")), "local badge should be unpaired");
  assert.ok(unpairedLocal.some((n) => n.key.includes("Hello There")), "local h1 should be unpaired");
  const diffs = pairs.flatMap((p) => diffPair(p.ref, p.local));
  assert.ok(diffs.some((d) => d.kind === "paint" && d.prop === "backgroundColor"), `expected a root bg paint mismatch, got ${JSON.stringify(diffs)}`);
  assert.ok(diffs.some((d) => d.kind === "geometry" && d.prop === "rect.x"), `expected a CTA rect.x geometry mismatch, got ${JSON.stringify(diffs)}`);
});

await test("diffPair: sub-pixel geometry (<=0.5px) and font-quoting normalization are tolerated", () => {
  const a = node("p:hi", "p", "hi", { x: 10, y: 10, w: 100, h: 20 }, { fontFamily: '"Arial", sans-serif' });
  const b = node("p:hi", "p", "hi", { x: 10.4, y: 10, w: 100, h: 20 }, { fontFamily: "Arial, sans-serif" });
  assert.deepEqual(diffPair(a, b), []);
  const c = node("p:hi", "p", "hi", { x: 11, y: 10, w: 100, h: 20 }, {}); // 1px > 0.5 tol
  assert.ok(diffPair(a, c).some((d) => d.prop === "rect.x"));
});

// ============================================ 2. sweep band detection
function geomFingerprint({ aspect, childCount = 3, leafCount = 6 }) {
  return { rootSize: { w: 600, h: Math.round(600 * aspect) }, aspect, childCount, leafCount, leaves: { links: 1, media: 0, form: 0, textLeaf: leafCount - 1 }, children: [] };
}
const SWEEP_WIDTHS = [320, 480, 640, 800, 960, 1120, 1280, 1440];
const SWEEP_STEP = 160;

await test("sweep GREEN: identical tier at every width -> 0 divergence bands", () => {
  const ref = SWEEP_WIDTHS.map(() => geomFingerprint({ aspect: 0.35 }));
  const local = SWEEP_WIDTHS.map(() => geomFingerprint({ aspect: 0.35 }));
  const series = seriesForBlock(SWEEP_WIDTHS, ref, local);
  const { bands } = computeBands(series, SWEEP_STEP);
  assert.equal(bands.length, 0, `expected 0 bands, got ${JSON.stringify(bands)}`);
});

await test("sweep RED: local stacks below 900px (tall aspect) -> a divergence band at narrow widths", () => {
  // reference stays a row (short block) at every width; local stacks below 900px
  // (much taller -> big aspect delta) at 320..800, aligned at 960..1440.
  const ref = SWEEP_WIDTHS.map(() => geomFingerprint({ aspect: 0.35 }));
  const local = SWEEP_WIDTHS.map((w) => geomFingerprint({ aspect: w <= 900 ? 1.25 : 0.35 }));
  const series = seriesForBlock(SWEEP_WIDTHS, ref, local);
  const { bands, baseline, threshold } = computeBands(series, SWEEP_STEP);
  assert.ok(bands.length >= 1, `expected >=1 band, got ${JSON.stringify({ bands, baseline, threshold })}`);
  const b = bands[0];
  assert.ok(b.from <= 320 && b.to >= 800, `band should cover the narrow reflow zone, got ${b.from}-${b.to}`);
  assert.equal(b.regime, "shape"); // same child/leaf census, divergent aspect
});

await test("sweep RED (tier): local drops visible leaves below 900px -> a 'tier' band", () => {
  const ref = SWEEP_WIDTHS.map(() => geomFingerprint({ aspect: 0.35, leafCount: 8 }));
  const local = SWEEP_WIDTHS.map((w) => geomFingerprint({ aspect: 0.35, leafCount: w <= 900 ? 3 : 8 }));
  const series = seriesForBlock(SWEEP_WIDTHS, ref, local);
  const { bands } = computeBands(series, SWEEP_STEP);
  assert.ok(bands.length >= 1 && bands.some((b) => b.regime === "tier"), `expected a tier band, got ${JSON.stringify(bands)}`);
});

await test("geomDistance: missing geometry is a full divergence; count mismatch dominates aspect wobble", () => {
  assert.equal(geomDistance(null, geomFingerprint({ aspect: 0.3 })).dist, 1);
  const a = geomFingerprint({ aspect: 0.3, childCount: 3 });
  const b = geomFingerprint({ aspect: 0.31, childCount: 4 });
  assert.ok(geomDistance(a, b).dist >= 0.5, "top-level child count mismatch is weighted 0.5");
});

// ============================================ 3. suite verdict rollup
await test("verdict GREEN: all layers clean -> passed/met, byWidth all true", () => {
  const v = rollupVerdict({
    contentDiffs: [],
    elementDiffs: [],
    minOverlayScore: 1,
    hoverDiffs: [],
    behaviourFails: 0,
    byWidth: { "768": true, "1440": true },
    floor: 0.985,
  });
  assert.equal(v.pass, true);
  assert.equal(v.status, "passed");
  assert.equal(v.met, true);
  for (const L of ["L1_content", "L2_elementStyle", "L3_overlay", "L4_behavior", "L5_breakpoints"]) assert.equal(v.layers[L].pass, true);
});

await test("verdict RED: content diff + below-floor overlay -> failing, L1/L3/L5 fail", () => {
  const v = rollupVerdict({
    contentDiffs: [{ section: "01-hero" }],
    elementDiffs: [],
    minOverlayScore: 0.71,
    hoverDiffs: [],
    behaviourFails: 0,
    byWidth: { "768": false, "1440": false },
    floor: 0.985,
  });
  assert.equal(v.pass, false);
  assert.equal(v.status, "failing");
  assert.equal(v.layers.L1_content.pass, false);
  assert.equal(v.layers.L3_overlay.pass, false);
  assert.equal(v.layers.L5_breakpoints.pass, false);
});

// ============================================ 4. config loader
await test("validateConfig: valid config applies floor/sweep/pickMap defaults", () => {
  const { config, errors } = validateConfig({
    referenceUrl: "https://reference.example/",
    localUrl: "http://localhost:3000/",
    breakpoints: [{ name: "1440", width: 1440, height: 900 }],
    sections: [{ id: "01-hero", label: "Hero", local: ".hero", live: ".hero" }],
  });
  assert.deepEqual(errors, []);
  assert.equal(config.floors.sectionScoreFloor, DEFAULT_FLOORS.sectionScoreFloor);
  assert.equal(config.sweep.step, 16);
  assert.equal(config.pickMap.heading, DEFAULT_PICK_MAP.heading);
  assert.deepEqual(config.canonicalWidths, [1440]);
  assert.equal(config.widthHeights["1440"], 900);
});

await test("validateConfig: missing urls / empty sections / bad breakpoint name -> errors, config null", () => {
  const { config, errors } = validateConfig({ breakpoints: [{ name: "a b", width: 1, height: 1 }], sections: [] });
  assert.equal(config, null);
  assert.ok(errors.some((e) => e.includes("referenceUrl")));
  assert.ok(errors.some((e) => e.includes("localUrl")));
  assert.ok(errors.some((e) => e.includes("sections")));
  assert.ok(errors.some((e) => e.includes("[A-Za-z0-9._-]+")));
});

await test("validateConfig: loosening sectionScoreFloor emits a warning (never silent)", () => {
  const { warnings, errors } = validateConfig({
    referenceUrl: "https://reference.example/",
    localUrl: "http://localhost:3000/",
    breakpoints: [{ name: "d", width: 1, height: 1 }],
    sections: [{ id: "s", label: "s", local: "x", live: "x" }],
    floors: { sectionScoreFloor: 0.9 },
  });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("below the signed default")));
});

// ============================================ 5. width grids + picks
await test("sweepWidths / pixelWidths: grid-aligned, max always included, fine sub-band overlaid", () => {
  const w = sweepWidths(16, { min: 320, max: 1920, step: 16 });
  assert.equal(w[0], 320);
  assert.equal(w[w.length - 1], 1920);
  assert.ok(w.includes(992) && w.includes(1440));
  const px = pixelWidths(64, { fine: 32, fineFrom: 992, fineTo: 1440 }, { min: 320, max: 1920, pixelStep: 64 });
  assert.ok(px.includes(320) && px.includes(1920));
  assert.ok(px.includes(1024), "fine 32px grid over 992..1440 should include 1024");
  assert.ok(px.every((x, i) => i === 0 || x > px[i - 1]), "ascending + de-duplicated");
});

await test("resolveElementSelectors: pick resolves via pickMap; custom passes through", () => {
  const section = { local: ".hero", live: "section.hero" };
  const r = resolveElementSelectors({ key: "h", section: "01", pick: "heading", index: 0 }, section, DEFAULT_PICK_MAP);
  assert.equal(r.local, `.hero ${DEFAULT_PICK_MAP.heading} >> nth=0`);
  assert.equal(r.live, `section.hero ${DEFAULT_PICK_MAP.heading} >> nth=0`);
  const c = resolveElementSelectors({ custom: true, local: "#a", live: "#b" }, section, DEFAULT_PICK_MAP);
  assert.deepEqual(c, { local: "#a", live: "#b" });
});

// ============================================ 6. pixel overlay (needs pngjs)
await test("sectionDiff: identical PNGs score 1.0; a large delta scores below the 0.985 floor", async () => {
  let PNGmod;
  try {
    PNGmod = await loadDep("pngjs");
  } catch {
    skipped += 1;
    console.log("      (skipped: pngjs not resolvable — set PARITY_DEPS_DIR or `npm i -D pngjs pixelmatch`)");
    return;
  }
  const { PNG } = PNGmod;
  const solid = (w, h, [r, g, b]) => {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
    return PNG.sync.write(png);
  };
  const white = solid(40, 40, [255, 255, 255]);
  const green = await sectionDiff(white, solid(40, 40, [255, 255, 255]), DEFAULT_FLOORS);
  assert.equal(green.score, 1, "identical images must score exactly 1.0");
  const red = await sectionDiff(white, solid(40, 40, [0, 0, 0]), DEFAULT_FLOORS);
  assert.ok(red.score < DEFAULT_FLOORS.sectionScoreFloor, `a fully-different image must score below the floor, got ${red.score}`);
  assert.ok(red.diffPng && red.blendPng, "diff + blend PNGs are emitted");
});

console.log(`\nparity-core.test: ${passed} passed, ${failed.length} failed, ${skipped} skipped${failed.length ? ` (${failed.join(", ")})` : ""}`);
process.exit(failed.length ? 1 : 0);
