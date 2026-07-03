// REFERENCE IMPLEMENTATION — process ratchet (process quality only tightens).
//
// Mechanism 5 of the reflection design
// (docs/field-reports/2026-07-02-reflection-mechanism-design.md). Where
// check-coverage-ratchet ratchets PRODUCT quality, this ratchets PROCESS
// quality — and it NEVER keys on raw warning totals: in the pixel-perfect run
// 71 of the 73 warnings were benign pre-Phase-6 growth, and a raw ratchet
// would red honest progress and train reflexive `--update`. Budgets are per
// warning CLASS and per PHASE band, configured in quality/telemetry.config.json.
//
// Guards (all deterministic, no LLM content — invariant D):
//   1. per-class phase-aware warning budgets (never raw total counts);
//   2. vacuous-pass count must be 0 once product code exists
//      (reads trace/process-health.json, the ledger-report digest);
//   3. acceptance-contract coverage is monotone vs quality/process-baseline.json;
//   4. dead-@trace alarm — @trace annotations exist in test files but 0 of
//      them join the traceability chain (reads trace/trace.json if present);
//   5. at --release: open review findings without a fix-commit or waiver = red.
//
// DIRECTION GUARD: `--update` writes quality/process-baseline.json ONLY in
// the tightening direction. Any write that would lower a metric or widen a
// budget is rejected with exit 1 — loosening requires a human waiver artifact
// under docs/qa/waivers/ plus an owner-signed entry in RULES-CHANGELOG.md.
//
// PRIME DIRECTIVE compliance: absence of evidence is never rendered as
// success. Pre-phase emptiness prints SKIP-pending; post-phase emptiness
// (product code exists but telemetry/baseline evidence is missing) prints
// NOT-EARNED. This check ships EXPERIMENTAL (see RULES-CHANGELOG.md): while
// quality/process-baseline.json is absent it prints
// "Result: NOT-EARNED (pending baseline)" and exits 0 in default mode — it
// NEVER prints PASS it has not earned. `--strict` makes NOT-EARNED exit 1
// (the CI switch flipped when this check is promoted on the ladder).
//
// Usage:
//   node scripts/check-process-ratchet.mjs             # guards + exit code
//   node scripts/check-process-ratchet.mjs --release   # + open-findings guard
//   node scripts/check-process-ratchet.mjs --strict    # NOT-EARNED exits 1
//   node scripts/check-process-ratchet.mjs --update    # tighten the baseline
//                                                      # (only direction allowed)
//
// Copy to scripts/check-process-ratchet.mjs in the target project.
// Wire as: "check:process": "node scripts/check-process-ratchet.mjs".
// Node >= 18 stdlib only — no dependencies.
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const root = process.cwd();
const flags = new Set(process.argv.slice(2));

const PATHS = {
  config: "quality/telemetry.config.json",
  baseline: "quality/process-baseline.json",
  ledger: "trace/ledger.jsonl",
  health: "trace/process-health.json",
  trace: "trace/trace.json",
  currentState: "docs/current-state.md",
  changesDir: "openspec/changes",
  waiversDir: "docs/qa/waivers",
};
const PRODUCT_DIRS = ["app", "src", "lib", "components", "pages", "server"];
const TEST_DIRS = ["lib", "tests", "test", "app", "src", "components", "evals"];
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|rb|php|vue|svelte)$/;
const IS_TEST_FILE = /\.(test|spec|eval)\.(ts|tsx|js|jsx|mjs)$/;

const failures = [];
const warnings = [];
const notEarned = []; // post-phase evidence gaps: never PASS over these
const skips = []; // pre-phase gaps: visible, never counted as PASS silently
const fail = (check, msg) => failures.push({ check, msg });
const warn = (check, msg) => warnings.push({ check, msg });
let guardsRun = 0;

// ---------- helpers ----------
const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), "utf8") : null);
function readJson(rel, label) {
  const text = read(rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    fail(label, `${rel} is not valid JSON`);
    return null;
  }
}
function* walk(dir, filter) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(abs, entry);
    if (statSync(p).isDirectory()) yield* walk(join(dir, entry), filter);
    else if (filter(entry)) yield join(dir, entry).replaceAll("\\", "/");
  }
}
const fmtPct = (x) => `${Math.round(x * 1000) / 10}%`;
// 0/0 declared is NOT 100% — an empty contract earns nothing (prime directive).
const pct = (c) =>
  c && Number.isFinite(c.covered) && Number.isFinite(c.declared) && c.declared > 0 ? c.covered / c.declared : null;

// ---------- phase + product-code heuristic ----------
function parsePhase() {
  const text = read(PATHS.currentState);
  if (text === null) return null;
  for (const line of text.split("\n")) {
    if (!/current phase/i.test(line)) continue;
    if (line.includes("{{")) continue; // untouched template placeholder
    const m = line.match(/current phase[^0-9]*(\d+)/i);
    if (m) return Number(m[1]);
  }
  return null;
}
function hasProductCode() {
  for (const dir of PRODUCT_DIRS) {
    for (const f of walk(dir, (e) => CODE_EXT.test(e) && !IS_TEST_FILE.test(e))) return true;
  }
  return false;
}
const phase = parsePhase();
const productCode = hasProductCode();
// Header claiming Phase >= 4 counts as post-phase even without code on disk:
// a claimed build phase must have evidence (mechanism 3 — disagreement never
// renders PASS).
const postPhase = productCode || (phase !== null && phase >= 4);
const phaseLabel = phase === null ? "unknown" : String(phase);

// ---------- inputs ----------
const cfg = readJson(PATHS.config, "config");
const cfgBudgets = cfg?.warningBudgets ?? null;
const health = readJson(PATHS.health, "process-health");
const baselineRaw = readJson(PATHS.baseline, "baseline");
// A copied template is NOT an earned baseline — treat as absent.
const baseline = baselineRaw && baselineRaw._template !== true ? baselineRaw : null;
const vacuous = Number.isFinite(health?.vacuousPasses)
  ? health.vacuousPasses
  : Number.isFinite(health?.vacuousPassCount)
    ? health.vacuousPassCount
    : null;
const currentCoverage = health?.acceptanceCoverage ?? null;

// ---------- budget-band helpers ----------
const bandEntries = (entry) =>
  entry ? Object.entries(entry).filter(([k]) => !k.startsWith("_") && typeof entry[k] === "number") : [];
function bandContains(key, p) {
  let m;
  if ((m = key.match(/^(\d+)-(\d+)$/))) return p >= Number(m[1]) && p <= Number(m[2]);
  if ((m = key.match(/^(\d+)\+$/))) return p >= Number(m[1]);
  if ((m = key.match(/^(\d+)$/))) return p === Number(m[1]);
  return false;
}
// Budget for the current phase; unknown phase => strictest (smallest) band,
// so a missing/mangled phase header can never widen the budget.
function budgetFor(entry, p) {
  const bands = bandEntries(entry);
  if (bands.length === 0) return null;
  if (p === null) return Math.min(...bands.map(([, v]) => v));
  const hit = bands.find(([k]) => bandContains(k, p));
  return hit ? hit[1] : null;
}

// ---------- warning counts (per class, from telemetry) ----------
function warningCounts() {
  const led = read(PATHS.ledger);
  if (led !== null) {
    const latest = new Map(); // check -> most recent event
    for (const line of led.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t);
        if (e && typeof e.check === "string") latest.set(e.check, e);
      } catch {
        /* tolerate torn writes — the ledger is fail-open by design */
      }
    }
    if (latest.size > 0) {
      const sum = {};
      for (const e of latest.values())
        for (const [cls, n] of Object.entries(e.warningsByClass ?? {})) sum[cls] = (sum[cls] ?? 0) + Number(n || 0);
      return { source: PATHS.ledger, counts: sum };
    }
  }
  if (health?.warningsByClass && typeof health.warningsByClass === "object")
    return { source: PATHS.health, counts: health.warningsByClass };
  return null;
}

// ========== guard 1: per-class phase-aware warning budgets ==========
const wc = warningCounts();
if (!cfgBudgets) {
  if (postPhase) notEarned.push(`no warningBudgets in ${PATHS.config} — budget guard cannot attest`);
  else skips.push(`budget guard: no ${PATHS.config} yet (expected before the loop is installed)`);
} else if (!wc) {
  if (postPhase) notEarned.push(`no telemetry evidence (${PATHS.ledger} / ${PATHS.health}) — budget guard cannot attest`);
  else skips.push("budget guard: no telemetry yet (pre-phase)");
} else {
  guardsRun += 1;
  for (const [cls, n] of Object.entries(wc.counts)) {
    if (cls.startsWith("_") || !Number.isFinite(Number(n))) continue;
    const cfgEntry = cfgBudgets[cls] ?? cfgBudgets["*"];
    const baseEntry = baseline?.warningBudgets ? (baseline.warningBudgets[cls] ?? baseline.warningBudgets["*"]) : null;
    const cfgB = budgetFor(cfgEntry, phase);
    const baseB = budgetFor(baseEntry, phase);
    if (cfgB === null && baseB === null) {
      warn("budget", `warning class "${cls}" has no budget for phase ${phaseLabel} in ${PATHS.config} — add one (never rely on raw totals)`);
      continue;
    }
    // Widening the config silently must not launder warnings past the
    // baseline: the effective budget is the tighter of config and baseline.
    let budget = cfgB === null ? baseB : baseB === null ? cfgB : Math.min(cfgB, baseB);
    if (cfgB !== null && baseB !== null && cfgB > baseB)
      warn("budget", `config widens "${cls}" budget beyond the baseline (${baseB} -> ${cfgB}) — using the baseline; loosening needs --update + waiver`);
    if (Number(n) > budget)
      fail("budget", `warning class "${cls}": ${n} warning(s) over budget (${budget}) for phase ${phaseLabel} (source: ${wc.source})`);
  }
}

// ========== guard 2: vacuous-pass count == 0 once product code exists ==========
if (vacuous !== null) {
  guardsRun += 1;
  if (vacuous > 0) {
    const msg = `${vacuous} vacuous pass(es) recorded in ${PATHS.health} — a PASS on scope 0 is not evidence`;
    if (postPhase) fail("vacuous-pass", `${msg}; must be 0 once product code exists`);
    else warn("vacuous-pass", `${msg} (pre-phase: fix before entering the build)`);
  }
} else if (postPhase) {
  notEarned.push(`no ${PATHS.health} (run ledger-report) — vacuous-pass guard cannot attest`);
} else {
  skips.push("vacuous-pass guard: no process-health digest yet (pre-phase)");
}

// ========== guard 3: acceptance-contract coverage monotone vs baseline ==========
const curPct = pct(currentCoverage);
if (baseline?.acceptanceCoverage) {
  const basePct = pct(baseline.acceptanceCoverage);
  if (curPct === null) {
    if (postPhase) notEarned.push(`no current acceptanceCoverage in ${PATHS.health} — coverage guard cannot attest`);
    else skips.push("coverage guard: no acceptance coverage measured yet (pre-phase)");
  } else if (basePct !== null) {
    guardsRun += 1;
    if (curPct + 1e-9 < basePct)
      fail(
        "coverage-monotone",
        `acceptance-contract coverage dropped ${fmtPct(basePct)} -> ${fmtPct(curPct)} — the ratchet is tighten-only; loosening requires a waiver artifact under ${PATHS.waiversDir}/ and an owner-signed RULES-CHANGELOG.md entry`,
      );
    else if (curPct > basePct + 1e-9)
      console.log(`INFO  acceptance coverage improved ${fmtPct(basePct)} -> ${fmtPct(curPct)} — run with --update to ratchet the baseline`);
  }
} else if (baseline) {
  skips.push("coverage guard: baseline has no acceptanceCoverage yet");
}

// ========== guard 4: dead-@trace alarm ==========
const annotated = new Set();
for (const dir of TEST_DIRS) {
  for (const file of walk(dir, (f) => IS_TEST_FILE.test(f) || /integration|e2e/.test(f))) {
    const text = read(file) ?? "";
    for (const m of text.matchAll(/@trace\s+([A-Z]+-(?:[A-Z0-9]+-)?\d+(?:\s*,\s*[A-Z]+-(?:[A-Z0-9]+-)?\d+)*)/g))
      for (const id of m[1].split(/\s*,\s*/)) annotated.add(id);
  }
}
if (annotated.size > 0) {
  const trace = readJson(PATHS.trace, "trace");
  if (!trace) {
    warn("dead-trace", `${annotated.size} @trace annotation(s) found but ${PATHS.trace} is missing — run check-traceability so the join is checkable`);
  } else {
    guardsRun += 1;
    const joined = new Set((trace.links ?? []).filter((r) => (r.tests ?? []).length > 0).map((r) => r.id));
    const alive = [...annotated].filter((id) => joined.has(id));
    if (alive.length === 0)
      fail(
        "dead-trace",
        `dead-@trace alarm: ${annotated.size} @trace annotation(s) exist in test files but 0 join the traceability chain (${PATHS.trace}) — the annotations are decorative, not evidence`,
      );
  }
} else {
  skips.push("dead-@trace guard: no @trace annotations yet");
}

// ========== guard 5 (--release): open review findings need fix-commit/waiver ==========
if (flags.has("--release")) {
  let reviewFiles = 0;
  for (const file of walk(PATHS.changesDir, (f) => f === "review-findings.json")) {
    reviewFiles += 1;
    const data = readJson(file, "open-findings");
    if (!data) continue;
    if (data.clean === true) continue;
    const list = Array.isArray(data.findings) ? data.findings : null;
    if (!list) {
      fail("open-findings", `${file}: review evidence is not clean and lists no dispositioned findings — fix or waive (${PATHS.waiversDir}/) before release`);
      continue;
    }
    for (const f of list) {
      const dispositioned = Boolean(f.fixCommit || f.waiver) || ["fixed", "waived"].includes(f.status);
      if (!dispositioned)
        fail("open-findings", `${file}: open review finding "${f.id ?? "(unnamed)"}" has no fix-commit or waiver at --release — fix it or waive under ${PATHS.waiversDir}/`);
    }
  }
  if (reviewFiles > 0) guardsRun += 1;
  else if (postPhase) notEarned.push(`--release with no review-findings.json under ${PATHS.changesDir}/ — open-findings guard cannot attest`);
  else skips.push("open-findings guard: no review evidence yet (pre-phase)");
}

// ========== --update: tighten-only direction guard ==========
if (flags.has("--update")) {
  const stripMeta = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (k.startsWith("_")) continue;
      out[k] = typeof v === "object" && v !== null ? stripMeta(v) : v;
    }
    return out;
  };
  if (curPct === null || vacuous === null) {
    console.error(
      `FAIL  [update] refusing --update: a baseline is earned from real evidence only — need acceptanceCoverage and vacuousPasses in ${PATHS.health} (run the battery + ledger-report first)`,
    );
    console.log(`Scope: ${guardsRun} guard(s)`);
    console.log("Result: FAIL (no evidence to baseline)");
    process.exit(1);
  }
  const candidate = {
    generatedBy: "scripts/check-process-ratchet.mjs --update",
    phase: phaseLabel,
    acceptanceCoverage: { covered: currentCoverage.covered, declared: currentCoverage.declared },
    vacuousPasses: vacuous,
    warningBudgets: stripMeta(cfgBudgets ?? {}),
  };
  if (baseline) {
    const violations = [];
    const basePct = pct(baseline.acceptanceCoverage);
    if (basePct !== null && curPct + 1e-9 < basePct)
      violations.push(`acceptanceCoverage would drop ${fmtPct(basePct)} -> ${fmtPct(curPct)}`);
    if (Number.isFinite(baseline.vacuousPasses) && vacuous > baseline.vacuousPasses)
      violations.push(`vacuousPasses would rise ${baseline.vacuousPasses} -> ${vacuous}`);
    for (const [cls, entry] of Object.entries(baseline.warningBudgets ?? {})) {
      if (cls.startsWith("_")) continue;
      for (const [band, baseVal] of bandEntries(entry)) {
        const candVal = candidate.warningBudgets?.[cls]?.[band];
        if (candVal === undefined || candVal > baseVal)
          violations.push(`budget would widen: ${cls}[${band}] ${baseVal} -> ${candVal === undefined ? "(removed)" : candVal}`);
      }
    }
    // Metric-rename laundering guard: a class NEW to the baseline was
    // previously capped by baseline["*"] in check mode — baselining it with a
    // band above that cap is a widening smuggled in under a fresh name (the
    // "loosen via new metric names" evasion). Every phase the candidate band
    // covers is checked against the "*" budget for that phase.
    const baseStar = baseline.warningBudgets?.["*"];
    if (baseStar) {
      const samplePhases = (bandKey) => {
        const ps = [];
        for (let p = 0; p <= 12; p += 1) if (bandContains(bandKey, p)) ps.push(p);
        if (/^\d+\+$/.test(bandKey)) ps.push(99); // open-ended band: probe deep
        return ps;
      };
      for (const [cls, entry] of Object.entries(candidate.warningBudgets ?? {})) {
        if (cls.startsWith("_") || cls === "*") continue;
        if (Object.prototype.hasOwnProperty.call(baseline.warningBudgets ?? {}, cls)) continue;
        for (const [band, candVal] of bandEntries(entry)) {
          for (const p of samplePhases(band)) {
            const starB = budgetFor(baseStar, p);
            if (starB !== null && candVal > starB) {
              violations.push(
                `budget would widen via NEW class: ${cls}[${band}] ${candVal} exceeds the baseline "*" cap ${starB} (phase ${p}) — renaming a class does not escape the ratchet`,
              );
              break;
            }
          }
        }
      }
    }
    if (violations.length > 0) {
      for (const v of violations) console.error(`FAIL  [direction-guard] ${v}`);
      console.error(
        `FAIL  [direction-guard] tighten-only: --update rejected — a loosening baseline write requires a human waiver artifact under ${PATHS.waiversDir}/ plus an owner-signed entry in RULES-CHANGELOG.md; the baseline was NOT modified`,
      );
      console.log(`Scope: ${guardsRun} guard(s)`);
      console.log(`Result: FAIL (${violations.length} loosening write(s) rejected)`);
      process.exit(1);
    }
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL  [${f.check}] ${f.msg}`);
    console.error("FAIL  [update] refusing --update while guards fail — tighten from a truthful green run only");
    console.log(`Scope: ${guardsRun} guard(s)`);
    console.log(`Result: FAIL (${failures.length} failure(s))`);
    process.exit(1);
  }
  mkdirSync(dirname(join(root, PATHS.baseline)), { recursive: true });
  writeFileSync(join(root, PATHS.baseline), `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(`baseline ${baseline ? "tightened" : "created"}: ${PATHS.baseline} (coverage ${fmtPct(curPct)}, vacuousPasses ${vacuous})`);
  console.log(`Scope: ${guardsRun} guard(s)`);
  console.log("Result: PASS");
  process.exit(0);
}

// ---------- verdict ----------
for (const w of warnings) console.warn(`WARN  [${w.check}] ${w.msg}`);
for (const s of skips) console.log(`SKIP-pending  ${s}`);
for (const n of notEarned) console.log(`NOT-EARNED  ${n}`);
for (const f of failures) console.error(`FAIL  [${f.check}] ${f.msg}`);
console.log(`\nScope: ${guardsRun} guard(s) (phase ${phaseLabel}, product code: ${productCode ? "yes" : "no"})`);

const wsuffix = warnings.length ? `, ${warnings.length} warning(s)` : "";
if (failures.length > 0) {
  console.log(`Result: FAIL (${failures.length} failure(s))${wsuffix}`);
  process.exit(1);
}
if (!baseline) {
  // EXPERIMENTAL rung: visible non-success, exit 0 unless promoted (--strict).
  console.log(`Result: NOT-EARNED (pending baseline — earn it with --update after a truthful green run)${wsuffix}`);
  process.exit(flags.has("--strict") ? 1 : 0);
}
if (notEarned.length > 0) {
  console.log(`Result: NOT-EARNED (${notEarned.length} evidence gap(s) with product code present)${wsuffix}`);
  process.exit(flags.has("--strict") ? 1 : 0);
}
if (guardsRun === 0) {
  console.log(`Result: SKIP-pending (no process evidence yet — expected pre-phase)${wsuffix}`);
  process.exit(0);
}
console.log(`Result: PASS${wsuffix}`);
process.exit(0);
