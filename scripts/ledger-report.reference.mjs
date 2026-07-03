// REFERENCE IMPLEMENTATION — deterministic process-health digest (mechanism 6,
// the deterministic half of the reflection pass; zero-token, ~free to run).
//
// Reads trace/ledger.jsonl (+ trace/acceptance-contracts.json and
// retro/corrections/*.json when present) and writes:
//   docs/qa/process-health.md      — human-readable digest
//   trace/process-health.json      — machine-readable metrics (ratchet input).
//                                    When the ledger holds events this file
//                                    carries the check-process-ratchet
//                                    contract at TOP LEVEL: vacuousPasses
//                                    (number), acceptanceCoverage
//                                    ({covered, declared}, from the contract
//                                    join) and warningsByClass (latest event
//                                    per check, summed) — the documented
//                                    battery -> ledger-report -> ratchet
//                                    --update flow depends on these fields.
//   docs/qa/process-defects.json   — SKELETAL fallback derived from ledger data
//                                    alone, so API-less CI never blocks on the
//                                    LLM process-auditor. Never overwrites a
//                                    non-fallback (auditor-authored) file.
//
// Metrics per the reflection design: vacuous-pass count, per-class warning
// trend, retries per check, red-to-green latency, waiver count, claim
// divergence, uncommitted-work age, correction counts.
//
// PRIME DIRECTIVE compliance (this is a reporter, but absence of evidence is
// still never rendered as success):
//   - ledger empty/missing + NO product code  -> Result: SKIP-pending, exit 0
//   - ledger empty/missing + product code     -> Result: NOT-EARNED,  exit 1
//     (telemetry never ran on a real build — that is itself a process defect,
//     recorded in the skeleton)
//   - ledger has events                       -> Result: PASS, exit 0
//     (findings like vacuous passes surface as warnings here; the HARD
//     enforcement lives in qa-verify's vacuity flip + check-process-ratchet)
// The digest itself NEVER crashes: every input is parsed tolerantly.
//
// Copy to scripts/ledger-report.mjs. Run: node scripts/ledger-report.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const PATHS = {
  ledger: join("trace", "ledger.jsonl"),
  contracts: join("trace", "acceptance-contracts.json"),
  correctionsDir: join("retro", "corrections"),
  healthMd: join("docs", "qa", "process-health.md"),
  healthJson: join("trace", "process-health.json"),
  defects: join("docs", "qa", "process-defects.json"),
};
const FALLBACK_SOURCE = "ledger-report-deterministic-fallback";

// --- tolerant input readers -------------------------------------------------

function readLedger() {
  const abs = join(root, PATHS.ledger);
  if (!existsSync(abs)) return { present: false, events: [], malformed: 0 };
  let raw = "";
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    return { present: false, events: [], malformed: 0 };
  }
  const events = [];
  let malformed = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object" && !Array.isArray(e)) events.push(e);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  events.sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
  return { present: true, events, malformed };
}

function readContracts() {
  const abs = join(root, PATHS.contracts);
  if (!existsSync(abs)) return { present: false, items: [] };
  try {
    const data = JSON.parse(readFileSync(abs, "utf8"));
    let items = [];
    if (Array.isArray(data)) items = data;
    else if (Array.isArray(data?.contracts)) items = data.contracts;
    else if (data?.contracts && typeof data.contracts === "object") {
      // check-acceptance-methods' real output shape:
      //   { contracts: { "<reqId>": [ { method, mechanism, artifact, status } ] } }
      for (const [reqId, arr] of Object.entries(data.contracts)) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) if (e && typeof e === "object") items.push({ reqId, ...e });
      }
    }
    return { present: true, items: items.filter((c) => c && typeof c === "object") };
  } catch {
    return { present: true, items: [], malformed: true };
  }
}

// Contract-status predicates shared by the coverage + divergence metrics.
// Tolerates both the boolean form ({satisfied|met, waived}) and the auditor's
// status vocabulary (mechanism-ok|artifact-ok|missing-*|stub-*|failing-*|
// stale-*|waived|skip-pending).
const UNMET_STATUSES = new Set([
  "unmet",
  "missing",
  "missing-mechanism",
  "stub-mechanism",
  "missing-playwright",
  "missing-artifact",
  "failing-artifact",
  "stale-artifact",
]);
const contractWaived = (c) => c.waived === true || c.status === "waived";
const contractCovered = (c) =>
  c.satisfied === true || c.met === true || ["mechanism-ok", "artifact-ok", "ok"].includes(c.status ?? "");
const contractUnmet = (c) =>
  !contractWaived(c) && (c.satisfied === false || c.met === false || UNMET_STATUSES.has(c.status ?? ""));

function readCorrections() {
  const abs = join(root, PATHS.correctionsDir);
  const out = [];
  if (!existsSync(abs)) return out;
  let entries = [];
  try {
    entries = readdirSync(abs).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of entries) {
    try {
      const c = JSON.parse(readFileSync(join(abs, f), "utf8"));
      if (c && typeof c === "object") out.push({ file: f, ...c });
    } catch {
      /* malformed correction — skipped, not fatal */
    }
  }
  return out;
}

// Product-code-presence heuristic (same spirit as the three-valued gate
// semantics): does any conventional product dir hold at least one code file?
function productCodePresent() {
  const CODE_DIRS = ["src", "app", "lib", "server", "api", "pages", "components"];
  const CODE_EXT = /\.(m?[jt]sx?|py|go|rs|java|rb|php|cs|vue|svelte)$/i;
  const walk = (dir, depth) => {
    if (depth > 4) return false;
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    for (const e of entries) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const p = join(dir, e);
      try {
        if (statSync(p).isDirectory()) {
          if (walk(p, depth + 1)) return true;
        } else if (CODE_EXT.test(e)) return true;
      } catch {
        /* unreadable entry — skip */
      }
    }
    return false;
  };
  return CODE_DIRS.some((d) => existsSync(join(root, d)) && walk(join(root, d), 0));
}

// --- metric computation -----------------------------------------------------

const parseTs = (ts) => {
  const n = Date.parse(ts ?? "");
  return Number.isFinite(n) ? n : null;
};

function computeMetrics(events, contracts, corrections) {
  // Vacuous passes: exit 0 on scope 0 while product code exists (the disease).
  const vacuous = events.filter(
    (e) => e.exitCode === 0 && e.scope_n === 0 && (e.meta?.productCode === true || e.meta?.notEarned === true),
  );
  const notEarned = events.filter((e) => e.event === "not-earned" || e.result === "NOT-EARNED" || e.meta?.notEarned === true);

  // Per-class warning trend: first half vs second half of the event stream.
  const trend = {};
  const half = Math.ceil(events.length / 2);
  events.forEach((e, i) => {
    const byClass = e.warningsByClass && typeof e.warningsByClass === "object" ? e.warningsByClass : {};
    for (const [cls, n] of Object.entries(byClass)) {
      const v = Number(n) || 0;
      trend[cls] ??= { firstHalf: 0, secondHalf: 0, total: 0, direction: "flat" };
      trend[cls][i < half ? "firstHalf" : "secondHalf"] += v;
      trend[cls].total += v;
    }
  });
  for (const t of Object.values(trend))
    t.direction = t.secondHalf > t.firstHalf ? "rising" : t.secondHalf < t.firstHalf ? "falling" : "flat";

  // Retries per check + red-to-green latency episodes.
  const byCheck = new Map();
  for (const e of events) {
    if (!e.check || typeof e.exitCode !== "number") continue;
    if (!byCheck.has(e.check)) byCheck.set(e.check, []);
    byCheck.get(e.check).push(e);
  }
  const retriesPerCheck = {};
  const redToGreen = {};
  const allLatencies = [];
  for (const [check, runs] of byCheck) {
    let openRedTs = null;
    let retries = 0;
    let failures = 0;
    const episodes = [];
    for (const e of runs) {
      if (e.exitCode !== 0) failures += 1;
      if (openRedTs !== null) {
        retries += 1;
        if (e.exitCode === 0) {
          const redMs = parseTs(openRedTs);
          const greenMs = parseTs(e.ts);
          const ms = redMs !== null && greenMs !== null ? greenMs - redMs : null;
          episodes.push({ redAt: openRedTs, greenAt: e.ts ?? null, ms });
          if (ms !== null) allLatencies.push(ms);
          openRedTs = null;
        }
      } else if (e.exitCode !== 0) {
        openRedTs = e.ts ?? null;
      }
    }
    retriesPerCheck[check] = { runs: runs.length, failures, retries };
    const known = episodes.filter((ep) => ep.ms !== null);
    redToGreen[check] = {
      episodes,
      avgMs: known.length ? Math.round(known.reduce((s, ep) => s + ep.ms, 0) / known.length) : null,
      stillRed: openRedTs !== null,
    };
  }

  // Waivers: ledger waiver events + waived acceptance contracts.
  const waiverEvents = events.filter((e) => e.event === "waiver" || e.meta?.waiver === true).length;
  const contractWaivers = contracts.items.filter(contractWaived).length;

  // Claim divergence: explicit divergence events + declared-but-unmet contracts.
  const divergenceEvents = events.filter((e) => e.event === "claim-divergence" || e.meta?.claimDivergence === true).length;
  const unmetContracts = contracts.items.filter(contractUnmet);

  // Current warning levels per class: LATEST event per check, summed — the
  // same reading check-process-ratchet's budget guard performs on the raw
  // ledger, mirrored here so trace/process-health.json alone carries it.
  const latestByCheck = new Map();
  for (const e of events) if (typeof e.check === "string") latestByCheck.set(e.check, e);
  const warningsByClass = {};
  for (const e of latestByCheck.values()) {
    const byClass = e.warningsByClass && typeof e.warningsByClass === "object" ? e.warningsByClass : {};
    for (const [cls, nRaw] of Object.entries(byClass)) warningsByClass[cls] = (warningsByClass[cls] ?? 0) + (Number(nRaw) || 0);
  }

  // Uncommitted-work age: trailing streak of dirty === true events.
  let uncommitted = null;
  if (events.length && events[events.length - 1].dirty === true) {
    let i = events.length - 1;
    while (i > 0 && events[i - 1].dirty === true) i -= 1;
    const since = events[i].ts ?? null;
    const a = parseTs(since);
    const b = parseTs(events[events.length - 1].ts);
    uncommitted = {
      dirtyStreakEvents: events.length - i,
      since,
      ageMs: a !== null && b !== null ? b - a : null,
    };
  }

  // A correction counts as closed ONLY with a schema-valid disposition
  // (status enum + non-empty by + ts — mirrors correct.mjs), so
  // {"status":"nonsense"} or an attribution-less {"status":"resolved"} stays
  // OPEN here exactly as it does for gate-status.
  const validDisposition = (d) =>
    d &&
    typeof d === "object" &&
    ["resolved", "waived", "invalid"].includes(d.status) &&
    typeof d.by === "string" &&
    d.by.trim().length > 0 &&
    typeof d.ts === "string" &&
    d.ts.trim().length > 0;
  const openCorrections = corrections.filter((c) => !validDisposition(c.disposition));

  return {
    vacuousPasses: { count: vacuous.length, events: vacuous.map((e) => ({ ts: e.ts ?? null, check: e.check ?? null })) },
    warningsByClass,
    notEarned: { count: notEarned.length },
    warningTrendByClass: trend,
    retriesPerCheck,
    redToGreenLatency: {
      perCheck: redToGreen,
      overallAvgMs: allLatencies.length ? Math.round(allLatencies.reduce((s, x) => s + x, 0) / allLatencies.length) : null,
    },
    waivers: { ledgerEvents: waiverEvents, contractWaivers, total: waiverEvents + contractWaivers },
    claimDivergence: {
      ledgerEvents: divergenceEvents,
      unmetContracts: unmetContracts.length,
      unmet: unmetContracts.map((c) => ({ reqId: c.reqId ?? c.id ?? null, method: c.method ?? null })),
      total: divergenceEvents + unmetContracts.length,
    },
    uncommittedWork: uncommitted,
    corrections: { total: corrections.length, open: openCorrections.length, openIds: openCorrections.map((c) => c.id ?? c.file) },
  };
}

// Skeletal process-defects derived from ledger data alone (LLM-free fallback).
function buildSkeletonDefects(metrics, emptyLedger, productCode) {
  const defects = [];
  const add = (cls, severity, evidence, metric, proposedFix) =>
    defects.push({ id: `PD-D${defects.length + 1}`, class: cls, evidence, metric, severity, proposedFix });
  if (emptyLedger && productCode)
    add(
      "telemetry-missing",
      "P1",
      "Product code exists but trace/ledger.jsonl has no events — the battery/gates never emitted telemetry.",
      "eventCount=0",
      "Wire ledger emission into qa-verify / gate-status / git hooks (see scripts/ledger.mjs).",
    );
  if (metrics && metrics.vacuousPasses.count > 0)
    add(
      "vacuous-pass",
      "P0",
      `Exit-0 runs with scope_n=0 while product code exists: ${metrics.vacuousPasses.events.map((e) => `${e.check}@${e.ts}`).join(", ")}`,
      `vacuousPasses=${metrics.vacuousPasses.count}`,
      "Render these NOT-EARNED (three-valued gate semantics); a check must never pass on an empty scope once product code exists.",
    );
  if (metrics && metrics.corrections.open > 0)
    add(
      "open-correction",
      "P0",
      `Undispositioned correction(s): ${metrics.corrections.openIds.join(", ")}`,
      `openCorrections=${metrics.corrections.open}`,
      "Disposition each correction (root-cause over the gate chain, not the code) before any gate may pass.",
    );
  if (metrics && metrics.claimDivergence.unmetContracts > 0)
    add(
      "acceptance-contract-unmet",
      "P0",
      `Declared acceptance method(s) without a threshold-passing artifact: ${metrics.claimDivergence.unmet.map((u) => `${u.reqId}(${u.method})`).join(", ")}`,
      `unmetContracts=${metrics.claimDivergence.unmetContracts}`,
      "Implement or human-waive each declared method (check-acceptance-methods --mode=artifact must pass).",
    );
  return defects;
}

const fmtMs = (ms) => {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};

// --- main --------------------------------------------------------------------

function main() {
  const ledger = readLedger();
  const contracts = readContracts();
  const corrections = readCorrections();
  const events = ledger.events;
  const hasEvents = events.length > 0;
  const productCode = productCodePresent();
  const metrics = hasEvents ? computeMetrics(events, contracts, corrections) : null;

  // Classify per the prime directive.
  let result;
  let exitCode;
  const warnings = [];
  if (!hasEvents && productCode) {
    result = "NOT-EARNED";
    exitCode = 1;
  } else if (!hasEvents) {
    result = "SKIP-pending";
    exitCode = 0;
  } else {
    if (ledger.malformed) warnings.push(`${ledger.malformed} malformed ledger line(s) skipped`);
    if (metrics.vacuousPasses.count) warnings.push(`${metrics.vacuousPasses.count} vacuous pass(es) in the ledger (exit 0 on scope 0 with product code)`);
    if (metrics.corrections.open) warnings.push(`${metrics.corrections.open} OPEN correction(s) undispositioned`);
    if (metrics.claimDivergence.total) warnings.push(`claim divergence: ${metrics.claimDivergence.total} (declared methods without artifacts / divergence events)`);
    result = "PASS";
    exitCode = 0;
  }
  const resultLine = `Result: ${result}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`;

  // ---- machine-readable digest ----
  // Acceptance coverage from the contract join: declared = every contract
  // entry, covered = entries whose mechanism/artifact is ok (or waived — a
  // human-signed waiver is a visible disposition, not a gap). Computed here
  // because check-process-ratchet's guard 3 / --update read it from this file.
  const acceptanceCoverage = contracts.present
    ? {
        covered: contracts.items.filter((c) => contractCovered(c) || contractWaived(c)).length,
        declared: contracts.items.length,
      }
    : null;
  const health = {
    generatedAt: new Date().toISOString(),
    ledger: { path: PATHS.ledger.replace(/\\/g, "/"), present: ledger.present, eventCount: events.length, malformedLines: ledger.malformed },
    productCodePresent: productCode,
    result,
    // ---- ratchet contract (TOP-LEVEL, read by check-process-ratchet) ----
    // vacuousPasses: plain number; acceptanceCoverage: {covered, declared};
    // warningsByClass: latest-per-check summed. Written only when the ledger
    // holds real events — an empty run must not fabricate ratchet evidence.
    ...(metrics
      ? {
          vacuousPasses: metrics.vacuousPasses.count,
          warningsByClass: metrics.warningsByClass,
          ...(acceptanceCoverage ? { acceptanceCoverage } : {}),
        }
      : {}),
    metrics: metrics ?? {
      vacuousPasses: { count: 0, events: [] },
      warningsByClass: {},
      notEarned: { count: 0 },
      warningTrendByClass: {},
      retriesPerCheck: {},
      redToGreenLatency: { perCheck: {}, overallAvgMs: null },
      waivers: { ledgerEvents: 0, contractWaivers: 0, total: 0 },
      claimDivergence: { ledgerEvents: 0, unmetContracts: 0, unmet: [], total: 0 },
      uncommittedWork: null,
      corrections: { total: corrections.length, open: 0, openIds: [] },
    },
    inputs: {
      acceptanceContracts: contracts.present ? contracts.items.length : null,
      corrections: corrections.length,
    },
  };

  // ---- human-readable digest ----
  const m = health.metrics;
  const md = `# Process Health (generated — do not hand-edit)

Generated by \`node scripts/ledger-report.mjs\` from \`${health.ledger.path}\`.
This is the DETERMINISTIC half of the reflection pass — zero LLM content.

Scope: ${events.length} ledger event(s)
${resultLine}

${
  !hasEvents
    ? `**${ledger.present ? "The ledger exists but contains no events" : "No ledger found at " + health.ledger.path}.**\n` +
      (productCode
        ? "Product code IS present, so this emptiness is NOT-EARNED — telemetry never ran on a real build. Wire scripts/ledger.mjs emission into qa-verify / gate-status / git hooks.\n"
        : "No product code detected yet — pre-build emptiness, reported as SKIP-pending (never as PASS).\n")
    : `| Metric | Value |
|---|---|
| Vacuous passes (exit 0, scope 0, product code) | **${m.vacuousPasses.count}** ${m.vacuousPasses.count ? "⚠" : ""} |
| NOT-EARNED events | ${m.notEarned.count} |
| Waivers (ledger + contracts) | ${m.waivers.total} |
| Claim divergence (events + unmet contracts) | ${m.claimDivergence.total} |
| Open corrections | ${m.corrections.open} of ${m.corrections.total} |
| Red→green latency (overall avg) | ${fmtMs(m.redToGreenLatency.overallAvgMs)} |
| Uncommitted-work age (trailing dirty streak) | ${m.uncommittedWork ? `${fmtMs(m.uncommittedWork.ageMs)} (${m.uncommittedWork.dirtyStreakEvents} event(s) since ${m.uncommittedWork.since})` : "clean / unknown"} |

## Vacuous passes

${m.vacuousPasses.count ? m.vacuousPasses.events.map((e) => `- **${e.check ?? "(unknown check)"}** at ${e.ts} — exit 0 on scope 0 with product code present. This is the vacuous-pass disease; it must render NOT-EARNED, never PASS.`).join("\n") : "None."}

## Warning trend by class (first half vs second half of the event stream)

${
  Object.keys(m.warningTrendByClass).length
    ? `| Class | First half | Second half | Total | Direction |\n|---|---|---|---|---|\n` +
      Object.entries(m.warningTrendByClass)
        .map(([cls, t]) => `| ${cls} | ${t.firstHalf} | ${t.secondHalf} | ${t.total} | ${t.direction} |`)
        .join("\n")
    : "No per-class warning data in the ledger."
}

## Retries and red→green latency per check

${
  Object.keys(m.retriesPerCheck).length
    ? `| Check | Runs | Failures | Retries | Avg red→green | Still red |\n|---|---|---|---|---|---|\n` +
      Object.entries(m.retriesPerCheck)
        .map(([check, r]) => {
          const l = m.redToGreenLatency.perCheck[check] ?? {};
          return `| ${check} | ${r.runs} | ${r.failures} | ${r.retries} | ${fmtMs(l.avgMs)} | ${l.stillRed ? "**yes**" : "no"} |`;
        })
        .join("\n")
    : "No per-check runs in the ledger."
}

## Claim divergence

${m.claimDivergence.total ? `- Divergence events in ledger: ${m.claimDivergence.ledgerEvents}\n- Declared-but-unmet acceptance contracts: ${m.claimDivergence.unmet.map((u) => `${u.reqId} (${u.method})`).join(", ") || "none"}` : "None detected from available inputs."}
${contracts.present ? "" : "\n(trace/acceptance-contracts.json not present — acceptance-contract join not yet run.)"}
`
}
## Inputs

- Ledger: ${health.ledger.present ? `${events.length} event(s), ${ledger.malformed} malformed line(s) skipped` : "MISSING"}
- Acceptance contracts: ${contracts.present ? `${contracts.items.length} contract(s)` : "not present"}
- Corrections: ${corrections.length} file(s) under ${PATHS.correctionsDir.replace(/\\/g, "/")}/
`;

  // ---- write artifacts (all tolerant — a write failure downgrades, never crashes) ----
  const writeSafe = (rel, content) => {
    try {
      const abs = join(root, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
      return true;
    } catch (err) {
      console.error(`ledger-report: WARN could not write ${rel}: ${err?.message ?? err}`);
      return false;
    }
  };
  writeSafe(PATHS.healthMd, md);
  writeSafe(PATHS.healthJson, JSON.stringify(health, null, 2) + "\n");

  // Skeletal process-defects fallback: written when absent or when the
  // existing file is itself a deterministic fallback. An auditor-authored
  // (LLM) file is NEVER clobbered by the skeleton.
  let skeletonNote = "";
  let existing = null;
  const defectsAbs = join(root, PATHS.defects);
  if (existsSync(defectsAbs)) {
    try {
      existing = JSON.parse(readFileSync(defectsAbs, "utf8"));
    } catch {
      existing = null; // malformed — safe to replace with the skeleton
    }
  }
  if (existing && existing.source !== FALLBACK_SOURCE) {
    skeletonNote = `kept existing ${PATHS.defects} (source: ${existing.source ?? "unknown"} — not overwriting a non-fallback file)`;
  } else {
    const skeleton = {
      source: FALLBACK_SOURCE,
      generatedAt: health.generatedAt,
      note: "Deterministic skeleton derived from ledger data alone. The LLM process-auditor replaces this file at phase boundaries; until then G7 keys on this fallback so API-less CI never blocks.",
      defects: buildSkeletonDefects(metrics, !hasEvents, productCode),
    };
    writeSafe(PATHS.defects, JSON.stringify(skeleton, null, 2) + "\n");
    skeletonNote = `wrote ${PATHS.defects} (${skeleton.defects.length} deterministic defect(s))`;
  }

  // ---- stdout ----
  console.log(`Scope: ${events.length} ledger event(s)`);
  if (!hasEvents) {
    console.log(
      ledger.present
        ? `ledger-report: ${health.ledger.path} exists but has no ledger events`
        : `ledger-report: no ledger events — ${health.ledger.path} is missing`,
    );
    console.log(
      productCode
        ? "ledger-report: product code IS present — empty telemetry on a real build is NOT-EARNED, not a pass."
        : "ledger-report: no product code detected — pre-build emptiness, SKIP-pending.",
    );
  }
  for (const w of warnings) console.warn(`WARN  ${w}`);
  console.log(`ledger-report: wrote ${PATHS.healthMd.replace(/\\/g, "/")} + ${PATHS.healthJson.replace(/\\/g, "/")}; ${skeletonNote}`);
  console.log(resultLine);
  process.exit(exitCode);
}

try {
  main();
} catch (err) {
  // NEVER crash with an unhandled throw — report and fail loudly but cleanly.
  console.error(`ledger-report: unexpected error: ${err?.stack ?? err}`);
  console.log("Result: FAIL (digest error)");
  process.exit(1);
}
