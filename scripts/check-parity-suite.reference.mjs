// REFERENCE IMPLEMENTATION — multi-layer parity suite (the attentive-human gate).
//
// This is the "give feedback like an attentive human, overlaying the two variants
// on top of each other" mechanism earned on a real pixel-perfect replication
// campaign and genericized for the factory. It compares the local build against a
// declared reference URL at every configured breakpoint on FIVE layers and emits
// a worst-first, actionable report + auditable artifacts:
//
//   L1 CONTENT        — normalized per-section innerText diff (no tolerance).
//   L2 ELEMENT STYLE  — computed-style/box matrix of curated key elements
//                       (fonts/colors exact, box +-boxTolPx, position +-positionTolPx).
//   L3 SECTION OVERLAY — per-section AA-tolerant pixelmatch + 50/50 blend PNGs,
//                       gated on floors.sectionScoreFloor.
//   L4 HOVER/BEHAVIOUR — hover before/after deltas + boolean behaviour probes.
//                       The persistence probe is IN-CONTEXT (the B1 lesson):
//                       verify the banner is WITHIN the viewport, dismiss it,
//                       RELOAD THE SAME CONTEXT (cookies/localStorage retained),
//                       then assert it stays off-screen — never a fresh context
//                       (which has empty storage), never a CSS-only isVisible check
//                       (a site can park a dismissed banner just below the fold).
//   L5 BREAKPOINTS    — L1..L4 hold at every configured width.
//
// Everything is driven by quality/parity.config.json (copy from
// templates/quality/parity.config.template.json): referenceUrl, localUrl,
// breakpoints, sections, elements, hover, behaviors, masks, floors, sweep, and the
// capture-determinism knobs (cookieDismissSelectors, suppressSelectors,
// counterSelectors, pinScripts, renderGates). NO site-specific value lives here.
//
// PRIME DIRECTIVE compliance (three-valued config presence):
//   - config missing + NO product code  -> SKIP-pending, exit 0 (pre-phase).
//   - config missing + product code      -> NOT-EARNED, exit 1 (post-phase
//     emptiness is never success).
//   - playwright / pixelmatch / pngjs absent -> FAIL, exit 1, install hint.
//
// A render-gate (PD-16) that never fills FAILS the affected breakpoint with a
// named reason — a half-rendered page is never scored.
//
// Stdout conventions (shared across all factory checks): one
// "Scope: <n> ..." line and one final "Result: PASS|FAIL|SKIP-pending|NOT-EARNED".
//
// Usage:
//   node scripts/check-parity-suite.mjs [--config quality/parity.config.json]
//     [--breakpoints 1440,390]   # subset for a fast smoke run
//     [--out docs/qa/parity]
//   Test hook: CHECK_PARITY_ADAPTERS=<module.mjs> exporting { launch } that
//   returns a Playwright-compatible browser (used by the served-fixture e2e test).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  writeJson,
  writeArtifact,
  normalizeText,
  diffElementStyles,
  diffHoverStates,
  sectionDiff,
  preparePage,
  gotoWithRetry,
  collectStyle,
  shootSection,
  resolveElementSelectors,
  rollupVerdict,
  validateConfig,
  isDependencyError,
  loadDep,
  INSTALL_HINT,
} from "./lib/parity-capture.reference.mjs";

const DEFAULTS = Object.freeze({
  configPath: "quality/parity.config.json",
  outDir: "docs/qa/parity",
});

function parseArgs(argv) {
  const get = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : d;
  };
  return {
    configPath: get("--config", DEFAULTS.configPath),
    outDir: get("--out", DEFAULTS.outDir),
    bpFilter: get("--breakpoints", ""),
  };
}

function selectBreakpoints(all, filter) {
  if (!filter) return all;
  const wanted = new Set(filter.split(",").map((s) => s.trim()));
  const chosen = all.filter((b) => wanted.has(b.name) || wanted.has(String(b.width)));
  return chosen.length ? chosen : all;
}

// -------------------------------------------------------- behaviour probes
// Generic, config-driven probe types. Each runs the SAME logic on the reference
// and local page and returns a boolean (or null when not applicable / errored).
// A FAIL is when the two booleans disagree, or the local probe errors while the
// reference one succeeds.

/** True only when the element is actually WITHIN the viewport (what a human
 *  sees), not merely CSS-visible — the crux of the in-context persistence lesson:
 *  a site can "dismiss" a banner by sliding it just below the fold (still
 *  display:block), which a plain isVisible() check wrongly reads as still shown. */
async function onScreen(page, selector) {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
    }, selector)
    .catch(() => false);
}

async function probeSingleOpen(page, spec) {
  const items = page.locator(spec.itemSelector);
  const n = await items.count();
  if (n < 2) return null;
  const isOpen = async (i) =>
    items.nth(i).evaluate((el) => {
      const hdr = el.querySelector("[aria-expanded]");
      if (hdr) return hdr.getAttribute("aria-expanded") === "true";
      if (/(^|\s)(open|opened|active|expanded)(\s|$)/.test(el.className)) return true;
      const panel = el.querySelector("[id],div,section,ul");
      return panel ? panel.getBoundingClientRect().height > 4 : false;
    });
  const clickHead = async (i) => {
    const trig = spec.triggerSelector
      ? items.nth(i).locator(spec.triggerSelector).first()
      : items.nth(i).locator("button, [role='button'], [aria-expanded], summary, h2, h3, header").first();
    await ((await trig.count()) ? trig : items.nth(i)).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);
  };
  await clickHead(0);
  const firstOpen = await isOpen(0).catch(() => false);
  await clickHead(1);
  const firstStillOpen = await isOpen(0).catch(() => false);
  return firstOpen && !firstStillOpen;
}

async function probeToggleVisible(page, spec) {
  const trigger = page.locator(spec.trigger).first();
  if ((await trigger.count()) === 0) return null;
  await trigger.click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(400);
  const target = page.locator(spec.target).first();
  return await target.isVisible({ timeout: 1500 }).catch(() => false);
}

// The IN-CONTEXT persistence probe (B1). Accept/dismiss in THIS browser context,
// RELOAD the same context (storage retained), and assert the banner is no longer
// WITHIN the viewport. A fresh context would have empty storage; a CSS-only
// isVisible() would miss a banner parked off-screen — both are the classic traps.
async function probePersistDismiss(page, spec, url) {
  const banner = spec.banner;
  const dismiss = page.locator(spec.dismiss).first();
  const shownFirst = await onScreen(page, banner);
  if (!shownFirst || (await dismiss.count()) === 0) return null;
  await dismiss.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(500);
  try {
    await page.reload({ waitUntil: "load", timeout: 60000 });
  } catch {
    await gotoWithRetry(page, url, { retries: 1, timeout: 60000 });
  }
  await page.waitForTimeout(1200);
  const shownAfter = await onScreen(page, banner);
  return shownAfter === false; // persisted == banner did NOT return on-screen
}

async function probeRecompute(page, spec) {
  const input = page.locator(spec.input).first();
  if ((await input.count()) === 0) return null;
  const readOut = () =>
    page
      .locator(spec.output)
      .first()
      .evaluate((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .catch(() => "");
  const before = await readOut();
  await input
    .evaluate((el) => {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      const next = el.type === "range" || el.type === "number" ? String(Number(el.max || 100)) : `${el.value || ""}x`;
      if (desc && desc.set) desc.set.call(el, next);
      else el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })
    .catch(() => {});
  await page.waitForTimeout(400);
  const after = await readOut();
  return before !== after && after.length > 0;
}

const PROBES = {
  "single-open": probeSingleOpen,
  "toggle-visible": probeToggleVisible,
  "persist-dismiss": probePersistDismiss,
  recompute: probeRecompute,
};

async function runBehaviourProbes(browser, url, config, viewport) {
  const results = {};
  for (const spec of config.behaviors) {
    const fn = PROBES[spec.type];
    if (!fn) {
      results[spec.key] = { error: `unknown probe type "${spec.type}"` };
      continue;
    }
    const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await gotoWithRetry(page, url, { retries: 1, timeout: 90000 });
      if (spec.type === "persist-dismiss") {
        // must SEE the banner first — no preparePage (it would suppress/hide it).
        await page.waitForTimeout(1200);
        results[spec.key] = await probePersistDismiss(page, spec, url);
      } else {
        await preparePage(page, config, { role: "local" });
        results[spec.key] = await fn(page, spec);
      }
    } catch (err) {
      results[spec.key] = { error: String(err.message || err) };
    } finally {
      await ctx.close();
    }
  }
  return results;
}

// ------------------------------------------------------------------- hover
async function runHoverProbes(browser, url, config, viewport) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const out = {};
  try {
    await gotoWithRetry(page, url, { retries: 2, timeout: 90000 });
    await preparePage(page, config, { role: "local" });
    for (const spec of config.hover) {
      const section = config.sections.find((s) => s.id === spec.section);
      if (!section) continue;
      // hover selectors are section-root-relative on both sides.
      const rootSel = url === config.referenceUrl ? section.live : section.local;
      out[spec.key] = await captureHover(page, rootSel, spec).catch(() => null);
    }
  } catch {
    /* whole-page failure -> null probes recorded by caller */
  } finally {
    await ctx.close();
  }
  return out;
}

async function captureHover(page, rootSel, spec) {
  const scoped = page.locator(`${rootSel} ${spec.trigger}`).first();
  const effTrigger = (await scoped.count()) ? scoped : page.locator(spec.trigger).first();
  if ((await effTrigger.count()) === 0) return null;
  const targetSel = spec.target ? `${rootSel} ${spec.target}` : null;
  const readTarget = async () => {
    const tgt = targetSel && (await page.locator(targetSel).first().count()) ? page.locator(targetSel).first() : effTrigger;
    return tgt.evaluate((el, props) => {
      const cs = getComputedStyle(el);
      const o = {};
      for (const p of props) o[p] = cs[p];
      return o;
    }, spec.props);
  };
  await effTrigger.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
  const before = await readTarget().catch(() => null);
  await effTrigger.hover({ timeout: 2000, force: true }).catch(() => {});
  await page.waitForTimeout(250);
  const after = await readTarget().catch(() => null);
  if (!before || !after) return null;
  return { before, after };
}

// ------------------------------------------------------------------- report
function buildSummaryMd(summary) {
  const lyr = summary.layers;
  const tick = (b) => (b ? "PASS" : "FAIL");
  const L = [];
  L.push(`# Parity report — attentive-human overlay`);
  L.push("");
  L.push(`Status: **${summary.status}** · overlay min ${summary.score} · met ${summary.met}`);
  L.push(`Generated ${summary.generatedAt} · local ${summary.localUrl} vs reference ${summary.referenceUrl}`);
  L.push(`Breakpoints: ${summary.breakpointNames.join(", ")}`);
  L.push("");
  L.push(`| Layer | Metric | Value | Pass |`);
  L.push(`|---|---|---:|:--:|`);
  L.push(`| L1 CONTENT | non-empty section diffs | ${summary.contentMismatches} | ${tick(lyr.L1_content.pass)} |`);
  L.push(`| L2 ELEMENT STYLE | mismatches | ${summary.elementMismatches} | ${tick(lyr.L2_elementStyle.pass)} |`);
  L.push(`| L3 SECTION OVERLAY | min score (floor ${lyr.L3_overlay.floor}) | ${lyr.L3_overlay.minScore} | ${tick(lyr.L3_overlay.pass)} |`);
  L.push(`| L4 BEHAVIOR/HOVER | hover / behaviour fails | ${summary.hoverMismatches} / ${summary.behaviourFails} | ${tick(lyr.L4_behavior.pass)} |`);
  L.push(`| L5 BREAKPOINTS | widths holding | ${Object.values(lyr.L5_breakpoints.byWidth).filter(Boolean).length}/${summary.breakpointNames.length} | ${tick(lyr.L5_breakpoints.pass)} |`);
  L.push("");
  L.push(`## Sections ranked worst-first`);
  L.push("");
  L.push(`| Section | Worst score | Worst @ | wDelta | hDelta | Elem | Content |`);
  L.push(`|---|---:|---|---:|---:|---:|---:|`);
  for (const s of summary.ranked) {
    L.push(`| ${s.id} | ${s.worstScore} | ${s.worstAt} | ${s.wDelta}px | ${s.hDelta}px | ${s.elementMismatches} | ${s.contentMismatches} |`);
  }
  L.push("");
  if (summary.topFindings.length) {
    L.push(`## Top findings (fix these first)`);
    L.push("");
    for (const f of summary.topFindings) L.push(`- ${f}`);
    L.push("");
  }
  if (summary.behaviours.length) {
    L.push(`## Behaviour probes`);
    L.push("");
    L.push(`| Probe | Reference | Local | Pass |`);
    L.push(`|---|---|---|:--:|`);
    for (const b of summary.behaviours) L.push(`| ${b.key} | ${b.reference} | ${b.local} | ${b.pass ? "PASS" : "FAIL"} |`);
    L.push("");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------- run
/** The capture/diff pipeline for a validated config against an injected browser.
 *  Returns { pass, summary, failures }. Never scores a page whose render-gates
 *  did not fill (that sample is failed with a named reason). */
async function runSuite({ config, browser, breakpoints, outAbs }) {
  const { sections, floors } = config;
  const matrixBp = breakpoints.find((b) => b.name === config.matrixBreakpoint) ?? breakpoints[breakpoints.length - 1];
  const failures = [];

  const perSection = new Map();
  for (const s of sections) perSection.set(s.id, { id: s.id, label: s.label, scores: {}, wDelta: 0, hDelta: 0, elementMismatches: 0, contentMismatches: 0 });
  const styleSnaps = { reference: {}, local: {} };
  const textSnaps = { reference: {}, local: {} };
  const gateFailures = []; // { breakpoint, role, missing }

  // ---------------- L1 capture + overlay, per breakpoint -------------------
  for (const bp of breakpoints) {
    const viewport = { width: bp.width, height: bp.height };
    const pages = {};
    for (const [role, url] of [
      ["reference", config.referenceUrl],
      ["local", config.localUrl],
    ]) {
      const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      let renderGates = { ok: true, missing: [] };
      try {
        await gotoWithRetry(page, url, { retries: 2, timeout: 90000 });
        ({ renderGates } = await preparePage(page, config, { role }));
      } catch (err) {
        failures.push({ id: `${bp.name}/${role}`, msg: `navigation/prepare failed: ${err.message}` });
      }
      if (!renderGates.ok) {
        const named = renderGates.missing.map((m) => m.selector).join(", ");
        gateFailures.push({ breakpoint: bp.name, role, missing: renderGates.missing });
        failures.push({ id: `${bp.name}/${role}`, msg: `render-gate never filled: ${named} — page is half-rendered, sample failed (never scored)` });
      }
      pages[role] = { ctx, page, role, gatedOk: renderGates.ok };
    }

    const bpUsable = pages.reference.gatedOk && pages.local.gatedOk;
    for (const s of sections) {
      const acc = perSection.get(s.id);
      if (!bpUsable) {
        writeJson(outAbs(`${bp.name}/${s.id}/score.json`), { section: s.id, breakpoint: bp.name, score: null, reason: "render-gate not satisfied on one side" });
        acc.scores[bp.name] = 0;
        continue;
      }
      const refPng = await shootSection(pages.reference.page, s.live, config.prepare.pinScripts);
      const localPng = await shootSection(pages.local.page, s.local, config.prepare.pinScripts);
      const dir = `${bp.name}/${s.id}`;
      if (!refPng || !localPng) {
        writeJson(outAbs(`${dir}/score.json`), { section: s.id, breakpoint: bp.name, score: null, reason: `${!refPng ? "reference" : "local"} section not captured`, refPresent: !!refPng, localPresent: !!localPng });
        acc.scores[bp.name] = 0;
        continue;
      }
      const d = await sectionDiff(refPng, localPng, floors);
      writeArtifact(outAbs(`${dir}/ref.png`), refPng);
      writeArtifact(outAbs(`${dir}/local.png`), localPng);
      writeArtifact(outAbs(`${dir}/diff.png`), d.diffPng);
      writeArtifact(outAbs(`${dir}/overlay-blend.png`), d.blendPng);
      writeJson(outAbs(`${dir}/score.json`), { section: s.id, breakpoint: bp.name, score: d.score, wDelta: d.wDelta, hDelta: d.hDelta, refSize: { w: d.refW, h: d.refH }, localSize: { w: d.localW, h: d.localH } });
      acc.scores[bp.name] = d.score;
      if (Math.abs(d.wDelta) > Math.abs(acc.wDelta)) acc.wDelta = d.wDelta;
      if (Math.abs(d.hDelta) > Math.abs(acc.hDelta)) acc.hDelta = d.hDelta;
    }

    // L2/L3 snapshots on the matrix breakpoint (both pages already loaded).
    if (bp.name === matrixBp.name && bpUsable) {
      for (const s of sections) {
        textSnaps.reference[s.id] = normalizeText(await pages.reference.page.locator(s.live).first().innerText({ timeout: 3000 }).catch(() => ""));
        textSnaps.local[s.id] = normalizeText(await pages.local.page.locator(s.local).first().innerText({ timeout: 3000 }).catch(() => ""));
      }
      for (const entry of config.elements) {
        const section = sections.find((x) => x.id === entry.section);
        if (!section) continue;
        const sel = resolveElementSelectors(entry, section, config.pickMap);
        styleSnaps.reference[entry.key] = { ...(await collectStyle(pages.reference.page, sel.live)), role: entry.role, section: entry.section };
        styleSnaps.local[entry.key] = { ...(await collectStyle(pages.local.page, sel.local)), role: entry.role, section: entry.section };
      }
    }

    await pages.reference.ctx.close();
    await pages.local.ctx.close();
  }

  // ---------------- L2 element matrix diff ---------------------------------
  const elementDiffs = [];
  for (const entry of config.elements) {
    const ref = styleSnaps.reference[entry.key];
    const local = styleSnaps.local[entry.key];
    const refOk = ref && (ref.styles || ref.box) ? ref : null;
    const localOk = local && (local.styles || local.box) ? local : null;
    const diffs = diffElementStyles(entry.key, entry.role, refOk, localOk, floors);
    if (diffs.length) {
      elementDiffs.push(...diffs.map((d) => ({ ...d, section: entry.section })));
      const acc = perSection.get(entry.section);
      if (acc) acc.elementMismatches += diffs.length;
    }
  }
  writeJson(outAbs("element-diff.json"), { generatedAt: new Date().toISOString(), breakpoint: matrixBp.name, tolerances: { fonts: "exact", colors: "exact", box: `+-${floors.boxTolPx}px`, position: `+-${floors.positionTolPx}px` }, mismatches: elementDiffs });

  // ---------------- L1 content diff ----------------------------------------
  const contentDiffs = [];
  for (const s of sections) {
    const r = textSnaps.reference[s.id] ?? "";
    const l = textSnaps.local[s.id] ?? "";
    if (r !== l) {
      contentDiffs.push({ section: s.id, reference: r, local: l });
      const acc = perSection.get(s.id);
      if (acc) acc.contentMismatches += 1;
    }
  }
  writeJson(outAbs("content-diff.json"), { generatedAt: new Date().toISOString(), breakpoint: matrixBp.name, mismatches: contentDiffs });

  // ---------------- L4 hover + behaviour -----------------------------------
  const hoverViewport = { width: matrixBp.width, height: matrixBp.height };
  const hoverDiffs = [];
  const behaviours = [];
  let behaviourFails = 0;
  if (config.hover.length) {
    const [refHover, localHover] = [
      await runHoverProbes(browser, config.referenceUrl, config, hoverViewport),
      await runHoverProbes(browser, config.localUrl, config, hoverViewport),
    ];
    for (const spec of config.hover) hoverDiffs.push(...diffHoverStates(spec.key, spec.note, spec.props, refHover[spec.key], localHover[spec.key]));
  }
  writeJson(outAbs("hover-diff.json"), { generatedAt: new Date().toISOString(), viewport: hoverViewport, mismatches: hoverDiffs });

  if (config.behaviors.length) {
    const refBeh = await runBehaviourProbes(browser, config.referenceUrl, config, hoverViewport);
    const localBeh = await runBehaviourProbes(browser, config.localUrl, config, hoverViewport);
    for (const b of config.behaviors) {
      const ref = refBeh[b.key];
      const loc = localBeh[b.key];
      const norm = (v) => (v && typeof v === "object" && "error" in v ? `error:${v.error}` : String(v));
      const refBool = typeof ref === "boolean" ? ref : null;
      const locBool = typeof loc === "boolean" ? loc : null;
      const pass = refBool === null ? locBool !== false && locBool !== null : locBool === refBool;
      if (!pass) behaviourFails += 1;
      behaviours.push({ key: b.key, note: b.note, reference: norm(ref), local: norm(loc), pass });
    }
  }
  writeJson(outAbs("behavior-diff.json"), { generatedAt: new Date().toISOString(), viewport: hoverViewport, probes: behaviours, fails: behaviourFails });

  // ---------------- summary + gating ---------------------------------------
  const floor = floors.sectionScoreFloor;
  const perSectionArr = [...perSection.values()].map((a) => {
    let worstScore = 1;
    let worstAt = "-";
    for (const [bpName, sc] of Object.entries(a.scores)) {
      if (sc <= worstScore) {
        worstScore = sc;
        worstAt = bpName;
      }
    }
    return { ...a, worstScore: Math.round(worstScore * 10000) / 10000, worstAt };
  });
  const minOverlayScore = perSectionArr.reduce((m, s) => Math.min(m, s.worstScore), 1);

  const widthInvariantOk = contentDiffs.length === 0 && elementDiffs.length === 0 && hoverDiffs.length === 0 && behaviourFails === 0;
  const byWidth = {};
  for (const bp of breakpoints) {
    const overlayOkAtW = perSectionArr.every((s) => (s.scores[bp.name] ?? 0) >= floor);
    byWidth[bp.name] = overlayOkAtW && widthInvariantOk && !gateFailures.some((g) => g.breakpoint === bp.name);
  }
  const verdict = rollupVerdict({ contentDiffs, elementDiffs, minOverlayScore, hoverDiffs, behaviourFails, byWidth, floor });
  // A render-gate failure forces an overall fail even if the scored layers passed.
  const allClean = verdict.pass && gateFailures.length === 0 && failures.length === 0;

  const ranked = [...perSectionArr].sort((a, b) => a.worstScore - b.worstScore).map((s) => ({ id: s.id, worstScore: s.worstScore, worstAt: s.worstAt, wDelta: s.wDelta, hDelta: s.hDelta, elementMismatches: s.elementMismatches, contentMismatches: s.contentMismatches }));

  const topFindings = [];
  for (const s of ranked.slice(0, 3)) if (s.worstScore < floor) topFindings.push(`L3 ${s.id}: overlay score ${s.worstScore} @${s.worstAt} (hDelta ${s.hDelta}px, wDelta ${s.wDelta}px)`);
  for (const e of elementDiffs.slice(0, 5)) topFindings.push(`L2 ${e.section}/${e.key}.${e.prop}: reference=${e.ref} local=${e.local} (${e.tol})`);
  for (const c of contentDiffs.slice(0, 3)) topFindings.push(`L1 ${c.section}: content differs`);
  for (const b of behaviours.filter((x) => !x.pass)) topFindings.push(`L4 behaviour ${b.key}: reference=${b.reference} local=${b.local}`);
  for (const g of gateFailures) topFindings.push(`RENDER-GATE ${g.breakpoint}/${g.role}: ${g.missing.map((m) => m.selector).join(", ")} never filled`);

  const summary = {
    status: allClean ? "passed" : "failing",
    score: Math.round(minOverlayScore * 10000) / 10000,
    met: allClean,
    breakpoints: breakpoints.map((b) => b.width),
    layers: verdict.layers,
    generatedAt: new Date().toISOString(),
    localUrl: config.localUrl,
    referenceUrl: config.referenceUrl,
    breakpointNames: breakpoints.map((b) => b.name),
    floors,
    perSection: perSectionArr.map((s) => ({ id: s.id, scores: s.scores, worstScore: s.worstScore, worstAt: s.worstAt, wDelta: s.wDelta, hDelta: s.hDelta })),
    ranked,
    elementMismatches: elementDiffs.length,
    contentMismatches: contentDiffs.length,
    hoverMismatches: hoverDiffs.length,
    behaviourFails,
    behaviours,
    renderGateFailures: gateFailures,
    topFindings,
    pass: allClean,
  };
  writeJson(outAbs("summary.json"), summary);
  writeArtifact(outAbs("summary.md"), buildSummaryMd(summary));
  return { pass: allClean, summary, failures };
}

// ---------------------------------------------------------------- adapters
async function defaultLaunch() {
  const pw = await loadDep("playwright");
  const chromium = pw.chromium ?? pw.default?.chromium;
  return chromium.launch({ headless: true });
}

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

// ------------------------------------------------------------------- main
async function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const configAbs = join(root, args.configPath);

  const finish = (result, scopeLine, resultLine) => {
    console.log(`\n${scopeLine}`);
    console.log(`Result: ${result}${resultLine ? ` — ${resultLine}` : ""}`);
    process.exit(result === "PASS" || result === "SKIP-pending" ? 0 : 1);
  };

  // --- config presence: three-valued per the prime directive
  if (!existsSync(configAbs)) {
    if (productCodePresent(root)) {
      console.error(
        `FAIL  [config] ${args.configPath} not found but product code exists — the declared parity acceptance ` +
          `method has no executable configuration. Create it from templates/quality/parity.config.template.json ` +
          `(referenceUrl, localUrl, breakpoints, sections, floors) and re-run. Absence of evidence is never success.`,
      );
      finish("NOT-EARNED", "Scope: 0 section(s)", "missing config with product code present");
    } else {
      console.log(`SKIP-pending: ${args.configPath} not found and no product code detected yet (the config becomes mandatory the moment implementation exists).`);
      finish("SKIP-pending", "Scope: 0 section(s)");
    }
    return;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(configAbs, "utf8"));
  } catch (err) {
    console.error(`FAIL  [config] ${args.configPath} is not valid JSON: ${err.message}`);
    finish("FAIL", "Scope: 0 section(s)", "invalid JSON");
    return;
  }
  const { config, errors, warnings } = validateConfig(raw);
  for (const w of warnings) console.warn(`WARN  [parity] ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`FAIL  [config] ${e}`);
    finish("FAIL", "Scope: 0 section(s)", "invalid config");
    return;
  }

  const breakpoints = selectBreakpoints(config.breakpoints, args.bpFilter);
  const outAbs = (rel) => join(root, args.outDir, rel);

  // --- browser: injected (test hook) or real Playwright
  let launch = defaultLaunch;
  const adapterPath = process.env.CHECK_PARITY_ADAPTERS;
  if (adapterPath) {
    const mod = await import(pathToFileURL(resolve(root, adapterPath)).href);
    if (typeof mod.launch === "function") launch = mod.launch;
    console.log(`(browser adapter injected from ${adapterPath})`);
  }

  let browser;
  try {
    browser = await launch();
  } catch (err) {
    if (isDependencyError(err)) {
      console.error(`FAIL  [deps] ${err.message}. Install: ${err.install ?? INSTALL_HINT}. Missing tooling is a FAILURE, never a pass.`);
    } else {
      console.error(`FAIL  [browser] launch failed: ${err.message}`);
    }
    finish("FAIL", "Scope: 0 section(s)", "browser unavailable");
    return;
  }

  let run;
  try {
    run = await runSuite({ config, browser, breakpoints, outAbs });
  } catch (err) {
    if (isDependencyError(err)) {
      console.error(`FAIL  [deps] ${err.message}. Install: ${err.install ?? INSTALL_HINT}. Missing tooling is a FAILURE, never a pass.`);
      await browser.close().catch(() => {});
      finish("FAIL", "Scope: 0 section(s)", "pixel tooling unavailable");
      return;
    }
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }

  const s = run.summary;
  const l = s.layers;
  const scopeLine = `Scope: ${config.sections.length} section(s) x ${breakpoints.length} breakpoint(s); ${config.elements.length} elements; ${config.hover.length} hover + ${config.behaviors.length} behaviour probes`;
  const resultLine =
    `L1 ${s.contentMismatches} content, L2 ${s.elementMismatches} elem, ` +
    `L3 overlay min ${l.L3_overlay.minScore} (floor ${l.L3_overlay.floor}), ` +
    `L4 ${s.hoverMismatches} hover / ${s.behaviourFails} behaviour, ` +
    `L5 ${l.L5_breakpoints.pass ? "all widths hold" : "widths fail"}` +
    (s.renderGateFailures.length ? `, ${s.renderGateFailures.length} render-gate failure(s)` : "");
  finish(run.pass ? "PASS" : "FAIL", scopeLine, resultLine);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(`FAIL  [parity] unexpected error: ${err.stack || err.message}`);
    console.log(`\nScope: 0 section(s)`);
    console.log(`Result: FAIL`);
    process.exit(1);
  });
}

export { runSuite, runBehaviourProbes, runHoverProbes, onScreen };
