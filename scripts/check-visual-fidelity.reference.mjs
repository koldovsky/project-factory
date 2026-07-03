// REFERENCE IMPLEMENTATION — visual-fidelity gate (the pixel-case killer).
//
// The pixel-perfect forensics case (docs/field-reports/2026-07-02-pixel-perfect-
// forensics.md, RC1) proved the factory shipped a "≥99% pixel match" NFR with
// NO executable acceptance mechanism: no pixel-diff tool, no Playwright, and a
// local page +23%/+45% TALLER than the reference — while every gate stayed
// green. This script is that missing mechanism. It captures the reference URL
// and the local build at each declared breakpoint, applies a HARD PRE-GATE on
// page-height delta (> 2% = FAIL before a single pixel is compared — a ≥99%
// match is arithmetically impossible across a structural mismatch), then runs
// a masked pixel diff against the declared threshold.
//
// PRIME DIRECTIVE compliance (reflection-mechanism design, mechanism 3):
//   - config missing + NO product code  -> SKIP-pending, exit 0 (pre-phase)
//   - config missing + product code     -> NOT-EARNED, exit 1 (post-phase
//     emptiness is never success)
//   - playwright / pixelmatch / pngjs absent -> FAIL, exit 1, with install
//     instructions. NEVER exit 0 on missing dependencies.
//
// Config contract (quality/visual-parity.config.json in the target project —
// copy from templates/quality/visual-parity.config.json):
//   {
//     "referenceUrl": "https://live-site.example/",
//     "localUrl": "http://localhost:3000/",
//     "threshold": 0.99,              // optional, default 0.99 (NFR-19)
//     "settleMs": 1500,               // optional, default 1500
//     "maxHeightDeltaPct": 2,         // optional, default 2 (the pre-gate)
//     "breakpoints": [ { "name": "desktop", "width": 1440, "height": 900 } ],
//     "masks":          [ { "page": "*", "selectorOrRect": ".cookie-banner" } ],
//     "dynamicRegions": [ { "page": "/", "selectorOrRect": { "x":0,"y":0,"width":80,"height":40 } } ]
//   }
//
// Outputs, per breakpoint:
//   docs/qa/visual-diff/<breakpoint>/report.json
//     { breakpoint, score, threshold, heightDelta, masked, pass, ... }
//   docs/qa/visual-diff/<breakpoint>/diff.png  (when the pixel diff ran)
// Exit 0 ONLY when EVERY breakpoint passes.
//
// Stdout conventions (shared across all factory checks):
//   one "Scope: <n> breakpoint(s)" line, one final
//   "Result: PASS|FAIL|SKIP-pending|NOT-EARNED[, N warning(s)]" line.
//
// Heavy dependencies are lazy-required at capture/diff time so the script
// itself stays dependency-free (Node >= 18 stdlib). If they are missing the
// run FAILS with: npm i -D playwright pixelmatch pngjs && npx playwright install chromium
//
// Testability: the decision core (validateConfig, heightGate, evaluateScore,
// shapeReport, runVisualFidelity) is exported and adapter-injected. Test hook:
// set CHECK_VISUAL_FIDELITY_ADAPTERS=<path/to/module.mjs> exporting
// { capture, diff [, close] } to replace the Playwright/pixelmatch adapters
// (used by tests/visual.test.mjs; also handy for CI smoke runs).
//
// Usage:
//   node scripts/check-visual-fidelity.mjs                  # uses quality/visual-parity.config.json
//   node scripts/check-visual-fidelity.mjs --config path/to/other.json
//
// Wire as: "check:visual": "node scripts/check-visual-fidelity.mjs" in the
// qa-verify battery + G6; register docs/qa/visual-diff/*/report.json in the
// acceptance-token table so check-acceptance-methods can join NFR->artifact.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULTS = Object.freeze({
  threshold: 0.99, // NFR-19 default: >= 99% pixel match
  settleMs: 1500,
  maxHeightDeltaPct: 2, // hard pre-gate
  configPath: "quality/visual-parity.config.json",
  outDir: "docs/qa/visual-diff",
  installHint: "npm i -D playwright pixelmatch pngjs && npx playwright install chromium",
});

const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- pure core

/** Validate + normalize a raw parsed config. Returns { config, errors, warnings }. */
export function validateConfig(raw) {
  const errors = [];
  const warnings = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, errors: ["config must be a JSON object"], warnings };
  }
  const isUrl = (v) => {
    if (typeof v !== "string" || v.length === 0) return false;
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };
  if (!isUrl(raw.referenceUrl)) errors.push('"referenceUrl" must be an http(s) URL (the live/ground-truth page)');
  if (!isUrl(raw.localUrl)) errors.push('"localUrl" must be an http(s) URL (the local build under test)');

  const breakpoints = [];
  if (!Array.isArray(raw.breakpoints) || raw.breakpoints.length === 0) {
    errors.push('"breakpoints" must be a non-empty array of { name, width, height }');
  } else {
    const seen = new Set();
    for (const [i, bp] of raw.breakpoints.entries()) {
      const where = `breakpoints[${i}]`;
      if (bp === null || typeof bp !== "object") {
        errors.push(`${where} must be an object { name, width, height }`);
        continue;
      }
      const nameOk = typeof bp.name === "string" && /^[A-Za-z0-9._-]+$/.test(bp.name);
      if (!nameOk) errors.push(`${where}.name must match [A-Za-z0-9._-]+ (used as a directory name)`);
      else if (seen.has(bp.name)) errors.push(`${where}.name "${bp.name}" is duplicated`);
      else seen.add(bp.name);
      const dim = (v) => Number.isInteger(v) && v > 0;
      if (!dim(bp.width) || !dim(bp.height)) errors.push(`${where} width/height must be positive integers`);
      if (nameOk && dim(bp.width) && dim(bp.height)) breakpoints.push({ name: bp.name, width: bp.width, height: bp.height });
    }
  }

  const num = (v, d, name, { min = -Infinity, max = Infinity } = {}) => {
    if (v === undefined) return d;
    if (typeof v !== "number" || Number.isNaN(v) || v < min || v > max) {
      errors.push(`"${name}" must be a number in [${min}, ${max}]`);
      return d;
    }
    return v;
  };
  const threshold = num(raw.threshold, DEFAULTS.threshold, "threshold", { min: 0, max: 1 });
  const settleMs = num(raw.settleMs, DEFAULTS.settleMs, "settleMs", { min: 0, max: 600000 });
  const maxHeightDeltaPct = num(raw.maxHeightDeltaPct, DEFAULTS.maxHeightDeltaPct, "maxHeightDeltaPct", { min: 0.1, max: 100 });
  if (threshold < DEFAULTS.threshold)
    warnings.push(`threshold ${threshold} is below the ${DEFAULTS.threshold} default (NFR-19) — make sure the requirement actually allows this`);

  const maskList = (v, name) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errors.push(`"${name}" must be an array of { page, selectorOrRect }`);
      return [];
    }
    const out = [];
    for (const [i, m] of v.entries()) {
      const where = `${name}[${i}]`;
      if (m === null || typeof m !== "object") {
        errors.push(`${where} must be an object { page, selectorOrRect }`);
        continue;
      }
      const s = m.selectorOrRect;
      const isRect = s !== null && typeof s === "object" && ["x", "y", "width", "height"].every((k) => typeof s[k] === "number");
      const isSelector = typeof s === "string" && s.length > 0;
      if (!isRect && !isSelector) {
        errors.push(`${where}.selectorOrRect must be a CSS selector string or a rect { x, y, width, height }`);
        continue;
      }
      out.push({ page: m.page ?? "*", selectorOrRect: s });
    }
    return out;
  };
  const masks = maskList(raw.masks, "masks");
  const dynamicRegions = maskList(raw.dynamicRegions, "dynamicRegions");

  if (errors.length) return { config: null, errors, warnings };
  return {
    config: {
      referenceUrl: raw.referenceUrl,
      localUrl: raw.localUrl,
      threshold,
      settleMs,
      maxHeightDeltaPct,
      breakpoints,
      masks,
      dynamicRegions,
    },
    errors,
    warnings,
  };
}

/** HARD PRE-GATE: page-height delta above maxDeltaPct fails BEFORE pixel diffing. */
export function heightGate(refHeight, localHeight, maxDeltaPct = DEFAULTS.maxHeightDeltaPct) {
  if (!(refHeight > 0) || !(localHeight > 0)) {
    return { deltaPct: null, pass: false, message: `unusable page heights (reference ${refHeight}px, local ${localHeight}px)` };
  }
  const deltaPct = round2((Math.abs(localHeight - refHeight) / refHeight) * 100);
  if (deltaPct > maxDeltaPct) {
    return {
      deltaPct,
      pass: false,
      message:
        `page-height delta ${deltaPct}% exceeds ${maxDeltaPct}% (local ${localHeight}px vs reference ${refHeight}px) — ` +
        `structural mismatch, pixel diff skipped: a >=99% match is arithmetically impossible`,
    };
  }
  return { deltaPct, pass: true, message: null };
}

/** Threshold evaluation for a pixel-diff score in [0, 1]. */
export function evaluateScore(score, threshold = DEFAULTS.threshold) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return { pass: false, message: `pixel score is not a number (${String(score)})` };
  }
  const pass = score >= threshold - 1e-12;
  return { pass, message: pass ? null : `pixel score ${score} below threshold ${threshold}` };
}

/** Shape the per-breakpoint report.json object (stable keys, JSON-safe). */
export function shapeReport({ breakpoint, score, threshold, heightDelta, refHeight, localHeight, masked, pass, reason }) {
  return {
    breakpoint,
    score: typeof score === "number" ? score : null,
    threshold,
    heightDelta: typeof heightDelta === "number" ? heightDelta : null,
    refHeight: refHeight ?? null,
    localHeight: localHeight ?? null,
    masked: masked ?? 0,
    pass: pass === true,
    ...(reason ? { reason } : {}),
    generatedBy: "scripts/check-visual-fidelity.mjs",
  };
}

/** Split the masks that apply to a given page URL into selectors and rects. */
export function masksForPage(config, url) {
  let pathname = "*";
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* keep "*" */
  }
  const selectors = [];
  const rects = [];
  for (const m of [...(config.masks ?? []), ...(config.dynamicRegions ?? [])]) {
    const applies = m.page === undefined || m.page === null || m.page === "*" || m.page === pathname;
    if (!applies) continue;
    if (typeof m.selectorOrRect === "string") selectors.push(m.selectorOrRect);
    else rects.push(m.selectorOrRect);
  }
  return { selectors, rects };
}

export function isDependencyError(err) {
  return Boolean(
    err &&
      (err.dependency ||
        err.code === "ERR_MODULE_NOT_FOUND" ||
        err.code === "MODULE_NOT_FOUND" ||
        /Cannot find (package|module)/i.test(err.message ?? "")),
  );
}

/**
 * The pipeline core. All side effects are injected:
 *   capture({ url, name, width, height, settleMs, selectorMasks, role }) ->
 *       { png: Buffer, pageHeight: number, maskRects?: rect[] }
 *   diff({ refPng, localPng, maskRects, breakpoint }) ->
 *       { score: number (0..1), diffPng?: Buffer, maskedCount?: number }
 *   writeArtifact(relPath, data: Buffer|string) -> void
 * Returns { failures, warnings, reports, pass }. Never throws for per-
 * breakpoint problems; dependency absence becomes a FAILURE (never success).
 */
export async function runVisualFidelity({ config, capture, diff, writeArtifact, print = () => {}, printErr = () => {} }) {
  const failures = [];
  const warnings = [];
  const reports = [];
  const fail = (id, msg) => failures.push({ id, msg });

  for (const bp of config.breakpoints) {
    const outBase = `${DEFAULTS.outDir}/${bp.name}`;
    const writeReport = (report) => {
      reports.push(report);
      writeArtifact(`${outBase}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    };
    const failWithReport = (msg, extra = {}) => {
      fail(bp.name, msg);
      printErr(`FAIL  [${bp.name}] ${msg}`);
      writeReport(shapeReport({ breakpoint: bp.name, threshold: config.threshold, pass: false, reason: msg, ...extra }));
    };

    // 1. capture both sides (reference first — it also resolves selector masks)
    let ref;
    let local;
    try {
      const refMasks = masksForPage(config, config.referenceUrl);
      ref = await capture({
        url: config.referenceUrl,
        name: bp.name,
        width: bp.width,
        height: bp.height,
        settleMs: config.settleMs,
        selectorMasks: refMasks.selectors,
        role: "reference",
      });
      local = await capture({
        url: config.localUrl,
        name: bp.name,
        width: bp.width,
        height: bp.height,
        settleMs: config.settleMs,
        selectorMasks: [],
        role: "local",
      });
    } catch (err) {
      const dep = isDependencyError(err);
      const msg = dep
        ? `capture unavailable — ${err.message}. Install: ${err.install ?? DEFAULTS.installHint}. ` +
          `Missing tooling is a FAILURE, never a pass (prime directive).`
        : `capture failed: ${err.message}`;
      failWithReport(msg);
      continue;
    }

    // 2. HARD PRE-GATE: structural height mismatch fails before any pixel work
    const gate = heightGate(ref.pageHeight, local.pageHeight, config.maxHeightDeltaPct);
    if (!gate.pass) {
      failWithReport(gate.message, {
        heightDelta: gate.deltaPct,
        refHeight: ref.pageHeight,
        localHeight: local.pageHeight,
      });
      continue;
    }

    // 3. masked pixel diff vs threshold
    try {
      const rectMasks = [...(ref.maskRects ?? []), ...masksForPage(config, config.referenceUrl).rects];
      const d = await diff({ refPng: ref.png, localPng: local.png, maskRects: rectMasks, breakpoint: bp.name });
      const verdict = evaluateScore(d.score, config.threshold);
      const report = shapeReport({
        breakpoint: bp.name,
        score: d.score,
        threshold: config.threshold,
        heightDelta: gate.deltaPct,
        refHeight: ref.pageHeight,
        localHeight: local.pageHeight,
        masked: d.maskedCount ?? rectMasks.length,
        pass: verdict.pass,
        reason: verdict.message ?? undefined,
      });
      writeReport(report);
      if (d.diffPng) writeArtifact(`${outBase}/diff.png`, d.diffPng);
      if (verdict.pass) {
        print(`PASS  [${bp.name}] score ${d.score} >= ${config.threshold} (height delta ${gate.deltaPct}%, ${report.masked} mask(s))`);
      } else {
        fail(bp.name, verdict.message);
        printErr(`FAIL  [${bp.name}] ${verdict.message}`);
      }
    } catch (err) {
      const dep = isDependencyError(err);
      const msg = dep
        ? `pixel diff unavailable — ${err.message}. Install: ${err.install ?? DEFAULTS.installHint}. ` +
          `Missing tooling is a FAILURE, never a pass (prime directive).`
        : `pixel diff failed: ${err.message}`;
      failWithReport(msg, { heightDelta: gate.deltaPct, refHeight: ref.pageHeight, localHeight: local.pageHeight });
    }
  }

  return { failures, warnings, reports, pass: failures.length === 0 };
}

// ------------------------------------------------------- default adapters

async function lazyImport(name, install = DEFAULTS.installHint) {
  try {
    return await import(name);
  } catch (cause) {
    const err = new Error(`required dependency "${name}" is not installed`);
    err.dependency = name;
    err.install = install;
    err.cause = cause;
    throw err;
  }
}

/** Real Playwright capture + pixelmatch diff. Lazy-required; absence = FAIL upstream. */
export function makeDefaultAdapters() {
  let browserPromise = null;
  const getBrowser = async () => {
    const pw = await lazyImport("playwright");
    if (!browserPromise) browserPromise = pw.chromium.launch({ headless: true });
    return browserPromise;
  };

  async function capture({ url, width, height, settleMs, selectorMasks }) {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
      // animation freeze — carousels, spinners, transitions all pinned
      await page.addStyleTag({
        content:
          "*, *::before, *::after { animation: none !important; transition: none !important; " +
          "animation-play-state: paused !important; caret-color: transparent !important; }",
      });
      // lazy-load scroll: walk the full page so IntersectionObserver content loads
      await page.evaluate(async () => {
        const step = Math.max(200, window.innerHeight);
        for (let y = 0; y <= document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 100));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(settleMs);
      const pageHeight = await page.evaluate(() =>
        Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
      );
      // resolve selector masks to rects on the reference page
      const maskRects = [];
      for (const sel of selectorMasks ?? []) {
        for (const loc of await page.locator(sel).all()) {
          const box = await loc.boundingBox();
          if (box) maskRects.push({ x: box.x, y: box.y, width: box.width, height: box.height });
        }
      }
      const png = await page.screenshot({ fullPage: true, animations: "disabled" });
      return { png, pageHeight, maskRects };
    } finally {
      await context.close();
    }
  }

  async function diff({ refPng, localPng, maskRects }) {
    const { PNG } = await lazyImport("pngjs");
    const pmMod = await lazyImport("pixelmatch");
    const pixelmatch = pmMod.default ?? pmMod;
    const a = PNG.sync.read(refPng);
    const b = PNG.sync.read(localPng);
    const width = Math.max(a.width, b.width);
    const height = Math.max(a.height, b.height);
    const pad = (img) => {
      if (img.width === width && img.height === height) return img;
      const out = new PNG({ width, height });
      PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
      return out;
    };
    const A = pad(a);
    const B = pad(b);
    // paint masks identically on both sides so dynamic regions never count
    const paint = (img, r) => {
      const x0 = Math.max(0, Math.floor(r.x));
      const y0 = Math.max(0, Math.floor(r.y));
      const x1 = Math.min(width, Math.ceil(r.x + r.width));
      const y1 = Math.min(height, Math.ceil(r.y + r.height));
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (width * y + x) << 2;
          img.data[i] = 255;
          img.data[i + 1] = 0;
          img.data[i + 2] = 255;
          img.data[i + 3] = 255;
        }
      }
    };
    for (const r of maskRects ?? []) {
      paint(A, r);
      paint(B, r);
    }
    const out = new PNG({ width, height });
    const mismatched = pixelmatch(A.data, B.data, out.data, width, height, { threshold: 0.1 });
    const total = width * height;
    const score = total === 0 ? 0 : round2Precise(1 - mismatched / total);
    return { score, diffPng: PNG.sync.write(out), maskedCount: (maskRects ?? []).length };
  }

  async function close() {
    if (browserPromise) await (await browserPromise).close();
  }

  return { capture, diff, close };
}

const round2Precise = (n) => Math.round(n * 10000) / 10000;

// ------------------------------------------------------------------- main

function productCodePresent(root) {
  const dirs = ["app", "src", "components", "pages", "lib"];
  const hasFile = (dir) => {
    const abs = join(root, dir);
    if (!existsSync(abs)) return false;
    for (const entry of readdirSync(abs)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const p = join(abs, entry);
      if (statSync(p).isDirectory()) {
        if (hasFile(join(dir, entry))) return true;
      } else return true;
    }
    return false;
  };
  return dirs.some(hasFile);
}

async function main() {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const flagVal = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : d;
  };
  const configRel = flagVal("--config", DEFAULTS.configPath);
  const configAbs = join(root, configRel);

  const finish = (result, failures, warnings, scopeN) => {
    for (const w of warnings) console.warn(`WARN  [visual] ${w}`);
    console.log(`\nScope: ${scopeN} breakpoint(s)`);
    console.log(`Result: ${result}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
    process.exit(result === "PASS" || result === "SKIP-pending" ? 0 : 1);
  };

  // --- config presence: three-valued per the prime directive
  if (!existsSync(configAbs)) {
    if (productCodePresent(root)) {
      console.error(
        `FAIL  [config] ${configRel} not found but product code exists — the declared visual acceptance ` +
          `method has no executable configuration. Create it from templates/quality/visual-parity.config.json ` +
          `(referenceUrl, localUrl, breakpoints, threshold, masks) and re-run. ` +
          `Absence of evidence is never success.`,
      );
      finish("NOT-EARNED", [{ id: "config", msg: "missing config with product code present" }], [], 0);
    } else {
      console.log(
        `SKIP-pending: ${configRel} not found and no product code detected yet ` +
          `(expected before Phase 4 — the config becomes mandatory the moment implementation exists).`,
      );
      finish("SKIP-pending", [], [], 0);
    }
    return;
  }

  // --- config validation
  let raw;
  try {
    raw = JSON.parse(readFileSync(configAbs, "utf8"));
  } catch (err) {
    console.error(`FAIL  [config] ${configRel} is not valid JSON: ${err.message}`);
    finish("FAIL", [{ id: "config", msg: "invalid JSON" }], [], 0);
    return;
  }
  const { config, errors, warnings } = validateConfig(raw);
  if (errors.length) {
    for (const e of errors) console.error(`FAIL  [config] ${e}`);
    finish("FAIL", errors.map((msg) => ({ id: "config", msg })), warnings, 0);
    return;
  }

  // --- adapters: injected (test hook) or the real Playwright/pixelmatch pair
  let adapters;
  const adapterPath = process.env.CHECK_VISUAL_FIDELITY_ADAPTERS;
  if (adapterPath) {
    const mod = await import(pathToFileURL(resolve(root, adapterPath)).href);
    adapters = { capture: mod.capture, diff: mod.diff ?? makeDefaultAdapters().diff, close: mod.close ?? (async () => {}) };
    console.log(`(adapters injected from ${adapterPath})`);
  } else {
    adapters = makeDefaultAdapters();
  }

  const writeArtifact = (rel, data) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  };

  let run;
  try {
    run = await runVisualFidelity({
      config,
      capture: adapters.capture,
      diff: adapters.diff,
      writeArtifact,
      print: (m) => console.log(m),
      printErr: (m) => console.error(m),
    });
  } finally {
    try {
      await adapters.close?.();
    } catch {
      /* browser teardown must not mask the verdict */
    }
  }

  finish(run.pass ? "PASS" : "FAIL", run.failures, [...warnings, ...run.warnings], config.breakpoints.length);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    // an unexpected crash is a FAILURE, never a silent pass
    console.error(`FAIL  [visual] unexpected error: ${err.stack ?? err.message}`);
    console.log(`\nScope: 0 breakpoint(s)`);
    console.log("Result: FAIL");
    process.exit(1);
  });
}
