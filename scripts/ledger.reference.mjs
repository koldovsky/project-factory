// REFERENCE IMPLEMENTATION — process-health ledger substrate (mechanism 1).
//
// Append-only telemetry: every battery / gate-status / git-hook run appends
// ONE JSON line to trace/ledger.jsonl. The ledger itself is SOFT and
// fail-open by design — a telemetry write error must NEVER break the caller
// (it prints a warning to stderr and exits 0 / returns without throwing).
// Its CONSUMERS are the hard gates (ledger-report digest, process ratchet).
// `scope_n` is the load-bearing field: it makes "PASS on 0 slices"
// machine-distinguishable from an earned PASS.
//
// Copy to scripts/ledger.mjs in the new project. Use it either way:
//   import { emit } from "./ledger.mjs";               // qa-verify, gate-status
//   emit({ event: "check-run", check: "traceability", exitCode: 0, scope_n: 12 });
// or shell out (git hooks, npm scripts):
//   node scripts/ledger.mjs emit '{"event":"check-run","check":"recordings","exitCode":0,"scope_n":0}'
//
// Event schema (missing fields are auto-enriched or null — pass what you have):
//   { ts, event, check, exitCode, failures, warnings, warningsByClass,
//     scope_n, phase, gitHead, dirty, durationMs, meta }
// Auto-enrichment: ts = now (ISO); gitHead + dirty via git rev-parse / git
// status --porcelain (tolerates git absence → null); phase parsed from the
// machine-readable header in docs/current-state.md when present.
//
// FACTORY_TELEMETRY=off disables emission entirely (prints nothing, exit 0).
// DESIGN INVARIANT: that kill switch disables telemetry ONLY. Honesty checks
// (vacuity flip, acceptance-contract join, stub scan, claim divergence) live
// inside qa-verify/gate-status and are NOT governed by this switch.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const LEDGER_REL_PATH = join("trace", "ledger.jsonl");

const telemetryOff = (env = process.env) => env.FACTORY_TELEMETRY === "off";

function gitInfo(root) {
  const out = { gitHead: null, dirty: null };
  try {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
    if (head.status === 0 && head.stdout) out.gitHead = head.stdout.trim() || null;
    const st = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
    if (st.status === 0 && typeof st.stdout === "string") out.dirty = st.stdout.trim().length > 0;
  } catch {
    /* git absent or broken — tolerated, stays null */
  }
  return out;
}

function normalizePhase(raw) {
  const s = String(raw).trim();
  const m = s.match(/phase\s*(\d+[a-z]?)/i) ?? s.match(/^(\d+[a-z]?)\b/);
  return m ? m[1] : s || null;
}

// Parse the current phase from docs/current-state.md. Supports (in order):
// 1. a machine-readable block:  <!-- factory-state\nphase: 4\n... -->
// 2. the template line:         - **Current phase:** Phase 4 — ...
// 3. a bare header line:        Phase: 4
export function parsePhase(root = process.cwd()) {
  try {
    const p = join(root, "docs", "current-state.md");
    if (!existsSync(p)) return null;
    const text = readFileSync(p, "utf8");
    const block = text.match(/<!--\s*factory-state([\s\S]*?)-->/i);
    if (block) {
      const m = block[1].match(/^\s*phase\s*:\s*(.+?)\s*$/im);
      if (m) return normalizePhase(m[1]);
    }
    const line = text.match(/\*\*Current phase:\*\*\s*(.+)$/im);
    if (line) return normalizePhase(line[1]);
    const bare = text.match(/^phase\s*:\s*(.+)$/im);
    if (bare) return normalizePhase(bare[1]);
  } catch {
    /* unreadable handoff file — tolerated */
  }
  return null;
}

const asNum = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Normalize a partial event into the full schema, enriching what is missing.
// Only touches git / current-state.md for fields the caller did NOT provide.
export function normalizeEvent(partial = {}, root = process.cwd()) {
  const needGit = partial.gitHead === undefined || partial.dirty === undefined;
  const git = needGit ? gitInfo(root) : { gitHead: null, dirty: null };
  return {
    ts: typeof partial.ts === "string" && partial.ts ? partial.ts : new Date().toISOString(),
    event: typeof partial.event === "string" && partial.event ? partial.event : "event",
    check: partial.check ?? null,
    exitCode: asNum(partial.exitCode),
    failures: asNum(partial.failures),
    warnings: asNum(partial.warnings),
    warningsByClass:
      partial.warningsByClass && typeof partial.warningsByClass === "object" && !Array.isArray(partial.warningsByClass)
        ? partial.warningsByClass
        : {},
    scope_n: asNum(partial.scope_n),
    phase: partial.phase !== undefined ? partial.phase : parsePhase(root),
    gitHead: partial.gitHead !== undefined ? partial.gitHead : git.gitHead,
    dirty: partial.dirty !== undefined ? partial.dirty : git.dirty,
    durationMs: asNum(partial.durationMs),
    meta: partial.meta && typeof partial.meta === "object" && !Array.isArray(partial.meta) ? partial.meta : {},
  };
}

// Append one event to trace/ledger.jsonl. FAIL-OPEN: never throws — on any
// error it warns on stderr and returns { ok: false }. Silent on success.
// Returns { ok, disabled?, path?, event?, error? }.
export function emit(partial, opts = {}) {
  const env = opts.env ?? process.env;
  if (telemetryOff(env)) return { ok: false, disabled: true };
  try {
    const root = opts.root ?? process.cwd();
    const event = normalizeEvent(partial, root);
    const dir = join(root, "trace");
    mkdirSync(dir, { recursive: true });
    const path = join(root, LEDGER_REL_PATH);
    appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
    return { ok: true, path, event };
  } catch (err) {
    try {
      process.stderr.write(`ledger: WARN telemetry write failed (fail-open, continuing): ${err?.message ?? err}\n`);
    } catch {
      /* even stderr failing must not throw */
    }
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// ---------------------------------------------------------------------------
// Tiny CLI:  node scripts/ledger.mjs emit '<json>'
// ALWAYS exits 0 — telemetry must never block a hook or battery run.
// ---------------------------------------------------------------------------
const isMain = (() => {
  try {
    return pathToFileURL(resolve(process.argv[1] ?? "")).href.toLowerCase() === import.meta.url.toLowerCase();
  } catch {
    return false;
  }
})();

if (isMain) {
  if (telemetryOff()) process.exit(0); // disabled: no write, no output at all
  const [cmd, payload] = process.argv.slice(2);
  if (cmd !== "emit") {
    process.stderr.write("ledger: WARN unknown or missing command (fail-open, exit 0). Usage: node scripts/ledger.mjs emit '<json>'\n");
    process.exit(0);
  }
  let event = null;
  try {
    event = JSON.parse(payload ?? "");
  } catch {
    process.stderr.write("ledger: WARN payload is not valid JSON (fail-open, event dropped)\n");
    process.exit(0);
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    process.stderr.write("ledger: WARN payload must be a JSON object (fail-open, event dropped)\n");
    process.exit(0);
  }
  emit(event); // emit() handles its own error reporting
  process.exit(0);
}
