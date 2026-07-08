// REFERENCE IMPLEMENTATION — block-by-block parity depth + continuum sweep.
//
// The suite (check-parity-suite) gates per breakpoint; this tool conquers ONE
// block at a time to reach and prove pixel parity, and sweeps a CONTINUOUS width
// range so no responsive tier can hide between the canonical samples. Both modes
// are driven by quality/parity.config.json — no site-specific value lives here.
//
// PIXEL-DEPTH MODE (single block, one or many widths):
//   node scripts/parity-block-loop.mjs --block <id> --width <px|all>
//     [--config quality/parity.config.json] [--out docs/qa/parity/blocks]
//   For each width it runs, against the block subtree on both sites:
//     A. CLIP CAPTURE     — element (bounding-box) screenshot -> ref/local/diff/
//                           overlay PNGs + an AA-tolerant pixel score.
//     B. FULL-SUBTREE DIFF — walk EVERY visible node, LCS-pair (wrapper-div
//                           tolerant), diff sub-pixel geometry + every paint prop;
//                           UNPAIRED nodes are structural deltas.
//     C. ASSET BYTE PARITY — hash every loaded <img>/background-image both sides.
//     D. VERDICT           — PERFECT only when unpaired=0, geometry=0, paint=0,
//                           asset=0, and pixel >= floors.sectionScoreFloor.
//   <width> is ANY integer in [widthRange.min..max] (arbitrary widths are first-
//   class — a between-canonical width is exactly where responsive-tier gaps hide),
//   or "all" (the config.canonicalWidths).
//
// CONTINUUM SWEEP MODE (geometry BANDS + PIXEL channel):
//   node scripts/parity-block-loop.mjs --sweep [step] --block <id|all>
//     [--tol 0.05] [--pixel-step 64] [--pixel-fine 32] [--no-pixel]
//     [--sweep-out docs/qa/parity/sweep]
//   The GEOMETRY channel takes a fast DOM fingerprint of the block(s) at every
//   swept width and reports tier-divergence BANDS (widths where the two sites sit
//   in DIFFERENT responsive tiers). The PIXEL channel (on by default) screenshots
//   + AA-scores the block at a COARSER grid plus a finer sub-band, catching same-
//   tier pixel drift the geometry channel is blind to.
//
//   IMPORTANT: a geometry-only result of 0 divergence bands does NOT mean pixel-
//   perfect — two sites can share aspect/child-count/leaf-census yet still render
//   materially different pixels between samples. That is exactly why the pixel
//   channel exists; the sweep prints this caveat and FAILS on any geometry band OR
//   any below-floor pixel sample.
//
// Capture is DOWNWARD (widest -> narrowest): a JS nav collapses as the viewport
// shrinks but does not re-expand on grow (a resize-up hysteresis), so prepping at
// max + sweeping down shows the layout a fresh load at each width would.
//
// English comments/output only.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  writeJson,
  writeArtifact,
  sectionDiff,
  preparePage,
  gotoWithRetry,
  validateConfig,
  isDependencyError,
  loadDep,
  INSTALL_HINT,
  PAINT_KEYS,
  reSettle,
  captureElement,
  walkSubtree,
  pairSubtree,
  diffPair,
  collectAssets,
  assetParity,
  sweepWidths,
  pixelWidths,
  captureGeom,
  geomDistance,
  seriesForBlock,
  sweepSettle,
  pixelPassSettle,
  computeBands,
} from "./lib/parity-capture.reference.mjs";

const DEFAULTS = Object.freeze({ configPath: "quality/parity.config.json", outDir: "docs/qa/parity/blocks", sweepOutDir: "docs/qa/parity/sweep" });

function parseArgs(argv) {
  const get = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : d;
  };
  const sweepIdx = argv.indexOf("--sweep");
  const sweep = sweepIdx >= 0;
  let sweepStepOverride;
  if (sweep) {
    const next = argv[sweepIdx + 1];
    if (next !== undefined && /^\d+$/.test(next)) sweepStepOverride = Number(next);
  }
  const numOr = (name, d) => {
    const v = get(name, undefined);
    return v !== undefined ? Number(v) : d;
  };
  return {
    block: get("--block", ""),
    width: get("--width", ""),
    configPath: get("--config", DEFAULTS.configPath),
    outDir: get("--out", DEFAULTS.outDir),
    sweep,
    sweepStepOverride,
    tolOverride: numOr("--tol", undefined),
    sweepOutDir: get("--sweep-out", DEFAULTS.sweepOutDir),
    pixel: argv.indexOf("--no-pixel") < 0,
    pixelStepOverride: numOr("--pixel-step", undefined),
    pixelFineOverride: numOr("--pixel-fine", undefined),
    pixelFineFromOverride: numOr("--pixel-fine-from", undefined),
    pixelFineToOverride: numOr("--pixel-fine-to", undefined),
  };
}

function fail(msg, scope = "Scope: 0 block(s)") {
  console.error(`FAIL  [block-loop] ${msg}`);
  console.log(`\n${scope}`);
  console.log(`Result: FAIL`);
  process.exit(1);
}

function resolveWidths(widthArg, config) {
  if (String(widthArg).toLowerCase() === "all") return [...config.canonicalWidths];
  const w = Number(widthArg);
  const { min, max } = config.widthRange;
  if (!Number.isInteger(w) || w < min || w > max) throw new Error(`--width must be an integer ${min}..${max} or "all" (got "${widthArg}")`);
  return [w];
}

const heightFor = (config, width) => config.widthHeights[String(width)] || 900;

// ------------------------ pixel-depth: A/B/C/D for one block at one width -----
async function runBlockAtWidth({ section, width, pages, config, outAbs }) {
  const height = heightFor(config, width);
  const dir = `${section.id}/${width}`;
  const floor = config.floors.sectionScoreFloor;
  const pins = config.prepare.pinScripts;

  for (const role of ["reference", "local"]) await pages[role].page.setViewportSize({ width, height });
  const sel = { reference: section.live, local: section.local };
  for (const role of ["reference", "local"]) await reSettle(pages[role].page, sel[role], pins);

  // A. CLIP CAPTURE
  const capRef = await captureElement(pages.reference.page, section.live, { pinScripts: pins });
  const capLocal = await captureElement(pages.local.page, section.local, { pinScripts: pins });
  let pixel = { score: null, wDelta: null, hDelta: null };
  if (!capRef || !capLocal) {
    writeJson(outAbs(`${dir}/score.json`), { block: section.id, width, score: null, reason: `${!capRef ? "reference" : "local"} block not captured` });
  } else {
    const d = await sectionDiff(capRef.png, capLocal.png, config.floors);
    writeArtifact(outAbs(`${dir}/ref.png`), capRef.png);
    writeArtifact(outAbs(`${dir}/local.png`), capLocal.png);
    writeArtifact(outAbs(`${dir}/diff.png`), d.diffPng);
    writeArtifact(outAbs(`${dir}/overlay.png`), d.blendPng);
    pixel = { score: d.score, wDelta: d.wDelta, hDelta: d.hDelta };
    writeJson(outAbs(`${dir}/score.json`), { block: section.id, width, score: d.score, wDelta: d.wDelta, hDelta: d.hDelta, refSize: { w: d.refW, h: d.refH }, localSize: { w: d.localW, h: d.localH }, floor });
  }

  // B. FULL-SUBTREE DIFF
  const refTree = await walkSubtree(pages.reference.page, section.live, PAINT_KEYS);
  const localTree = await walkSubtree(pages.local.page, section.local, PAINT_KEYS);
  const refNodes = refTree?.nodes ?? [];
  const localNodes = localTree?.nodes ?? [];
  const { pairs, unpairedRef, unpairedLocal } = pairSubtree(refNodes, localNodes);
  const geometry = [];
  const paint = [];
  for (const p of pairs) for (const d of diffPair(p.ref, p.local, config.floors)) (d.kind === "geometry" ? geometry : paint).push(d);
  const structural = [
    ...unpairedRef.map((nd) => ({ side: "reference-only", path: nd.path, role: `${nd.tag}${nd.text ? ` "${nd.text}"` : ""}`, key: nd.key, rect: nd.rect })),
    ...unpairedLocal.map((nd) => ({ side: "local-only", path: nd.path, role: `${nd.tag}${nd.text ? ` "${nd.text}"` : ""}`, key: nd.key, rect: nd.rect })),
  ];
  writeJson(outAbs(`${dir}/subtree-diff.json`), {
    block: section.id,
    width,
    counts: { referenceNodes: refNodes.length, localNodes: localNodes.length, paired: pairs.length, unpaired: structural.length, geometryMismatches: geometry.length, paintMismatches: paint.length },
    rootSize: { reference: refTree?.rootSize ?? null, local: localTree?.rootSize ?? null },
    structural,
    geometry,
    paint,
  });

  // C. ASSET BYTE PARITY
  const refAssets = await collectAssets(pages.reference.page, section.live);
  const localAssets = await collectAssets(pages.local.page, section.local);
  const { entries: assetEntries, checked: assetChecked } = await assetParity(refAssets, localAssets, config.floors);
  writeJson(outAbs(`${dir}/asset-diff.json`), { block: section.id, width, counts: { referenceAssets: refAssets.length, localAssets: localAssets.length, checked: assetChecked, mismatches: assetEntries.length }, entries: assetEntries });

  // D. VERDICT
  const captured = pixel.score !== null;
  const perfect = captured && structural.length === 0 && geometry.length === 0 && paint.length === 0 && assetEntries.length === 0 && pixel.score >= floor;
  const verdict = { block: section.id, width, perfect, pixel: pixel.score, floor, unpaired: structural.length, geometryMismatches: geometry.length, paintMismatches: paint.length, assetMismatches: assetEntries.length, captured };
  writeJson(outAbs(`${dir}/verdict.json`), verdict);
  return verdict;
}

// -------------------------------- continuum sweep -----------------------------
function writeSweepBlock(sweepAbs, section, widths, step, tol, series, pixel, floor, config) {
  const { baseline, threshold, bands } = computeBands(series, step, { ...config.sweep, tol });
  const pixelSamples = pixel?.samples ?? [];
  const pixelBelowFloor = pixelSamples.filter((p) => p.belowFloor).map((p) => ({ width: p.width, score: p.score, wDelta: p.wDelta, hDelta: p.hDelta }));
  const pixelUncaptured = pixelSamples.filter((p) => p.score === null).map((p) => ({ width: p.width, reason: p.reason }));
  const pixelMin = pixelSamples.reduce((m, p) => (p.score !== null && (m === null || p.score < m) ? p.score : m), null);
  const out = {
    block: section.id,
    label: section.label,
    generatedAt: new Date().toISOString(),
    mode: "continuum-sweep",
    range: { from: widths[0], to: widths[widths.length - 1], step },
    caveat: "GEOMETRY-ONLY 0 bands does NOT mean pixel-perfect — same-tier pixel drift is invisible to the geometry channel; consult the pixel channel below.",
    tol,
    baseline,
    threshold,
    divergenceBands: bands,
    verdict: bands.length === 0 ? "aligned" : "divergent",
    pixel: pixel
      ? { enabled: true, floor, step: pixel.step, fine: pixel.fine, fineRange: pixel.fine ? { from: pixel.fineFrom, to: pixel.fineTo } : null, count: pixelSamples.length, min: pixelMin, verdict: pixelBelowFloor.length === 0 && pixelUncaptured.length === 0 ? "aligned" : "below-floor", belowFloor: pixelBelowFloor, uncaptured: pixelUncaptured, samples: pixelSamples }
      : { enabled: false },
    series,
  };
  writeJson(sweepAbs(`${section.id}.json`), out);
  return { block: section.id, label: section.label, bands, baseline, threshold, pixelSamples, pixelBelowFloor, pixelUncaptured, pixelMin };
}

async function capturePixelSample({ sweepAbs, section, width, pages, config }) {
  const floor = config.floors.sectionScoreFloor;
  const pins = config.prepare.pinScripts;
  const grab = async () => ({
    capRef: await captureElement(pages.reference.page, section.live, { pinScripts: pins }),
    capLocal: await captureElement(pages.local.page, section.local, { pinScripts: pins }),
  });
  let { capRef, capLocal } = await grab();
  if (!capRef || !capLocal) {
    await pages.reference.page.waitForTimeout(150);
    ({ capRef, capLocal } = await grab());
  }
  if (!capRef || !capLocal) return { width, score: null, wDelta: null, hDelta: null, belowFloor: false, reason: `${!capRef ? "reference" : "local"} block not captured` };
  const d = await sectionDiff(capRef.png, capLocal.png, config.floors);
  const belowFloor = d.score < floor;
  if (belowFloor) {
    writeJson(sweepAbs(`${section.id}/${width}/score.json`), { block: section.id, width, score: d.score, floor, wDelta: d.wDelta, hDelta: d.hDelta, channel: "pixel-sweep", note: "diff/overlay PNGs regenerate on demand via pixel-depth mode: --block <id> --width <w>" });
  }
  return { width, score: d.score, wDelta: d.wDelta, hDelta: d.hDelta, belowFloor };
}

async function prepSweepSites(launch, config, prepWidth) {
  const browser = await launch();
  const pages = {};
  for (const [role, url] of [
    ["reference", config.referenceUrl],
    ["local", config.localUrl],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: prepWidth, height: config.sweep.viewportHeight }, reducedMotion: "reduce", deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await gotoWithRetry(page, url, { retries: 2, timeout: 90000 });
    await preparePage(page, config, { role });
    pages[role] = { ctx, page };
  }
  return { browser, pages };
}

async function runSweep({ launch, config, args, sections }) {
  const step = args.sweepStepOverride ?? config.sweep.step;
  const tol = args.tolOverride ?? config.sweep.tol;
  const pixelStep = args.pixelStepOverride ?? config.sweep.pixelStep;
  const pixelFine = args.pixelFineOverride ?? config.sweep.pixelFine;
  const pixelFineFrom = args.pixelFineFromOverride ?? config.sweep.pixelFineFrom;
  const pixelFineTo = args.pixelFineToOverride ?? config.sweep.pixelFineTo;
  const floor = config.floors.sectionScoreFloor;

  const widths = sweepWidths(step, config.sweep); // ascending geometry grid
  const geomWidthSet = new Set(widths);
  const pxList = args.pixel ? pixelWidths(pixelStep, { fine: pixelFine, fineFrom: pixelFineFrom, fineTo: pixelFineTo }, config.sweep) : [];
  const pixelWidthSet = new Set(pxList);
  const allWidths = [...new Set([...widths, ...pxList])].sort((a, b) => a - b);
  const captureOrder = [...allWidths].reverse();
  const sweepAbs = (rel) => join(process.cwd(), args.sweepOutDir, rel);
  const t0 = Date.now();

  const { browser, pages } = await prepSweepSites(launch, config, allWidths[allWidths.length - 1]);
  const n = widths.length;
  const geomRef = Object.fromEntries(sections.map((s) => [s.id, new Array(n)]));
  const geomLocal = Object.fromEntries(sections.map((s) => [s.id, new Array(n)]));
  const pixelSamplesById = Object.fromEntries(sections.map((s) => [s.id, []]));

  try {
    for (const width of captureOrder) {
      if (geomWidthSet.has(width)) {
        const ascIdx = widths.indexOf(width);
        for (const role of ["reference", "local"]) await pages[role].page.setViewportSize({ width, height: config.sweep.viewportHeight });
        for (const role of ["reference", "local"]) await sweepSettle(pages[role].page);
        for (const s of sections) {
          geomRef[s.id][ascIdx] = await captureGeom(pages.reference.page, s.live);
          geomLocal[s.id][ascIdx] = await captureGeom(pages.local.page, s.local);
        }
      }
      if (pixelWidthSet.has(width)) {
        const pxHeight = heightFor(config, width);
        for (const role of ["reference", "local"]) await pages[role].page.setViewportSize({ width, height: pxHeight });
        for (const role of ["reference", "local"]) await pixelPassSettle(pages[role].page, config.prepare.pinScripts);
        for (const s of sections) pixelSamplesById[s.id].push(await capturePixelSample({ sweepAbs, section: s, width, pages, config }));
      }
    }
  } finally {
    await pages.reference?.ctx.close().catch(() => {});
    await pages.local?.ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  for (const s of sections) pixelSamplesById[s.id].sort((a, b) => a.width - b.width);

  const summaries = [];
  for (const s of sections) {
    const series = seriesForBlock(widths, geomRef[s.id], geomLocal[s.id]);
    const pixel = args.pixel ? { samples: pixelSamplesById[s.id], step: pixelStep, fine: pixelFine, fineFrom: pixelFineFrom, fineTo: pixelFineTo } : null;
    summaries.push(writeSweepBlock(sweepAbs, s, widths, step, tol, series, pixel, floor, config));
  }

  const totalPixelBelowFloor = summaries.reduce((a, s) => a + s.pixelBelowFloor.length, 0);
  const totalPixelUncaptured = summaries.reduce((a, s) => a + s.pixelUncaptured.length, 0);

  const elapsed = Math.round((Date.now() - t0) / 100) / 10;
  const pxTag = args.pixel ? ` + pixel [${pxList.length} widths/block, step ${pixelStep}${pixelFine ? `, fine ${pixelFine}@${pixelFineFrom}-${pixelFineTo}` : ""}]` : "";
  console.log(`\nContinuum sweep: ${widths.length} geometry widths [${widths[0]}..${widths[widths.length - 1]} step ${step}]${pxTag} x ${sections.length} block(s), ${elapsed}s (tol ${tol})`);
  console.log(`NOTE: geometry-only 0 bands != pixel-perfect — the pixel channel below catches same-tier drift the geometry channel cannot see.`);
  let totalBands = 0;
  for (const s of summaries) {
    totalBands += s.bands.length;
    const pxNote = args.pixel && s.pixelSamples.length ? `  | pixel min ${s.pixelMin ?? "n/a"} (${s.pixelBelowFloor.length} below floor${s.pixelUncaptured.length ? `, ${s.pixelUncaptured.length} uncaptured` : ""})` : "";
    if (s.bands.length === 0) {
      console.log(`  [${s.block}] geom ALIGNED — 0 bands (baseline ${s.baseline}, threshold ${s.threshold})${pxNote}`);
    } else {
      console.log(`  [${s.block}] geom DIVERGENT — ${s.bands.length} band(s)${pxNote}:`);
      for (const b of s.bands) {
        console.log(`     ${b.from}-${b.to}px  [${b.severity}/${b.regime}]  peak d${b.peakDist}@${b.peakAtWidth}  [${b.leadingEdge.attribution}]`);
        console.log(`        ${b.evidence}`);
      }
    }
    for (const p of s.pixelBelowFloor) console.log(`     PIXEL BELOW FLOOR ${s.block}@${p.width}px: ${p.score} (floor ${floor}, wDelta ${p.wDelta}/hDelta ${p.hDelta})`);
    for (const p of s.pixelUncaptured) console.log(`     PIXEL UNCAPTURED ${s.block}@${p.width}px: ${p.reason}`);
  }
  const clean = totalBands === 0 && totalPixelBelowFloor === 0 && totalPixelUncaptured === 0;
  console.log(`\nScope: continuum sweep ${sections.map((s) => s.id).join(",")} — ${widths.length} geometry widths${args.pixel ? ` + ${pxList.length} pixel widths/block` : ""}`);
  console.log(`Result: ${clean ? "ALIGNED" : "DIVERGENT"} — ${totalBands} geometry band(s), ${totalPixelBelowFloor} pixel sample(s) below floor${totalPixelUncaptured ? `, ${totalPixelUncaptured} uncaptured` : ""}. Artifacts: ${args.sweepOutDir}/`);
  return clean;
}

// ---------------------------------------------------------------- adapters
async function defaultLaunch() {
  const pw = await loadDep("playwright");
  const chromium = pw.chromium ?? pw.default?.chromium;
  return chromium.launch({ headless: true });
}

// ------------------------------------------------------------------- main
async function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const configAbs = join(root, args.configPath);
  if (!existsSync(configAbs)) fail(`config not found at ${args.configPath} — copy templates/quality/parity.config.template.json to ${args.configPath} and edit.`);

  let raw;
  try {
    raw = JSON.parse(readFileSync(configAbs, "utf8"));
  } catch (err) {
    fail(`${args.configPath} is not valid JSON: ${err.message}`);
  }
  const { config, errors, warnings } = validateConfig(raw);
  for (const w of warnings) console.warn(`WARN  [block-loop] ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`FAIL  [config] ${e}`);
    fail(`invalid config`);
  }

  let launch = defaultLaunch;
  const adapterPath = process.env.CHECK_PARITY_ADAPTERS;
  if (adapterPath) {
    const mod = await import(pathToFileURL(resolve(root, adapterPath)).href);
    if (typeof mod.launch === "function") launch = mod.launch;
    console.log(`(browser adapter injected from ${adapterPath})`);
  }
  const guardedLaunch = async () => {
    try {
      return await launch();
    } catch (err) {
      if (isDependencyError(err)) fail(`${err.message}. Install: ${err.install ?? INSTALL_HINT}. Missing tooling is a FAILURE, never a pass.`);
      throw err;
    }
  };

  // -------- CONTINUUM SWEEP MODE --------
  if (args.sweep) {
    let sections;
    if (!args.block || args.block === "all") sections = config.sections;
    else {
      const one = config.sections.find((s) => s.id === args.block);
      if (!one) fail(`unknown block "${args.block}" (valid: all, ${config.sections.map((s) => s.id).join(", ")})`);
      sections = [one];
    }
    let clean;
    try {
      clean = await runSweep({ launch: guardedLaunch, config, args, sections });
    } catch (err) {
      if (isDependencyError(err)) fail(`${err.message}. Install: ${err.install ?? INSTALL_HINT}. Missing tooling is a FAILURE, never a pass.`, "Scope: continuum sweep");
      throw err;
    }
    process.exit(clean ? 0 : 1);
  }

  // -------- PIXEL-DEPTH MODE --------
  if (!args.block) fail(`--block <id> is required (one of: ${config.sections.map((s) => s.id).join(", ")})`);
  const section = config.sections.find((s) => s.id === args.block);
  if (!section) fail(`unknown block "${args.block}" (valid: ${config.sections.map((s) => s.id).join(", ")})`);
  if (!args.width) fail(`--width <px|all> is required (integer ${config.widthRange.min}..${config.widthRange.max} or "all")`);

  let widths;
  try {
    widths = resolveWidths(args.width, config);
  } catch (err) {
    fail(err.message);
  }

  const outAbs = (rel) => join(root, args.outDir, rel);
  const browser = await guardedLaunch();
  const first = widths[0];
  const pages = {};
  try {
    for (const [role, url] of [
      ["reference", config.referenceUrl],
      ["local", config.localUrl],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: first, height: heightFor(config, first) }, reducedMotion: "reduce", deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await gotoWithRetry(page, url, { retries: 2, timeout: 90000 });
      await preparePage(page, config, { role });
      pages[role] = { ctx, page };
    }
  } catch (err) {
    await browser.close().catch(() => {});
    fail(`site preparation failed: ${err.message}`);
  }

  const verdicts = [];
  try {
    for (const width of widths) {
      const v = await runBlockAtWidth({ section, width, pages, config, outAbs });
      verdicts.push(v);
      console.log(`[${section.id}@${width}] ${v.perfect ? "PERFECT" : "IMPERFECT"} — pixel ${v.pixel ?? "n/a"} (floor ${v.floor}), unpaired ${v.unpaired}, geom ${v.geometryMismatches}, paint ${v.paintMismatches}, asset ${v.assetMismatches}`);
    }
  } catch (err) {
    await pages.reference?.ctx.close().catch(() => {});
    await pages.local?.ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    if (isDependencyError(err)) fail(`${err.message}. Install: ${err.install ?? INSTALL_HINT}. Missing tooling is a FAILURE, never a pass.`);
    throw err;
  }
  await pages.reference?.ctx.close().catch(() => {});
  await pages.local?.ctx.close().catch(() => {});
  await browser.close().catch(() => {});

  writeJson(outAbs(`${section.id}/summary.json`), { block: section.id, label: section.label, generatedAt: new Date().toISOString(), localUrl: config.localUrl, referenceUrl: config.referenceUrl, floor: config.floors.sectionScoreFloor, widths, verdicts, perfect: verdicts.every((v) => v.perfect) });

  const allPerfect = verdicts.length > 0 && verdicts.every((v) => v.perfect);
  console.log(`\nScope: block ${section.id} (${section.label}) x ${widths.length} width(s) [${widths.join(",")}]`);
  console.log(`Result: ${allPerfect ? "PERFECT" : "IMPERFECT"} — ` + verdicts.map((v) => `${v.width}:${v.perfect ? "ok" : `px${v.pixel ?? "n/a"}/u${v.unpaired}/g${v.geometryMismatches}/p${v.paintMismatches}/a${v.assetMismatches}`}`).join(" "));
  process.exit(allPerfect ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(`FAIL  [block-loop] unexpected error: ${err.stack || err.message}`);
    console.log(`\nScope: 0 block(s)`);
    console.log(`Result: FAIL`);
    process.exit(1);
  });
}

export { runBlockAtWidth, runSweep };
