// REFERENCE IMPLEMENTATION — multi-layer parity harness, shared library.
//
// This module carries the "attentive-human overlay" parity capabilities earned
// on a real pixel-perfect replication campaign (see docs/field-reports for the
// abstract case study) and genericized for any project. NOTHING here is
// site-specific: every URL, selector, breakpoint, floor, mask, sweep step,
// carousel-pin script, and render-gate is supplied by a project-level
// quality/parity.config.json (copy from templates/quality/parity.config.template.json).
//
// Two consumers wire these helpers together:
//   scripts/check-parity-suite.reference.mjs  — the L1..L5 suite (gate).
//   scripts/parity-block-loop.reference.mjs   — block-by-block depth + sweep.
//
// House style: dependency-free by default. The heavy trio (playwright /
// pixelmatch / pngjs) is LAZY-required only where a browser or a pixel diff is
// actually needed, and its absence is a FAILURE with install instructions —
// never a silent skip (prime directive: missing tooling is never a pass).
//
// Capability inventory (all config-driven):
//   - Multi-layer diff primitives: content (L1), element computed-style matrix
//     (L2), AA-tolerant section overlay (L3, diff + 50/50 blend PNGs).
//   - Full-subtree pairing diff: walk every visible node, LCS-pair (wrapper-div
//     tolerant), diff sub-pixel geometry + every paint prop, report unpaired.
//   - Asset byte parity: hash every loaded <img>/background-image both sides.
//   - Continuum sweep band detection: baseline-relative tier-divergence bands.
//   - Capture determinism: fonts+images settle, animation freeze, carousel pin
//     (generic Swiper walk + config.pinScripts hook), fixed/sticky chrome
//     suppression, integer grid-snap, scroll-stitch of tall blocks, and the
//     PD-16 lazy render-gate (wait for configured selectors to be non-empty
//     before shooting; on persistent absence FAIL the sample, never score a
//     half-rendered page).
//
// English comments/output only.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// ============================================================ defaults / config

// The signed floors from the campaign, used when a config omits them. A project
// may TIGHTEN these; loosening is surfaced as a warning by validateConfig so a
// weakened gate can never pass silently.
export const DEFAULT_FLOORS = Object.freeze({
  sectionScoreFloor: 0.985, // L3 per-section AA-tolerant pixelmatch floor
  boxTolPx: 1, // width/height/padding/margin/border/radius tolerance (L2)
  positionTolPx: 2, // x/y position tolerance (L2)
  pixelmatchThreshold: 0.15, // AA noise is the documented floor, not a real diff
  includeAA: false,
  geomTolPx: 0.5, // full-subtree rect sub-pixel tolerance
  paintPxTolPx: 0.5, // px paint props (font/line/border/radius) tolerance
  opacityTol: 0.01,
});

export const DEFAULT_SWEEP = Object.freeze({
  min: 320,
  max: 1920,
  step: 16, // grid-aligned to min so canonical breakpoints land on samples
  viewportHeight: 1000, // fixed height holds vh-layout constant across widths
  tol: 0.05, // elevation over baseline that counts as a divergence band
  absFloor: 0.03, // absolute minimum divergence to count
  jumpTol: 0.04, // self-jump attribution threshold (which site crossed a tier)
  baselinePctl: 20, // aligned-tier floor percentile (robust when most widths diverge)
  strongTol: 0.2, // major (full reflow) vs minor (residual) band split
  pixelStep: 64, // coarse pixel-channel grid (screenshots are ~100x heavier)
  pixelFine: 32, // finer pixel grid over [pixelFineFrom..pixelFineTo]
  pixelFineFrom: 992,
  pixelFineTo: 1440,
});

export const DEFAULT_PICK_MAP = Object.freeze({
  heading: ":is(h1,h2,h3)",
  paragraph: "p",
  button: ":is(a,button)",
  link: "a",
  input: "input",
  card: ":is(.card,article,li)",
});

export const DEFAULT_WIDTH_RANGE = Object.freeze({ min: 320, max: 2560 });

export const INSTALL_HINT = "npm i -D playwright pixelmatch pngjs && npx playwright install chromium";

// Font/color style keys compared EXACTLY; geometry keys use tolerances (L2).
export const EXACT_STYLE_KEYS = Object.freeze([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderStyle",
]);
export const BOX_STYLE_KEYS = Object.freeze([
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "borderTopWidth",
  "borderRadius",
]);

// Paint props diffed on every paired node in the full-subtree diff. Exact-string
// vs px-tolerant split is applied in diffPair(); backgroundImage is basename-
// normalized (the reference host differs from the local host).
export const PAINT_KEYS = Object.freeze([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderTopStyle",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "boxShadow",
  "opacity",
  "textTransform",
  "objectFit",
]);

const PX_PAINT_KEYS = new Set([
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
]);

// ------------------------------------------------------------------ fs util
export function ensureDir(absPath) {
  mkdirSync(absPath, { recursive: true });
}
export function writeArtifact(absPath, data) {
  ensureDir(dirname(absPath));
  writeFileSync(absPath, data);
}
export function writeJson(absPath, obj) {
  writeArtifact(absPath, `${JSON.stringify(obj, null, 2)}\n`);
}

const r4 = (n) => Math.round(n * 10000) / 10000;
const round1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- text / px
/** Collapse whitespace so content diffs compare words, not layout wrapping. */
export function normalizeText(s) {
  return String(s ?? "")
    .replace(/ /g, " ") // nbsp -> space
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a px string ("12.5px") to a number, or NaN. */
export function px(v) {
  if (typeof v === "number") return v;
  const m = /(-?\d+(?:\.\d+)?)px/.exec(String(v ?? ""));
  return m ? parseFloat(m[1]) : NaN;
}

// Font stacks differ only in quoting/spacing between engines — normalize those.
function normalizeFontish(v) {
  return String(v ?? "")
    .replace(/["']/g, "")
    .replace(/\s*,\s*/g, ",")
    .trim()
    .toLowerCase();
}

// backgroundImage / any url() carries the host, which differs reference vs local.
// Reduce to url(<basename>) so a genuinely different asset trips the diff but a
// pure host difference does not (asset BYTES are checked separately).
function normalizeBgImage(v) {
  const s = String(v ?? "");
  if (s === "none" || s === "") return "none";
  return s.replace(/url\((["']?)([^)]*)\1\)/g, (_, __, u) => {
    try {
      const clean = u.split("?")[0].split("#")[0];
      const base = clean.split("/").filter(Boolean).pop() || clean;
      return `url(${base})`;
    } catch {
      return "url(?)";
    }
  });
}

// ============================================================ config loader

/**
 * Validate + normalize a raw parsed parity.config.json. Returns
 * { config, errors, warnings }. Pure (no I/O) so it is unit-testable. On any
 * error, config is null. Applies DEFAULT_FLOORS / DEFAULT_SWEEP / DEFAULT_PICK_MAP.
 */
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
  if (!isUrl(raw.referenceUrl)) errors.push('"referenceUrl" must be an http(s) URL (the reference/ground-truth page)');
  if (!isUrl(raw.localUrl)) errors.push('"localUrl" must be an http(s) URL (the local build under test)');

  // breakpoints
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

  // sections
  const sections = [];
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    errors.push('"sections" must be a non-empty array of { id, label, local, live }');
  } else {
    const seen = new Set();
    for (const [i, s] of raw.sections.entries()) {
      const where = `sections[${i}]`;
      if (s === null || typeof s !== "object") {
        errors.push(`${where} must be an object { id, label, local, live }`);
        continue;
      }
      const idOk = typeof s.id === "string" && /^[A-Za-z0-9._-]+$/.test(s.id);
      if (!idOk) errors.push(`${where}.id must match [A-Za-z0-9._-]+ (used as a directory name)`);
      else if (seen.has(s.id)) errors.push(`${where}.id "${s.id}" is duplicated`);
      else seen.add(s.id);
      if (typeof s.local !== "string" || !s.local) errors.push(`${where}.local must be a non-empty selector`);
      if (typeof s.live !== "string" || !s.live) errors.push(`${where}.live must be a non-empty selector`);
      if (idOk && typeof s.local === "string" && typeof s.live === "string") {
        sections.push({ id: s.id, label: s.label ?? s.id, local: s.local, live: s.live });
      }
    }
  }

  // floors / sweep merged over defaults; loosened floors warn.
  const floors = { ...DEFAULT_FLOORS, ...(raw.floors && typeof raw.floors === "object" ? raw.floors : {}) };
  if (floors.sectionScoreFloor < DEFAULT_FLOORS.sectionScoreFloor) {
    warnings.push(`floors.sectionScoreFloor ${floors.sectionScoreFloor} is below the signed default ${DEFAULT_FLOORS.sectionScoreFloor} — confirm the requirement allows this`);
  }
  const sweep = { ...DEFAULT_SWEEP, ...(raw.sweep && typeof raw.sweep === "object" ? raw.sweep : {}) };
  const pickMap = { ...DEFAULT_PICK_MAP, ...(raw.pickMap && typeof raw.pickMap === "object" ? raw.pickMap : {}) };
  const widthRange = { ...DEFAULT_WIDTH_RANGE, ...(raw.widthRange && typeof raw.widthRange === "object" ? raw.widthRange : {}) };

  // canonical widths + heights (for --width all / L5). Default to the breakpoint set.
  const canonicalWidths = Array.isArray(raw.canonicalWidths) && raw.canonicalWidths.every((w) => Number.isInteger(w))
    ? [...raw.canonicalWidths]
    : breakpoints.map((b) => b.width);
  const widthHeights = raw.widthHeights && typeof raw.widthHeights === "object" ? { ...raw.widthHeights } : {};
  for (const bp of breakpoints) if (widthHeights[String(bp.width)] === undefined) widthHeights[String(bp.width)] = bp.height;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const prepareRaw = raw.prepare && typeof raw.prepare === "object" ? raw.prepare : {};
  const prepare = {
    settleMsReference: Number.isFinite(prepareRaw.settleMsReference) ? prepareRaw.settleMsReference : 2200,
    settleMsLocal: Number.isFinite(prepareRaw.settleMsLocal) ? prepareRaw.settleMsLocal : 1400,
    cookieDismissSelectors: arr(prepareRaw.cookieDismissSelectors),
    suppressSelectors: arr(prepareRaw.suppressSelectors),
    counterSelectors: arr(prepareRaw.counterSelectors),
    pinScripts: arr(prepareRaw.pinScripts),
    renderGates: arr(prepareRaw.renderGates).map((g) => (typeof g === "string" ? { selector: g } : g)).filter((g) => g && typeof g.selector === "string"),
    renderGateTimeoutMs: Number.isFinite(prepareRaw.renderGateTimeoutMs) ? prepareRaw.renderGateTimeoutMs : 8000,
  };

  const matrixBreakpoint = typeof raw.matrixBreakpoint === "string" ? raw.matrixBreakpoint : undefined;
  const masks = arr(raw.masks);
  const elements = arr(raw.elements);
  const hover = arr(raw.hover);
  const behaviors = arr(raw.behaviors);

  if (errors.length) return { config: null, errors, warnings };
  return {
    config: {
      referenceUrl: raw.referenceUrl,
      localUrl: raw.localUrl,
      breakpoints,
      canonicalWidths,
      widthHeights,
      widthRange,
      matrixBreakpoint,
      floors,
      sweep,
      pickMap,
      prepare,
      masks,
      sections,
      elements,
      hover,
      behaviors,
    },
    errors,
    warnings,
  };
}

// ============================================================ L2 style compare
/**
 * Compare one element's computed styles + box between reference and local.
 * Returns an array of mismatch objects (empty === clean). Fonts/colors exact;
 * box +-boxTolPx; position +-positionTolPx.
 */
export function diffElementStyles(key, role, ref, local, floors = DEFAULT_FLOORS) {
  const out = [];
  if (!ref && !local) return out;
  if (!ref || !local) {
    out.push({ key, role, prop: "presence", ref: ref ? "present" : "MISSING", local: local ? "present" : "MISSING" });
    return out;
  }
  for (const k of EXACT_STYLE_KEYS) {
    const a = normalizeFontish(ref.styles?.[k]);
    const b = normalizeFontish(local.styles?.[k]);
    if (a !== b) out.push({ key, role, prop: k, ref: ref.styles?.[k], local: local.styles?.[k], tol: "exact" });
  }
  for (const k of BOX_STYLE_KEYS) {
    const a = px(ref.styles?.[k]);
    const b = px(local.styles?.[k]);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    if (Math.abs(a - b) > floors.boxTolPx) out.push({ key, role, prop: k, ref: `${a}px`, local: `${b}px`, tol: `+-${floors.boxTolPx}px` });
  }
  const geom = [
    ["width", floors.boxTolPx],
    ["height", floors.boxTolPx],
    ["x", floors.positionTolPx],
    ["y", floors.positionTolPx],
  ];
  for (const [k, t] of geom) {
    const a = ref.box?.[k];
    const b = local.box?.[k];
    if (typeof a !== "number" || typeof b !== "number") continue;
    if (Math.abs(a - b) > t) out.push({ key, role, prop: `box.${k}`, ref: round1(a), local: round1(b), tol: `+-${t}px` });
  }
  return out;
}

// ============================================================ L4 hover compare
/**
 * Given before/after computed style snapshots on both sites for one probe,
 * return the list of props whose reference before->after delta differs from the
 * local before->after delta.
 */
export function diffHoverStates(key, note, props, ref, local) {
  const out = [];
  if (!ref || !local) {
    out.push({ key, note, prop: "reachable", ref: ref ? "ok" : "MISSING", local: local ? "ok" : "MISSING" });
    return out;
  }
  for (const p of props) {
    const rBefore = ref.before?.[p];
    const rAfter = ref.after?.[p];
    const lBefore = local.before?.[p];
    const lAfter = local.after?.[p];
    const refChanged = rBefore !== rAfter;
    const localChanged = lBefore !== lAfter;
    if (refChanged !== localChanged || (refChanged && localChanged && rAfter !== lAfter)) {
      out.push({ key, note, prop: p, refDelta: `${rBefore} -> ${rAfter}`, localDelta: `${lBefore} -> ${lAfter}` });
    }
  }
  return out;
}

// ============================================================ dep resolver
const _require = createRequire(import.meta.url);

/**
 * Resolve + import an optional heavy dependency (playwright / pixelmatch / pngjs).
 * Tries normal node_modules resolution FIRST (the standard case: the project
 * installed the parity deps), then falls back to a caller-provided node_modules
 * root via the PARITY_DEPS_DIR env var (a directory that CONTAINS node_modules —
 * e.g. a monorepo root, a pnpm store shim, a CI cache, or an out-of-tree fixture
 * environment). Absence is a FAILURE with an actionable install hint, never a
 * silent skip.
 */
export async function loadDep(name) {
  let resolved;
  try {
    resolved = _require.resolve(name);
  } catch (cause) {
    const dir = process.env.PARITY_DEPS_DIR;
    if (dir) {
      try {
        resolved = _require.resolve(name, { paths: [dir] });
      } catch {
        /* fall through to the thrown dependency error below */
      }
    }
    if (!resolved) {
      const err = new Error(`required dependency "${name}" is not installed`);
      err.dependency = name;
      err.install = INSTALL_HINT;
      err.cause = cause;
      throw err;
    }
  }
  return import(pathToFileURL(resolved).href);
}

// ============================================================ L3 pixel overlay
const lazy = loadDep;

/** Pad a PNG onto a fresh canvas of (w,h), background white. */
function padTo(PNG, img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255); // white background so the shorter side is not transparent noise
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, w), Math.min(img.height, h), 0, 0);
  return out;
}

/**
 * Height-normalized, AA-tolerant section diff. Returns
 * { score, wDelta, hDelta, diffPng, blendPng, refW, refH, localW, localH }.
 * Lazy-requires pngjs + pixelmatch.
 */
export async function sectionDiff(refPng, localPng, floors = DEFAULT_FLOORS) {
  const { PNG } = await lazy("pngjs");
  const pmMod = await lazy("pixelmatch");
  const pixelmatch = pmMod.default ?? pmMod;
  const a = PNG.sync.read(refPng);
  const b = PNG.sync.read(localPng);
  const wDelta = a.width - b.width;
  const hDelta = a.height - b.height;
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const A = padTo(PNG, a, w, h);
  const B = padTo(PNG, b, w, h);
  const out = new PNG({ width: w, height: h });
  const mismatched = pixelmatch(A.data, B.data, out.data, w, h, {
    threshold: floors.pixelmatchThreshold,
    includeAA: floors.includeAA,
  });
  const total = w * h;
  const score = total === 0 ? 0 : r4(1 - mismatched / total);
  // 50/50 alpha composite — the "attentive human sliding one over the other".
  const blend = new PNG({ width: w, height: h });
  for (let i = 0; i < blend.data.length; i += 4) {
    blend.data[i] = (A.data[i] + B.data[i]) >> 1;
    blend.data[i + 1] = (A.data[i + 1] + B.data[i + 1]) >> 1;
    blend.data[i + 2] = (A.data[i + 2] + B.data[i + 2]) >> 1;
    blend.data[i + 3] = 255;
  }
  return {
    score,
    wDelta,
    hDelta,
    diffPng: PNG.sync.write(out),
    blendPng: PNG.sync.write(blend),
    refW: a.width,
    refH: a.height,
    localW: b.width,
    localH: b.height,
  };
}

// ============================================================ page plumbing

/**
 * Stop autoplay and pin every carousel to its first slide so captures are
 * deterministic. A generic Swiper walk is built in (Swiper is a widely used
 * carousel lib that attaches its instance to `el.swiper`) and is a safe no-op
 * when no Swiper is present. Site-specific carousels are pinned by evaluating
 * each string in config.prepare.pinScripts in the page context (the generic
 * hook, one per pattern). Never throws.
 */
export async function pinCarousels(page, pinScripts = []) {
  await page
    .evaluate(() => {
      const pin = (sw) => {
        try {
          if (sw && sw.autoplay && typeof sw.autoplay.stop === "function") sw.autoplay.stop();
          if (sw && sw.params && sw.params.loop && typeof sw.slideToLoop === "function") sw.slideToLoop(0, 0, false);
          else if (sw && typeof sw.slideTo === "function") sw.slideTo(0, 0, false);
          if (sw && typeof sw.update === "function") sw.update();
        } catch {
          /* pinning one carousel must never abort the rest */
        }
      };
      for (const el of document.querySelectorAll(".swiper, [class*='swiper']")) {
        if (el.swiper) pin(el.swiper);
      }
    })
    .catch(() => {});
  for (const script of pinScripts || []) {
    if (typeof script !== "string" || !script.trim()) continue;
    // Each pinScript is a page-context expression/statement block the project
    // supplies to stop its own carousel/autoplay. Evaluated with the same never-
    // throw contract as the built-in Swiper walk.
    await page.evaluate(script).catch(() => {});
  }
}

/**
 * Byte-stability settle: block until web fonts have loaded and every <img> has
 * resolved. The font swap (fallback -> web font changes line metrics) and lazy
 * <img>s popping in are the two late layout shifts that drift capture height
 * run-to-run; awaiting them makes consecutive captures reflow-complete. Never throws.
 */
export async function waitForStableRender(page, { imageTimeoutMs = 8000 } = {}) {
  await page
    .evaluate(async (timeout) => {
      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready;
        } catch {
          /* fonts API absent/failed */
        }
      }
      const imgs = [...document.images];
      const pending = imgs
        .filter((img) => !(img.complete && img.naturalWidth > 0))
        .map(
          (img) =>
            new Promise((res) => {
              img.addEventListener("load", res, { once: true });
              img.addEventListener("error", res, { once: true });
            }),
        );
      if (pending.length === 0) return;
      await Promise.race([Promise.all(pending), new Promise((res) => setTimeout(res, timeout))]);
    }, imageTimeoutMs)
    .catch(() => {});
}

/**
 * Wait until animated count-up numbers have reached their final value. JS-driven
 * count-ups that ignore prefers-reduced-motion are immune to the animation:none
 * freeze and could be caught one frame short, drifting the overlay score. Polls
 * each configured region's text until it stops changing across two samples (or a
 * cap). No-op when no counterSelectors are configured. Never throws.
 */
export async function settleCounters(page, counterSelectors = [], { sampleMs = 350, maxSamples = 12 } = {}) {
  for (const selector of counterSelectors || []) {
    try {
      const region = page.locator(selector).first();
      if ((await region.count()) === 0) continue;
      let prev = null;
      for (let i = 0; i < maxSamples; i += 1) {
        const now = await region.evaluate((el) => (el.textContent || "").replace(/\s+/g, " ").trim()).catch(() => null);
        if (now !== null && now === prev) break;
        prev = now;
        await page.waitForTimeout(sampleMs);
      }
    } catch {
      /* counter settle is best-effort */
    }
  }
}

/**
 * PD-16 lazy third-party render-gate. For each configured gate, wait until at
 * least one matching element is present AND non-empty (has text, a resolved <img>
 * source, or a non-zero box). Returns { ok, missing:[{selector, note}] }: `ok` is
 * false when any gate never fills within the timeout — the caller MUST fail that
 * sample with a named reason and never score a half-rendered page. Never throws.
 */
export async function awaitRenderGates(page, gates = [], { timeoutMs = 8000, pollMs = 200 } = {}) {
  const missing = [];
  for (const gate of gates || []) {
    const selector = gate.selector;
    if (typeof selector !== "string" || !selector) continue;
    const deadline = Date.now() + timeoutMs;
    let filled = false;
    while (Date.now() < deadline) {
      const ok = await page
        .evaluate((sel) => {
          const els = document.querySelectorAll(sel);
          if (!els.length) return false;
          for (const el of els) {
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width <= 0.5 || r.height <= 0.5) continue;
            const text = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (text) return true;
            if (el.tagName === "IMG" && (el.currentSrc || el.getAttribute("src"))) return true;
            if (el.querySelector && el.querySelector("img,svg,canvas,video,picture")) return true;
            return true; // present + visible with a real box counts as rendered
          }
          return false;
        }, selector)
        .catch(() => false);
      if (ok) {
        filled = true;
        break;
      }
      await page.waitForTimeout(pollMs);
    }
    if (!filled) missing.push({ selector, note: gate.note ?? null });
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Prepare a freshly navigated page like an attentive human would before
 * comparing: dismiss the cookie/consent banner, force reduced motion + freeze
 * every animation/transition, STOP autoplay + pin carousels, walk the page so
 * lazy content mounts, wait for fonts + images, let JS count-ups settle, and
 * finally check the PD-16 render-gates. Returns { renderGates } so the caller can
 * fail a half-rendered sample. Idempotent; never throws (except nothing).
 */
export async function preparePage(page, config, { role = "local" } = {}) {
  const prep = config?.prepare ?? {};
  const settleMs = role === "reference" ? prep.settleMsReference ?? 2200 : prep.settleMsLocal ?? 1400;
  // 1. cookie / consent banner — click any configured dismiss control.
  for (const sel of prep.cookieDismissSelectors ?? []) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 400 })) {
        await loc.click({ timeout: 800 });
        break;
      }
    } catch {
      /* ignore */
    }
  }
  // 2. freeze animation + suppress residual overlays (config-driven selectors).
  const suppress = (prep.suppressSelectors ?? []).map((s) => String(s)).join(",");
  await page
    .addStyleTag({
      content:
        `*,*::before,*::after{animation:none!important;transition:none!important;` +
        `animation-play-state:paused!important;caret-color:transparent!important;scroll-behavior:auto!important;}` +
        (suppress ? `${suppress}{display:none!important;}` : ""),
    })
    .catch(() => {});
  await pinCarousels(page, prep.pinScripts);
  // 3. lazy-load walk
  await page
    .evaluate(async () => {
      const step = Math.max(200, window.innerHeight);
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 80));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
  await pinCarousels(page, prep.pinScripts);
  // 4. byte-stability settle — fonts + images, then JS count-ups.
  await waitForStableRender(page);
  await settleCounters(page, prep.counterSelectors);
  await page.waitForTimeout(settleMs);
  // 5. PD-16 render-gate — never score a half-rendered page.
  const renderGates = await awaitRenderGates(page, prep.renderGates, { timeoutMs: prep.renderGateTimeoutMs ?? 8000 });
  return { renderGates };
}

/** Navigate with a couple of retries for live-site nav flake. */
export async function gotoWithRetry(page, url, { retries = 2, timeout = 90000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "load", timeout });
      return;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(1500);
    }
  }
  throw lastErr;
}

/** Collect computed styles + bounding box for a resolved locator (or null). */
export async function collectStyle(page, selector) {
  try {
    const loc = page.locator(selector).first();
    if ((await loc.count()) === 0) return null;
    await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    return await loc.evaluate((el, keys) => {
      const cs = getComputedStyle(el);
      const styles = {};
      for (const k of keys) styles[k] = cs[k];
      const r = el.getBoundingClientRect();
      return { styles, box: { x: r.x, y: r.y, width: r.width, height: r.height } };
    }, [...EXACT_STYLE_KEYS, ...BOX_STYLE_KEYS]);
  } catch {
    return null;
  }
}

/**
 * Deterministic element-capture stabilization, applied IDENTICALLY on both sides
 * immediately before an element screenshot; paired with unstabilizeCapture() to
 * restore the DOM. It removes two capture artifacts without touching any
 * component or weakening any threshold:
 *   1. FIXED/STICKY CHROME BLEED — Playwright's captureBeyondViewport positions
 *      fixed/sticky elements relative to the expanded rect, so a fixed header
 *      repaints as a band into a non-header clip. We display:none every
 *      fixed/sticky element that is not the target nor its ancestor/descendant.
 *   2. SUB-PIXEL CLIP-ORIGIN GHOST — the rounded clip origin lands a whole device
 *      pixel apart when the two sides' bbox.top fractionals differ, ghosting every
 *      glyph edge. We cancel each side's sub-pixel remainder with a capture-only
 *      relative-position offset (NOT a transform, which would composite + blur).
 * Never throws; returns a small summary for logging.
 */
export async function stabilizeForCapture(page, selector) {
  return page
    .evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return { ok: false };
      let hidden = 0;
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        if (el === root || root.contains(el) || el.contains(root)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (cs.display === "none") continue;
        el.setAttribute("data-parity-disp", el.style.display || "__unset__");
        el.style.display = "none";
        hidden += 1;
      }
      const cs = getComputedStyle(root);
      const r0 = root.getBoundingClientRect();
      const snap = r0.top - Math.round(r0.top);
      root.setAttribute("data-parity-pos", root.style.position || "__unset__");
      root.setAttribute("data-parity-top", root.style.top || "__unset__");
      if (cs.position === "static") root.style.position = "relative";
      const curTop = parseFloat(cs.top) || 0;
      root.style.top = `${curTop - snap}px`;
      return { ok: true, hidden, snap: Math.round(snap * 1000) / 1000 };
    }, selector)
    .catch(() => ({ ok: false }));
}

/** Revert everything stabilizeForCapture changed. Never throws. */
export async function unstabilizeCapture(page) {
  await page
    .evaluate(() => {
      for (const el of document.querySelectorAll("[data-parity-disp]")) {
        const d = el.getAttribute("data-parity-disp");
        el.style.display = d === "__unset__" ? "" : d;
        el.removeAttribute("data-parity-disp");
      }
      for (const el of document.querySelectorAll("[data-parity-pos]")) {
        const p = el.getAttribute("data-parity-pos");
        const t = el.getAttribute("data-parity-top");
        el.style.position = p === "__unset__" ? "" : p;
        el.style.top = t === "__unset__" ? "" : t;
        el.removeAttribute("data-parity-pos");
        el.removeAttribute("data-parity-top");
      }
    })
    .catch(() => {});
}

/**
 * Manual scroll-and-stitch of a block TALLER than the viewport, at the REAL
 * breakpoint viewport height. Playwright's tall-element screenshot (and a
 * grow-the-viewport shortcut) both EXPAND the layout viewport, silently changing
 * any viewport-height-dependent layout (min-height/vh/flex justify). Tiling at
 * the real viewport height keeps vh-layout at its breakpoint value, so the
 * capture reflects real parity. Returns a PNG buffer (W x totalH) or null.
 */
async function stitchTall(page, loc, vpH, timeout) {
  const { PNG } = await lazy("pngjs");
  const meta = await loc
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { absTop: Math.round(r.top + window.scrollY), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .catch(() => null);
  if (!meta || meta.w < 1 || meta.h < 1) return null;
  const out = new PNG({ width: meta.w, height: meta.h });
  let filled = 0;
  let guard = 0;
  while (filled < meta.h && guard < 200) {
    guard += 1;
    await page.evaluate((sy) => window.scrollTo(0, sy), meta.absTop + filled);
    await page.waitForTimeout(30);
    const top = await loc.evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => null);
    if (top === null) break;
    const buf = await page.screenshot({ timeout, animations: "disabled" }).catch(() => null);
    if (!buf) break;
    const tile = PNG.sync.read(buf);
    const startR = Math.max(filled, -top);
    const endR = Math.min(meta.h, vpH - top);
    if (endR <= startR) break; // no forward progress (scroll clamped)
    const srcX = meta.left;
    const srcY = top + startR;
    const hh = endR - startR;
    if (srcY >= 0 && srcX >= 0 && srcX + meta.w <= tile.width && srcY + hh <= tile.height) {
      PNG.bitblt(tile, out, srcX, srcY, meta.w, hh, 0, startR);
    }
    filled = endR;
  }
  if (filled <= 0) return null;
  return PNG.sync.write(out);
}

/**
 * Deterministic element clip screenshot — the ONE capture routine shared by the
 * section suite and the block-loop, so both get identical artifact handling.
 * Scroll into view, re-pin carousels at the moment of capture, stabilizeForCapture
 * (fixed-chrome display:none + sub-pixel grid snap), PARK the pointer so nothing
 * hovers, then shoot. A block that FITS the viewport is one frame; a TALLER block
 * is scroll-stitched at the real viewport height. Restores the DOM after. Returns
 * { png, box } or null; never throws.
 */
export async function captureElement(page, selector, { timeout = 15000, pinScripts = [] } = {}) {
  try {
    const loc = page.locator(selector).first();
    if ((await loc.count()) === 0) return null;
    await loc.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(120);
    await pinCarousels(page, pinScripts);
    await page.waitForTimeout(60);
    const vp = page.viewportSize() || { width: 1280, height: 900 };
    const box0 = await loc.boundingBox().catch(() => null);
    const tall = !!box0 && Math.ceil(box0.height) > vp.height;
    await stabilizeForCapture(page, selector);
    await page.mouse.move(0, 0).catch(() => {});
    await page.waitForTimeout(30);
    let png;
    if (tall) {
      png = await stitchTall(page, loc, vp.height, timeout);
    } else {
      png = await loc.screenshot({ timeout, animations: "disabled" }).catch(() => null);
    }
    const box = await loc.boundingBox().catch(() => null);
    await unstabilizeCapture(page);
    if (!png) return null;
    return { png, box };
  } catch {
    return null;
  }
}

/** Screenshot a section by selector; returns Buffer or null (never throws). */
export async function shootSection(page, selector, pinScripts = []) {
  const cap = await captureElement(page, selector, { pinScripts });
  return cap ? cap.png : null;
}

/** Resolve an element-matrix entry to its {local,live} selectors via the pickMap. */
export function resolveElementSelectors(entry, section, pickMap = DEFAULT_PICK_MAP) {
  if (entry.custom) return { local: entry.local, live: entry.live };
  const rel = pickMap[entry.pick] ?? entry.pick;
  const nth = entry.index ? ` >> nth=${entry.index}` : " >> nth=0";
  return {
    local: `${section.local} ${rel}${nth}`,
    live: `${section.live} ${rel}${nth}`,
  };
}

// ============================================================ full-subtree walk
/**
 * Walk EVERY visible, visually-significant element in the block subtree and
 * return an ordered list of nodes with a structural roleKey, a CSS path, a rect
 * relative to the block origin (sub-pixel), and the paint props. Wrapper divs
 * that carry no content/paint are skipped so pairing stays tolerant to them. The
 * block root is always emitted so the band's own paint is compared root-to-root.
 * Runs entirely in the page. Returns { rootSize, nodes } or null.
 */
export async function walkSubtree(page, selector, paintKeys) {
  return page
    .evaluate(
      ({ sel, keys }) => {
        const root = document.querySelector(sel);
        if (!root) return null;
        const rootRect = root.getBoundingClientRect();
        const norm = (s) =>
          String(s ?? "")
            .replace(/ /g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const ownText = (el) => {
          let s = "";
          for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent;
          return norm(s);
        };
        const isVisible = (el, cs, r) => {
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
          return r.width > 0.5 && r.height > 0.5;
        };
        const cssPath = (el) => {
          if (el === root) return ":block-root";
          const parts = [];
          let cur = el;
          while (cur && cur !== root && cur !== document.body) {
            const tag = cur.tagName.toLowerCase();
            let idx = 1;
            let sib = cur;
            while ((sib = sib.previousElementSibling)) if (sib.tagName === cur.tagName) idx += 1;
            parts.unshift(`${tag}:nth-of-type(${idx})`);
            cur = cur.parentElement;
            if (parts.length > 8) break;
          }
          return parts.join(">") || el.tagName.toLowerCase();
        };
        const MEDIA = new Set(["img", "svg", "picture", "video", "canvas"]);
        const FORM = new Set(["input", "textarea", "select"]);
        const INTERACTIVE = new Set(["a", "button"]);
        const nodes = [];
        const els = [root, ...root.querySelectorAll("*")];
        for (const el of els) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (!isVisible(el, cs, r)) continue;
          const tag = el.tagName.toLowerCase();
          const t = ownText(el);
          const hasBg = cs.backgroundImage && cs.backgroundImage !== "none";
          const significant = el === root || !!t || MEDIA.has(tag) || FORM.has(tag) || INTERACTIVE.has(tag) || hasBg;
          if (!significant) continue;
          let key;
          if (el === root) key = "__root__";
          else if (MEDIA.has(tag)) key = `media:${tag}:${el.getAttribute("alt") || ""}`;
          else if (FORM.has(tag)) key = `${tag}:${el.getAttribute("type") || el.getAttribute("placeholder") || el.getAttribute("name") || ""}`;
          else if (INTERACTIVE.has(tag)) key = `${tag}:${t || el.getAttribute("aria-label") || ""}`;
          else if (t) key = `${tag}:${t}`;
          else key = `bg:${tag}`;
          const styles = {};
          for (const k of keys) styles[k] = cs[k];
          nodes.push({
            path: cssPath(el),
            tag,
            key,
            text: t.slice(0, 80),
            rect: {
              x: Math.round((r.x - rootRect.x) * 100) / 100,
              y: Math.round((r.y - rootRect.y) * 100) / 100,
              w: Math.round(r.width * 100) / 100,
              h: Math.round(r.height * 100) / 100,
            },
            styles,
          });
        }
        return { rootSize: { w: Math.round(rootRect.width * 100) / 100, h: Math.round(rootRect.height * 100) / 100 }, nodes };
      },
      { sel: selector, keys: paintKeys },
    )
    .catch(() => null);
}

/**
 * Pair two ordered node lists by their roleKey via a longest-common-subsequence
 * alignment. LCS is order-preserving and tolerant to inserted wrapper nodes on
 * either side (they fall out as unpaired). Returns
 * { pairs:[{ref,local}], unpairedRef:[node], unpairedLocal:[node] }. Pure.
 */
export function pairSubtree(refNodes, localNodes) {
  const a = refNodes;
  const b = localNodes;
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  const unpairedRef = [];
  const unpairedLocal = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key) {
      pairs.push({ ref: a[i], local: b[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      unpairedRef.push(a[i]);
      i += 1;
    } else {
      unpairedLocal.push(b[j]);
      j += 1;
    }
  }
  while (i < n) unpairedRef.push(a[i++]);
  while (j < m) unpairedLocal.push(b[j++]);
  return { pairs, unpairedRef, unpairedLocal };
}

/**
 * Diff one paired node: geometry (rect x/y/w/h rel. to block origin, tol
 * floors.geomTolPx) + every paint prop. Font/color/style/shadow/transform exact;
 * px paints and radii tol floors.paintPxTolPx; opacity tol floors.opacityTol;
 * backgroundImage basename-normalized. Each mismatch carries the node CSS path
 * and ref-vs-local values. `kind` is "geometry" or "paint". Pure.
 */
export function diffPair(ref, local, floors = DEFAULT_FLOORS) {
  const out = [];
  const path = local.path || ref.path;
  const role = `${ref.tag}${ref.text ? ` "${ref.text}"` : ""}`;
  const geomTol = floors.geomTolPx;
  const pxTol = floors.paintPxTolPx;
  const opTol = floors.opacityTol;
  for (const k of ["x", "y", "w", "h"]) {
    const rv = ref.rect?.[k];
    const lv = local.rect?.[k];
    if (typeof rv !== "number" || typeof lv !== "number") continue;
    if (Math.abs(rv - lv) > geomTol) out.push({ kind: "geometry", path, role, prop: `rect.${k}`, ref: rv, local: lv, tol: `+-${geomTol}px` });
  }
  for (const k of PAINT_KEYS) {
    const rv = ref.styles?.[k];
    const lv = local.styles?.[k];
    if (rv === undefined && lv === undefined) continue;
    if (k === "fontFamily") {
      if (normalizeFontish(rv) !== normalizeFontish(lv)) out.push({ kind: "paint", path, role, prop: k, ref: rv, local: lv, tol: "exact" });
    } else if (k === "backgroundImage") {
      const a = normalizeBgImage(rv);
      const b = normalizeBgImage(lv);
      if (a !== b) out.push({ kind: "paint", path, role, prop: k, ref: a, local: b, tol: "basename" });
    } else if (k === "opacity") {
      const a = parseFloat(rv);
      const b = parseFloat(lv);
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        if (Math.abs(a - b) > opTol) out.push({ kind: "paint", path, role, prop: k, ref: rv, local: lv, tol: `+-${opTol}` });
      } else if (rv !== lv) out.push({ kind: "paint", path, role, prop: k, ref: rv, local: lv, tol: "exact" });
    } else if (PX_PAINT_KEYS.has(k)) {
      const a = px(rv);
      const b = px(lv);
      if (Number.isNaN(a) || Number.isNaN(b)) {
        if (rv !== lv) out.push({ kind: "paint", path, role, prop: k, ref: rv, local: lv, tol: "exact" });
      } else if (Math.abs(a - b) > pxTol) out.push({ kind: "paint", path, role, prop: k, ref: rv, local: lv, tol: `+-${pxTol}px` });
    } else if (String(rv ?? "") !== String(lv ?? "")) {
      out.push({ kind: "paint", path, role, prop: k, ref: rv, local: lv, tol: "exact" });
    }
  }
  return out;
}

// ============================================================ geometry sweep
/** Grid-aligned continuum widths [min..max] at `step`, max always the final sample. */
export function sweepWidths(step, sweep = DEFAULT_SWEEP) {
  const s = Math.max(1, Math.floor(step ?? sweep.step));
  const out = [];
  for (let w = sweep.min; w <= sweep.max; w += s) out.push(w);
  if (out[out.length - 1] !== sweep.max) out.push(sweep.max);
  return out;
}

/**
 * Pixel-channel widths: a COARSE grid `step` across [min..max] aligned to min
 * (max always included), plus, when `fine` > 0, a FINER grid over [fineFrom..
 * fineTo]. Union de-duplicated, clamped, ascending.
 */
export function pixelWidths(step, { fine = 0, fineFrom, fineTo } = {}, sweep = DEFAULT_SWEEP) {
  const s = Math.max(1, Math.floor(step ?? sweep.pixelStep));
  const set = new Set();
  for (let w = sweep.min; w <= sweep.max; w += s) set.add(w);
  set.add(sweep.max);
  if (fine && fine > 0) {
    const f = Math.max(1, Math.floor(fine));
    const lo = Math.max(sweep.min, Math.min(fineFrom, fineTo));
    const hi = Math.min(sweep.max, Math.max(fineFrom, fineTo));
    for (let w = lo; w <= hi; w += f) set.add(w);
    set.add(hi);
  }
  return [...set].filter((w) => w >= sweep.min && w <= sweep.max).sort((a, b) => a - b);
}

/**
 * FAST geometry-only fingerprint of a block at the current viewport: root size +
 * aspect, every visible top-level child's rect normalized to the block, and a
 * visible-leaf census (links/media/form/text). Container-normalized coordinates
 * make it scroll-independent and comparable across two independently-authored
 * DOMs. Returns null if the root is absent.
 */
export async function captureGeom(page, selector) {
  return page
    .evaluate((sel) => {
      const round4 = (n) => Math.round(n * 10000) / 10000;
      const root = document.querySelector(sel);
      if (!root) return null;
      const rr = root.getBoundingClientRect();
      const rw = rr.width || 1;
      const rh = rr.height || 1;
      const kids = [];
      let idx = -1;
      for (const el of root.children) {
        idx += 1;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0.5 && r.height <= 0.5) continue;
        kids.push({
          idx,
          tag: el.tagName.toLowerCase(),
          nx: round4((r.x - rr.x) / rw),
          ny: round4((r.y - rr.y) / rh),
          nw: round4(r.width / rw),
          nh: round4(r.height / rh),
        });
      }
      const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
      const MEDIA = new Set(["img", "svg", "picture", "video", "canvas"]);
      const FORM = new Set(["input", "textarea", "select"]);
      const INTERACTIVE = new Set(["a", "button"]);
      let links = 0;
      let media = 0;
      let form = 0;
      let textLeaf = 0;
      for (const el of root.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0.5 && r.height <= 0.5) continue;
        const tag = el.tagName.toLowerCase();
        if (INTERACTIVE.has(tag)) links += 1;
        else if (MEDIA.has(tag)) media += 1;
        else if (FORM.has(tag)) form += 1;
        else {
          let own = "";
          for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
          if (norm(own)) textLeaf += 1;
        }
      }
      const leafCount = links + media + form + textLeaf;
      return {
        rootSize: { w: Math.round(rr.width * 100) / 100, h: Math.round(rr.height * 100) / 100 },
        aspect: round4(rh / rw),
        childCount: kids.length,
        leafCount,
        leaves: { links, media, form, textLeaf },
        children: kids,
      };
    }, selector)
    .catch(() => null);
}

const COUNT_MISMATCH_PENALTY = 0.5; // top-level child count mismatch weight
const LEAF_MIN_DELTA = 1; // ignore a single-leaf jitter as noise

/**
 * Structure-independent distance between two block geometry fingerprints
 * (a=reference, b=local): the MAX of (i) aspect (h/w) delta, (ii) a fixed penalty
 * when the visible top-level child count differs, (iii) the fraction of visible
 * leaf descendants that differ. It never diffs per-child rects by index (the two
 * DOMs are independently authored). Missing geometry is a full divergence (1).
 * Returns { dist, worst }. Pure.
 */
export function geomDistance(a, b) {
  if (!a || !b) return { dist: 1, worst: !a && !b ? "both-missing" : !a ? "reference-missing" : "local-missing" };
  const aspectDelta = Math.abs((a.aspect ?? 0) - (b.aspect ?? 0));
  const countTerm = a.childCount !== b.childCount ? COUNT_MISMATCH_PENALTY : 0;
  const la = a.leafCount ?? 0;
  const lb = b.leafCount ?? 0;
  const leafDelta = Math.abs(la - lb);
  const leafTerm = leafDelta > LEAF_MIN_DELTA ? Math.min(1, leafDelta / Math.max(1, la, lb)) : 0;
  let dist = aspectDelta;
  let worst = `aspect(h/w) reference ${a.aspect} vs local ${b.aspect} (delta ${r4(aspectDelta)})`;
  if (countTerm > dist) {
    dist = countTerm;
    worst = `visible top-level child count reference ${a.childCount} vs local ${b.childCount} (delta-aspect ${r4(aspectDelta)})`;
  }
  if (leafTerm > dist) {
    dist = leafTerm;
    worst = `visible leaf count reference ${la} vs local ${lb} (delta ${leafDelta}, ${Math.round(leafTerm * 100)}% of leaves reflowed away)`;
  }
  return { dist: r4(dist), worst };
}

/** Median of a numeric array. */
export function median(nums) {
  const a = [...nums].filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** p-th percentile (0..100) of a numeric array (nearest-rank). The band-detection
 *  baseline: a LOW percentile isolates the aligned-tier floor even when divergence
 *  spans the majority of widths (the median would sit inside the divergent zone). */
export function percentile(nums, p) {
  const a = [...nums].filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
  return a[idx];
}

function regimeOf(s) {
  const lv = s.reference ?? s.live;
  const lo = s.local;
  if (!lv || !lo) return "structural";
  if (typeof lv.childCount !== "number" || typeof lo.childCount !== "number") return "structural";
  const countMismatch = lv.childCount !== lo.childCount;
  const la = lv.leafCount ?? 0;
  const lb = lo.leafCount ?? 0;
  const leafMismatch = Math.abs(la - lb) > 1;
  return countMismatch || leafMismatch ? "tier" : "shape";
}

function attributeEdge(edge, jumpTol) {
  if (edge.jumpRef > jumpTol && edge.jumpLocal <= jumpTol) return "reference-reflow (reference crossed a tier boundary here, local did not)";
  if (edge.jumpLocal > jumpTol && edge.jumpRef <= jumpTol) return "local-reflow (local crossed a tier boundary here, reference did not)";
  if (edge.jumpRef > jumpTol && edge.jumpLocal > jumpTol) return "both-reflow (both sites crossed boundaries here at different scales)";
  return "gap-persists (divergence carried in from the previous width — one site reflowed earlier and the other has not yet caught up)";
}

function bandEvidence(regime, peak) {
  const lv = peak.reference ?? peak.live;
  const lo = peak.local;
  const asp = lv && lo ? `aspect(h/w) reference ${lv.aspect} vs local ${lo.aspect} (delta ${r4(Math.abs(lv.aspect - lo.aspect))})` : "aspect n/a";
  const leaves =
    lv && lo ? `visible leaves reference ${lv.leafCount}(${lv.leaves ? `${lv.leaves.links}a/${lv.leaves.media}img/${lv.leaves.form}f/${lv.leaves.textLeaf}t` : "?"}) vs local ${lo.leafCount}` : "leaves n/a";
  if (regime === "tier") {
    return `TIER MISMATCH @${peak.width}px: the two sites are in DIFFERENT responsive tiers here (one reflowed, the other did not) — top-level children reference ${lv?.childCount} vs local ${lo?.childCount}; ${leaves}. ${asp}. Driver: ${peak.worst}`;
  }
  if (regime === "shape") {
    return `SHAPE DIVERGENCE @${peak.width}px: same structure but ${asp} — the block renders at a materially different height/layout on the two sites. Driver: ${peak.worst}`;
  }
  return `STRUCTURAL @${peak.width}px: ${peak.worst}`;
}

/**
 * Turn a per-width divergence series into tier-divergence BANDS. Input series
 * (ascending width): [{ width, dist, jumpRef, jumpLocal, worst, reference, local }].
 * A width is divergent when its cross-site dist exceeds the baseline percentile
 * by more than `tol` AND clears the absolute floor. Contiguous divergent widths
 * coalesce; a run splits whenever the tier regime (tier/shape) or the severity
 * (major/minor) changes. Each band names its peak, argmax width, and attributes
 * the leading edge to whichever site crossed a tier boundary there. Pure.
 */
export function computeBands(series, step, opts = {}) {
  const tol = opts.tol ?? DEFAULT_SWEEP.tol;
  const absFloor = opts.absFloor ?? DEFAULT_SWEEP.absFloor;
  const jumpTol = opts.jumpTol ?? DEFAULT_SWEEP.jumpTol;
  const baselinePctl = opts.baselinePctl ?? DEFAULT_SWEEP.baselinePctl;
  const strongTol = opts.strongTol ?? DEFAULT_SWEEP.strongTol;
  const baseline = percentile(series.map((s) => s.dist), baselinePctl);
  const threshold = Math.max(baseline + tol, absFloor);
  const segKey = (s) => `${regimeOf(s)}|${s.dist >= strongTol ? "major" : "minor"}`;
  const bands = [];
  let i = 0;
  while (i < series.length) {
    if (series[i].dist <= threshold) {
      i += 1;
      continue;
    }
    const key = segKey(series[i]);
    const reg = regimeOf(series[i]);
    let j = i;
    while (j + 1 < series.length && series[j + 1].dist > threshold && segKey(series[j + 1]) === key) j += 1;
    let peakIdx = i;
    for (let k = i; k <= j; k += 1) if (series[k].dist > series[peakIdx].dist) peakIdx = k;
    const edge = series[i];
    bands.push({
      from: series[i].width,
      to: series[j].width + step - 1,
      regime: reg,
      severity: series[peakIdx].dist >= strongTol ? "major" : "minor",
      widthsSampled: series.slice(i, j + 1).map((s) => s.width),
      peakDist: series[peakIdx].dist,
      peakAtWidth: series[peakIdx].width,
      baseline: r4(baseline),
      threshold: r4(threshold),
      evidence: bandEvidence(reg, series[peakIdx]),
      leadingEdge: {
        width: edge.width,
        jumpRef: edge.jumpRef,
        jumpLocal: edge.jumpLocal,
        attribution: attributeEdge(edge, jumpTol),
      },
      sampleAtPeak: { width: series[peakIdx].width, reference: series[peakIdx].reference, local: series[peakIdx].local },
    });
    i = j + 1;
  }
  return { baseline: r4(baseline), threshold: r4(threshold), bands };
}

/**
 * Build the per-width divergence series for ONE block from two ascending geometry
 * timelines (geomRef[i]/geomLocal[i] captured at widths[i]). Pure.
 */
export function seriesForBlock(widths, geomRef, geomLocal) {
  const series = [];
  for (let i = 0; i < widths.length; i += 1) {
    const reference = geomRef[i];
    const local = geomLocal[i];
    const { dist, worst } = geomDistance(reference, local);
    const jumpRef = i === 0 ? 0 : geomDistance(reference, geomRef[i - 1]).dist;
    const jumpLocal = i === 0 ? 0 : geomDistance(local, geomLocal[i - 1]).dist;
    series.push({
      width: widths[i],
      dist,
      jumpRef,
      jumpLocal,
      worst,
      reference: reference
        ? { rootSize: reference.rootSize, aspect: reference.aspect, childCount: reference.childCount, leafCount: reference.leafCount, leaves: reference.leaves, children: reference.children }
        : null,
      local: local ? { rootSize: local.rootSize, aspect: local.aspect, childCount: local.childCount, leafCount: local.leafCount, leaves: local.leaves, children: local.children } : null,
    });
  }
  return series;
}

// ============================================================ per-width settle
/**
 * Fast per-width re-settle for the block-loop: re-pin carousels (the resize can
 * re-arm autoplay), scroll the block back into view (responsive reflow moves it),
 * and wait for fonts+images to be byte-stable before measuring — but NOT
 * re-navigate. Keeps a single block+width run seconds-fast.
 */
export async function reSettle(page, selector, pinScripts = []) {
  try {
    const loc = page.locator(selector).first();
    if (await loc.count()) await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  } catch {
    /* best-effort */
  }
  await pinCarousels(page, pinScripts);
  await waitForStableRender(page);
  await page.waitForTimeout(250);
}

/** Fast per-width re-settle for the geometry sweep: flush layout after resize
 *  (two rAFs + a short pause). No re-nav, no image wait, no screenshot. */
export async function sweepSettle(page) {
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))).catch(() => {});
  await page.waitForTimeout(60);
}

/** Pixel-channel per-width settle: re-pin + byte-stable wait, no per-block scroll
 *  (captureBlock scrolls + re-pins each block itself at the moment of its shot). */
export async function pixelPassSettle(page, pinScripts = []) {
  await pinCarousels(page, pinScripts);
  await waitForStableRender(page);
  await page.waitForTimeout(250);
}

// ============================================================ asset byte parity
/**
 * Collect every <img> (currentSrc — the actually loaded variant) and every
 * background-image url() in the block subtree, in DOM order, with the resolved
 * absolute URL, rendered box size, and (for <img>) natural size. Runs in-page.
 */
export async function collectAssets(page, selector) {
  return page
    .evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return null;
      const isVis = (el, r) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) !== 0 && r.width > 0.5 && r.height > 0.5;
      };
      const pathOf = (el) => {
        const parts = [];
        let cur = el;
        while (cur && cur !== root && cur !== document.body) {
          const tag = cur.tagName.toLowerCase();
          let idx = 1;
          let sib = cur;
          while ((sib = sib.previousElementSibling)) if (sib.tagName === cur.tagName) idx += 1;
          parts.unshift(`${tag}:nth-of-type(${idx})`);
          cur = cur.parentElement;
          if (parts.length > 8) break;
        }
        return parts.join(">") || el.tagName.toLowerCase();
      };
      const seen = [];
      for (const el of [root, ...root.querySelectorAll("*")]) {
        const r = el.getBoundingClientRect();
        if (!isVis(el, r)) continue;
        if (el.tagName.toLowerCase() === "img") {
          const url = el.currentSrc || el.src || "";
          if (url) {
            seen.push({
              kind: "img",
              url,
              path: pathOf(el),
              rendered: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
              natural: { w: el.naturalWidth || 0, h: el.naturalHeight || 0 },
            });
          }
        }
        const cs = getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (bg && bg !== "none") {
          const m = /url\((["']?)([^)]*)\1\)/.exec(bg);
          if (m && m[2]) {
            let abs = m[2];
            try {
              abs = new URL(m[2], location.href).href;
            } catch {
              /* keep raw */
            }
            if (!abs.startsWith("data:") || abs.length < 4096) {
              seen.push({ kind: "bg", url: abs, path: pathOf(el), rendered: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }, natural: null });
            }
          }
        }
      }
      return seen;
    }, selector)
    .catch(() => []);
}

/** SHA-256 hex of a Buffer/Uint8Array. */
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Fetch an asset's bytes (or decode a data: URI). Returns { bytes, error }. */
async function fetchBytes(url) {
  if (!url) return { bytes: null, error: "empty-url" };
  if (url.startsWith("data:")) {
    try {
      const comma = url.indexOf(",");
      const meta = url.slice(5, comma);
      const data = url.slice(comma + 1);
      const bytes = /;base64/i.test(meta) ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data), "utf8");
      return { bytes, error: null };
    } catch (err) {
      return { bytes: null, error: `data-decode:${err.message}` };
    }
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return { bytes: null, error: `http-${res.status}` };
    const ab = await res.arrayBuffer();
    return { bytes: Buffer.from(ab), error: null };
  } catch (err) {
    return { bytes: null, error: `fetch:${err.name === "AbortError" ? "timeout" : err.message}` };
  }
}

/**
 * Asset BYTE parity. Pair the two asset lists by DOM order, then for each pair
 * download BOTH sides' bytes, hash them, and compare hashes + rendered geometry
 * (tol floors.geomTolPx) + natural size (exact). An entry is emitted only on a
 * real mismatch (bytes differ, geometry differs, natural differs, a download
 * errored, or the block has a different asset COUNT). Returns { entries, checked }.
 */
export async function assetParity(refAssets, localAssets, floors = DEFAULT_FLOORS) {
  const entries = [];
  const ref = refAssets || [];
  const local = localAssets || [];
  const count = Math.min(ref.length, local.length);
  for (let k = ref.length; k < local.length; k += 1) entries.push({ index: k, reason: "unpaired-local", path: local[k].path, local: local[k].url });
  for (let k = local.length; k < ref.length; k += 1) entries.push({ index: k, reason: "unpaired-reference", path: ref[k].path, reference: ref[k].url });
  let checked = 0;
  for (let k = 0; k < count; k += 1) {
    const rA = ref[k];
    const lA = local[k];
    checked += 1;
    const [rB, lB] = await Promise.all([fetchBytes(rA.url), fetchBytes(lA.url)]);
    const reasons = [];
    if (Math.abs(rA.rendered.w - lA.rendered.w) > floors.geomTolPx || Math.abs(rA.rendered.h - lA.rendered.h) > floors.geomTolPx) reasons.push("rendered-size");
    if (rA.natural && lA.natural && (rA.natural.w !== lA.natural.w || rA.natural.h !== lA.natural.h)) reasons.push("natural-size");
    let refHash = null;
    let localHash = null;
    if (rB.error || lB.error) {
      reasons.push(`fetch-error(reference:${rB.error || "ok"},local:${lB.error || "ok"})`);
    } else {
      refHash = sha256(rB.bytes);
      localHash = sha256(lB.bytes);
      if (refHash !== localHash) reasons.push("bytes");
    }
    if (reasons.length) {
      entries.push({
        index: k,
        kind: rA.kind,
        path: lA.path,
        reasons,
        referenceUrl: rA.url,
        localUrl: lA.url,
        referenceRendered: rA.rendered,
        localRendered: lA.rendered,
        referenceNatural: rA.natural,
        localNatural: lA.natural,
        referenceBytes: rB.bytes ? rB.bytes.length : null,
        localBytes: lB.bytes ? lB.bytes.length : null,
        referenceHash: refHash ? refHash.slice(0, 16) : null,
        localHash: localHash ? localHash.slice(0, 16) : null,
      });
    }
  }
  return { entries, checked };
}

// ============================================================ suite verdict
/**
 * Roll up the L1..L5 layer verdicts from the measured mismatch counts. Pure so it
 * can be red-green proven without a browser. `byWidth` maps each breakpoint name
 * to whether the overlay floor held there AND the width-invariant layers passed.
 * Returns { status, met, pass, layers } — the signed acceptance shape.
 */
export function rollupVerdict({ contentDiffs, elementDiffs, minOverlayScore, hoverDiffs, behaviourFails, byWidth, floor }) {
  const l1 = { pass: contentDiffs.length === 0, nonEmptySections: contentDiffs.map((c) => c.section) };
  const l2 = { pass: elementDiffs.length === 0, violations: elementDiffs.length };
  const l3 = { pass: minOverlayScore >= floor, minScore: r4(minOverlayScore), floor };
  const l4 = { pass: hoverDiffs.length === 0 && behaviourFails === 0, hoverMismatches: hoverDiffs.length, behaviorFailures: behaviourFails };
  const l5 = { pass: Object.values(byWidth).every(Boolean), byWidth };
  const allClean = l1.pass && l2.pass && l3.pass && l4.pass && l5.pass;
  return {
    status: allClean ? "passed" : "failing",
    met: allClean,
    pass: allClean,
    layers: { L1_content: l1, L2_elementStyle: l2, L3_overlay: l3, L4_behavior: l4, L5_breakpoints: l5 },
  };
}

/** True when the error is a missing-dependency (lazy-require) failure. */
export function isDependencyError(err) {
  return Boolean(
    err &&
      (err.dependency ||
        err.code === "ERR_MODULE_NOT_FOUND" ||
        err.code === "MODULE_NOT_FOUND" ||
        /Cannot find (package|module)/i.test(err.message ?? "")),
  );
}
