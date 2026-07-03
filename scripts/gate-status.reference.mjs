// REFERENCE IMPLEMENTATION — gate status summary (truly satisfied vs pending/retrofit).
//
// Runs the DETERMINISTIC half of each gate (the exit-coded `check-*` commands)
// and prints a G0–G8 summary with THREE-VALUED semantics (reflection design,
// mechanism 3): PASS / NOT-EARNED / FAIL, plus SKIP-pending for pre-phase
// emptiness. worst() NEVER folds SKIP-pending or NOT-EARNED into PASS — the
// pixel forensics (docs/field-reports/2026-07-02-pixel-perfect-forensics.md)
// showed the old fold rendering G4–G8 green over literally nothing (RC2).
// NOT-EARNED is red for G4 and above.
//
// Also enforced here:
//   - GATE_COMMANDS below is the SINGLE SOURCE OF TRUTH for what each gate
//     executes, and gate labels are rendered from it, so label and invocation
//     cannot drift (RC3 — the old dashboard labeled G7 "trace --release"
//     while invoking the lenient variant). Keep in sync with
//     checklists/quality-gates.md (the G7 block mandates the strict release
//     commands verbatim).
//   - Hard divergence check: the machine-readable header in
//     docs/current-state.md ("Current phase: Phase <N>" / "Last completed
//     gate: G<N>") must not outrun the computed gate frontier (RC6). Freeform
//     done-claim prose ("Convergence reached", "pixel perfect", …) is
//     ADVISORY-only — regex-over-prose must never become a hard check.
//   - Red OPEN-CORRECTION lines for every retro/corrections/*.correction.json
//     with a null/schema-incomplete disposition (mechanism 4): no gate may
//     render a green summary while a correction is open — overall exit 1.
//   - Red UNRECORDED-CORRECTION lines for detectAutoCorrections() events
//     (waiver-created / uat-bug-vs-gate, via scripts/correct.mjs) that have
//     no matching correction artifact: a waiver may suppress a check failure,
//     but it may never pass a gate summary silently — overall exit 1.
//   - Committed-evidence boundary (forensics fix 8): when product code exists
//     but implementation paths are dirty/untracked or no commit carries a
//     "Slice:" trailer, gates >= G4 render NOT-EARNED — evidence must be
//     committed; hooks and CI have not seen this work.
//   - Every check is labeled with its promotion-ladder rung read from
//     RULES-CHANGELOG.md (unlisted => experimental).
//   - Fail-open ledger emission (mechanism 1). Telemetry only: the honesty
//     checks above are NOT governed by FACTORY_TELEMETRY.
//
// Retrofit honesty: if `.project-factory/retrofit.json` exists (written by
// onboard), its slices are flagged — historical red-first evidence for legacy
// code cannot be reconstructed, so those gates are "retrofit", not "earned".
//
// Run: `node scripts/gate-status.mjs`  (tool-agnostic — pure Node).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const has = (rel) => existsSync(join(root, rel));

// ---------------------------------------------------------------------------
// GATE_COMMANDS — single source of truth for every check invocation a gate
// executes. Gate labels below are RENDERED from this table, so the printed
// command and the executed command are the same string (RC3). Keep in sync
// with checklists/quality-gates.md.
// ---------------------------------------------------------------------------
const GATE_COMMANDS = {
  traceability: { script: "check-traceability", args: [] },
  trajectory: { script: "check-trajectory", args: [] },
  recordings: { script: "check-recordings", args: [] },
  coverage: { script: "check-coverage-ratchet", args: [] },
  evals: { script: "check-eval-ratchet", args: [] },
  acceptanceExistence: { script: "check-acceptance-methods", args: ["--mode=existence"] },
  acceptanceArtifact: { script: "check-acceptance-methods", args: ["--mode=artifact"] },
  visual: { script: "check-visual-fidelity", args: [] },
  // EXPERIMENTAL per RULES-CHANGELOG.md — no --strict until promoted there.
  processRatchet: { script: "check-process-ratchet", args: [] },
  integrity: { script: "check-factory-integrity", args: [] },
  // The strict release commands mandated by checklists/quality-gates.md (G7).
  // releaseTier: a FAIL before any product code exists renders SKIP-pending
  // (release strictness over an empty scaffold is pending, not broken).
  traceabilityRelease: {
    script: "check-traceability",
    args: ["--release", "--strict-tests", "--strict-recordings"],
    releaseTier: true,
  },
  trajectoryRelease: {
    script: "check-trajectory",
    args: ["--release", "--check-fresh"],
    releaseTier: true,
  },
};
const cmdLabel = (key) => {
  const { script, args } = GATE_COMMANDS[key];
  return [script.replace(/^check-/, ""), ...args].join(" ");
};

// ---------------------------------------------------------------------------
// Fail-open ledger emission (mechanism 1) — telemetry only, never a gate.
// ---------------------------------------------------------------------------
let ledger = null;
try {
  for (const rel of ["scripts/ledger.mjs", "scripts/ledger.reference.mjs"]) {
    const candidate = join(root, rel);
    if (existsSync(candidate)) {
      ledger = await import(pathToFileURL(candidate).href);
      break;
    }
  }
} catch {
  ledger = null;
}
function emitLedger(event) {
  try {
    ledger?.emit?.(event, { root });
  } catch {
    /* fail-open */
  }
}

// ---------------------------------------------------------------------------
// Product-code heuristic — one half of the three-valued key (the other half
// is the current-state.md header). Emptiness over product code = NOT-EARNED.
// ---------------------------------------------------------------------------
const IMPL_DIRS = ["app", "src", "lib", "pages", "components", "server", "api"];
const IMPL_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|vue|svelte|py|go|rb|rs|java|cs|php)$/i;
function hasProductCode() {
  const stack = IMPL_DIRS.map((d) => join(root, d)).filter((p) => existsSync(p));
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (IMPL_EXT.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) return true;
    }
  }
  return false;
}
const productCode = hasProductCode();

// ---------------------------------------------------------------------------
// Run + classify one check. Three-valued: the check's own final "Result:"
// line wins when present; otherwise exit code + "Scope: 0" / legacy SKIP
// sniffing. Emptiness (SKIP-pending) over product code flips to NOT-EARNED.
// ---------------------------------------------------------------------------
function runCheck(key) {
  const { script, args, releaseTier } = GATE_COMMANDS[key];
  if (!has(`scripts/${script}.mjs`)) {
    return { status: "n/a", out: `scripts/${script}.mjs not installed`, scopeN: null };
  }
  const r = spawnSync("node", [`scripts/${script}.mjs`, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  const exit = r.status ?? 1;
  const scopeM = out.match(/^Scope:\s*(\d+)\b/m);
  const scopeN = scopeM ? Number(scopeM[1]) : null;
  const declared = [...out.matchAll(/^Result:\s*(PASS|FAIL|SKIP-pending|NOT-EARNED)\b/gm)].pop()?.[1] ?? null;
  let status;
  if (declared === "NOT-EARNED") status = "NOT-EARNED";
  else if (declared === "SKIP-pending") status = "SKIP-pending";
  else if (exit !== 0) status = releaseTier && !productCode ? "SKIP-pending" : "FAIL";
  else if (scopeN === 0 || (declared === null && (/^SKIP\b/m.test(out) || /\bNothing to ratchet\b/.test(out)))) status = "SKIP-pending";
  else status = "PASS";
  // Vacuity flip (mechanism 3): pending emptiness over product code is unearned.
  if (status === "SKIP-pending" && productCode) status = "NOT-EARNED";
  return { status, out, scopeN };
}
const checks = {};
for (const key of Object.keys(GATE_COMMANDS)) checks[key] = runCheck(key);

// ---------------------------------------------------------------------------
// worst() — NEVER folds SKIP-pending / NOT-EARNED / n/a into PASS (RC2).
// "n/a" (check not installed) counts as SKIP-pending: absence of a check is
// pending evidence, not proof.
// ---------------------------------------------------------------------------
const SEVERITY = ["PASS", "SKIP-pending", "needs sign-off", "NOT-EARNED", "FAIL"];
function worst(...statuses) {
  let w = "PASS";
  for (const raw of statuses) {
    const s = raw === "n/a" ? "SKIP-pending" : raw;
    if (SEVERITY.indexOf(s) > SEVERITY.indexOf(w)) w = s;
  }
  return w;
}

// Gate → which deterministic checks back it (judgment criteria sit on top).
const GATES = [
  { g: "G0", desc: "scaffold + loop installed", keys: [], fixed: () => (has("scripts/check-traceability.mjs") && has(".githooks") ? "PASS" : "FAIL") },
  { g: "G1", desc: "requirements signed off", keys: [], fixed: () => (has("docs/requirements.md") ? "needs sign-off" : "FAIL") },
  { g: "G2", desc: "baseline specs", keys: ["traceability"] },
  { g: "G3", desc: "capability plan + acceptance methods exist", keys: ["acceptanceExistence"], fixed: (fold) => worst(has("docs/mvp-capability-plan.md") ? "needs sign-off" : "FAIL", fold) },
  { g: "G4", desc: "per-slice", keys: ["traceability", "trajectory", "acceptanceArtifact", "integrity"] },
  { g: "G5", desc: "hardening (coverage)", keys: ["coverage"] },
  { g: "G6", desc: "QA proof", keys: ["recordings", "evals", "acceptanceArtifact", "visual"] },
  { g: "G7", desc: "release", keys: ["traceabilityRelease", "trajectoryRelease", "recordings", "acceptanceArtifact", "integrity"] },
  { g: "G8", desc: "UAT (trace regressions)", keys: ["traceability"] },
];
const gateRows = GATES.map((gate, idx) => {
  const fold = gate.keys.length ? worst(...gate.keys.map((k) => checks[k].status)) : "PASS";
  let status = gate.fixed ? gate.fixed(fold) : fold;
  const notes = [];
  // NOT-EARNED is red for G4+; pending emptiness over product code is unearned
  // even when it came from an uninstalled ("n/a") constituent.
  if (idx >= 4 && status === "SKIP-pending" && productCode) {
    status = "NOT-EARNED";
    notes.push("emptiness over product code");
  }
  return { g: gate.g, idx, desc: gate.desc, keys: gate.keys, status, notes };
});

// ---------------------------------------------------------------------------
// Committed-evidence boundary (forensics fix 8).
// ---------------------------------------------------------------------------
function gitPorcelain() {
  try {
    const r = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    if (r.status === 0 && typeof r.stdout === "string") return r.stdout;
  } catch {
    /* git absent — tolerated */
  }
  return null;
}
function hasSliceCommit() {
  try {
    const r = spawnSync("git", ["log", "--grep=^Slice:", "-n", "1", "--format=%H"], { cwd: root, encoding: "utf8" });
    if (r.status === 0) return r.stdout.trim().length > 0;
  } catch {
    /* git absent — tolerated */
  }
  return null;
}
const porcelain = gitPorcelain();
let boundaryWarn = null;
let boundaryRed = null;
if (productCode) {
  if (porcelain === null) {
    boundaryWarn = "committed-evidence boundary cannot be verified (git unavailable or not a repository)";
  } else {
    const IMPL_PATH_RE = /^(app|src|lib|db|server|pages|components)\//;
    const dirtyImpl = porcelain
      .split("\n")
      .filter(Boolean)
      .some((line) => line.slice(3).replace(/"/g, "").split(" -> ").some((part) => IMPL_PATH_RE.test(part)));
    const slice = hasSliceCommit();
    if (dirtyImpl || slice === false) {
      boundaryRed = dirtyImpl ? "implementation paths are dirty/untracked" : 'no commit carries a "Slice:" trailer';
      for (const row of gateRows) {
        if (row.idx >= 4 && row.status !== "FAIL") {
          row.status = "NOT-EARNED";
          row.notes.push("committed-evidence");
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Computed frontier + hard divergence check against the machine-readable
// header in docs/current-state.md (kept in the exact template formats
// "Phase <N>" / "G<N>"). Freeform done-claim prose stays advisory.
// ---------------------------------------------------------------------------
const earnedStatus = (s) => s === "PASS" || s === "needs sign-off";
let frontier = -1;
for (const row of gateRows) {
  if (earnedStatus(row.status)) frontier = row.idx;
  else break;
}
const frontierLabel = frontier < 0 ? "none (G0 not satisfied)" : `G${frontier}`;

let stateText = null;
try {
  stateText = readFileSync(join(root, "docs", "current-state.md"), "utf8");
} catch {
  stateText = null;
}
const header = { phase: null, gate: null };
if (stateText) {
  const p =
    stateText.match(/\*\*Current phase:\*\*\s*Phase\s*(\d+)/i) ??
    stateText.match(/<!--\s*factory-state[\s\S]*?\bphase\s*:\s*(\d+)/i) ??
    stateText.match(/^phase\s*:\s*(\d+)\s*$/im) ??
    // Field-format fallback (the pixel run's ACTUAL header):
    //   "_Last updated: ... Phase: **4 — front page built ...**_"
    // Scoped to the first ~10 lines so prose deeper in the doc cannot
    // masquerade as the machine-readable header.
    stateText.split("\n").slice(0, 10).join("\n").match(/\bPhase:?\s*\*{0,2}\s*(\d+)\b/i);
  if (p) header.phase = Number(p[1]);
  const g = stateText.match(/\*\*Last completed gate:\*\*\s*G(\d+)/i);
  if (g) header.gate = Number(g[1]);
}
const divergences = [];
if (header.gate !== null && header.gate > frontier) {
  divergences.push(`claims "Last completed gate: G${header.gate}" but the computed frontier is ${frontierLabel}`);
}
if (header.phase !== null && header.phase >= 4 && frontier < 3) {
  divergences.push(`claims "Current phase: Phase ${header.phase}" but gates G0–G3 are not all earned (computed frontier: ${frontierLabel})`);
}

// Advisory-only done-claim grep (mechanism 3: regex-over-prose must not
// become a hard check users learn to ignore).
const CLAIM_PATTERNS = [/convergence reached/i, /pixel[- ]?perfect/i, /all .{0,40}? match/i, /verification-only/i];
const advisories = [];
if (stateText) {
  for (const re of CLAIM_PATTERNS) {
    const m = stateText.match(re);
    if (m) advisories.push(m[0]);
  }
}

// ---------------------------------------------------------------------------
// Open corrections (mechanism 4): disposition === null (or unreadable, or
// schema-incomplete) = open. The predicate mirrors correct.mjs's schema —
// a disposition needs status (enum) AND a non-empty `by` AND `ts`, so
// {"status":"resolved"} alone cannot close a correction without attribution.
// ---------------------------------------------------------------------------
const validDisposition = (d) =>
  d &&
  typeof d === "object" &&
  ["resolved", "waived", "invalid"].includes(d.status) &&
  typeof d.by === "string" &&
  d.by.trim().length > 0 &&
  typeof d.ts === "string" &&
  d.ts.trim().length > 0;
function openCorrections() {
  const dir = join(root, "retro", "corrections");
  if (!existsSync(dir)) return [];
  const open = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".correction.json")) continue;
    const rel = `retro/corrections/${f}`;
    try {
      const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (!validDisposition(data.disposition)) open.push({ file: rel, id: data.id ?? "COR-?", utterance: data.utterance ?? "" });
    } catch (e) {
      open.push({ file: rel, id: "COR-?", utterance: `(unreadable correction artifact: ${e.message})` });
    }
  }
  return open;
}
const open = openCorrections();

// ---------------------------------------------------------------------------
// Unrecorded auto-corrections (mechanism 4, detector half): waiver-created /
// uat-bug-vs-gate events from correct.mjs's deterministic detectors that have
// NO matching correction artifact yet. Without this, a waiver dropped under
// docs/qa/waivers/ suppresses an acceptance failure at G3 and nothing red
// appears in any gate summary until `correct.mjs --check` first runs at G7.
// Red here, same bucket as open corrections.
// ---------------------------------------------------------------------------
async function unrecordedCorrections() {
  let mod = null;
  try {
    for (const cand of [
      join(root, "scripts", "correct.mjs"),
      join(root, "scripts", "correct.reference.mjs"),
      join(here, "correct.mjs"),
      join(here, "correct.reference.mjs"),
    ]) {
      if (existsSync(cand)) {
        mod = await import(pathToFileURL(cand).href);
        break;
      }
    }
  } catch {
    mod = null;
  }
  if (typeof mod?.detectAutoCorrections !== "function") return { events: [], detectorRan: false };
  let events = [];
  try {
    events = mod.detectAutoCorrections(root);
  } catch {
    return { events: [], detectorRan: false };
  }
  if (!events.length) return { events: [], detectorRan: true };
  const recordedKeys = new Set();
  const dir = join(root, "retro", "corrections");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".correction.json")) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
        if (typeof data.autoKey === "string") recordedKeys.add(data.autoKey);
      } catch {
        /* unreadable artifact — already surfaced as an open correction */
      }
    }
  }
  return { events: events.filter((e) => !recordedKeys.has(e.autoKey)), detectorRan: true };
}
const { events: unrecorded, detectorRan } = await unrecordedCorrections();

// ---------------------------------------------------------------------------
// Ladder rungs from RULES-CHANGELOG.md (project root first, then the factory
// repo next to this script). Unlisted checks are experimental by definition.
// ---------------------------------------------------------------------------
let ladderText = null;
for (const p of [join(root, "RULES-CHANGELOG.md"), join(here, "..", "RULES-CHANGELOG.md")]) {
  if (existsSync(p)) {
    try {
      ladderText = readFileSync(p, "utf8");
      break;
    } catch {
      /* unreadable — fall through */
    }
  }
}
function rungFor(scriptName) {
  if (ladderText) {
    for (const line of ladderText.split("\n")) {
      if (!line.startsWith("| `")) continue;
      if (!line.includes(`\`${scriptName}`)) continue;
      const statusCol = line.split("|")[2] ?? "";
      const m = statusCol.match(/hard|soft|experimental|deprecated|n\/a/i);
      if (m) return m[0].toLowerCase();
    }
  }
  return "experimental";
}

// ---------------------------------------------------------------------------
// Render.
// ---------------------------------------------------------------------------
console.log("Gate status (three-valued deterministic checks — judgment criteria sit on top, verify those by hand):\n");
for (const row of gateRows) {
  const cmds = row.keys.length ? `  [${row.keys.map(cmdLabel).join(" · ")}]` : "";
  const notes = row.notes.length ? `  (${row.notes.join("; ")})` : "";
  console.log(`  ${row.g}  ${row.status.padEnd(14)} ${row.desc}${cmds}${notes}`);
}

console.log("\nDeterministic checks (ladder rung from RULES-CHANGELOG.md; unlisted = experimental):");
for (const [key, c] of Object.entries(checks)) {
  const rung = rungFor(GATE_COMMANDS[key].script);
  const scope = c.scopeN === null ? "" : `  Scope: ${c.scopeN}`;
  console.log(`  ${key.padEnd(20)} ${c.status.padEnd(14)} [${rung}]${scope}`);
}

if (open.length) {
  console.log("\nOpen corrections (no gate may render a green summary while these are open):");
  for (const c of open) console.log(`  OPEN-CORRECTION ${c.id} (${c.file}): ${JSON.stringify(c.utterance)} — undispositioned`);
}
if (unrecorded.length) {
  console.log("\nUnrecorded corrections (detector events with no correction artifact — run `node scripts/correct.mjs --detect`, then disposition):");
  for (const e of unrecorded) console.log(`  UNRECORDED-CORRECTION ${e.type} (${e.path}) — ${e.suggestedUtterance}`);
}
const detectorWarn =
  !detectorRan && (has("docs/qa/waivers") || has("docs/qa/uat"))
    ? "auto-correction detectors unavailable (scripts/correct.mjs not installed) while docs/qa/waivers or docs/qa/uat exists — waiver/UAT events cannot be checked until it is installed"
    : null;
if (detectorWarn) console.log(`\nWARN: ${detectorWarn}.`);

for (const d of divergences) {
  console.log(`\nDIVERGENCE: docs/current-state.md ${d} — hard fail: the header may not outrun computed gate status.`);
}
for (const a of advisories) {
  console.log(`ADVISORY (not enforced): done-claim language ${JSON.stringify(a)} in docs/current-state.md has no computed backing — prose is never evidence.`);
}
if (boundaryRed) {
  console.log(`\nNOT-EARNED (committed-evidence, G4+): ${boundaryRed} — evidence must be committed; hooks and CI have not seen this work.`);
} else if (boundaryWarn) {
  console.log(`\nWARN: ${boundaryWarn}.`);
}

let retrofit = null;
if (has(".project-factory/retrofit.json")) {
  try {
    retrofit = JSON.parse(readFileSync(join(root, ".project-factory/retrofit.json"), "utf8"));
  } catch {}
}
if (retrofit?.slices?.length) {
  console.log(`\n⚠ RETROFIT MODE: ${retrofit.slices.length} slice(s) onboarded from existing code — their gate evidence is RETROFITTED, not earned red-first:`);
  console.log(`  ${retrofit.slices.join(", ")}`);
  console.log("  Historical red-first slice history cannot be reconstructed for legacy code; treat as documented baseline, not proof of process.");
}
console.log("\n(Reviews, sign-offs, and vision-verify are judgment gates — confirm them in docs/qa + the gate checklist.)");

const anyCheckFail = Object.values(checks).some((c) => c.status === "FAIL");
const redGates = gateRows.filter((r) => r.idx >= 4 && (r.status === "FAIL" || r.status === "NOT-EARNED"));
let resultWord;
let exitCode;
if (anyCheckFail || divergences.length || open.length || unrecorded.length) {
  resultWord = "FAIL";
  exitCode = 1;
} else if (redGates.length) {
  resultWord = "NOT-EARNED";
  exitCode = 1;
} else {
  resultWord = "PASS";
  exitCode = 0;
}
const warnings = advisories.length + (boundaryWarn ? 1 : 0) + (detectorWarn ? 1 : 0);
console.log(`\nScope: ${gateRows.length} gate(s)`);
console.log(`Result: ${resultWord}${warnings ? `, ${warnings} warning(s)` : ""}`);

const ledgerEvent = {
  event: "gate-status-run",
  check: "gate-status",
  exitCode,
  scope_n: gateRows.length,
  meta: {
    frontier: frontierLabel,
    gates: Object.fromEntries(gateRows.map((r) => [r.g, r.status])),
    divergences: divergences.length,
    openCorrections: open.length,
    unrecordedCorrections: unrecorded.length,
    productCode,
  },
};
if (porcelain !== null) ledgerEvent.dirty = porcelain.trim().length > 0;
emitLedger(ledgerEvent);
process.exit(exitCode);
