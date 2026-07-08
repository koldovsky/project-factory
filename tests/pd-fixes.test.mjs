// Executed red→green proof for the two process-defect fixes:
//
//   PD-4  scripts/check-recordings.reference.mjs — an empty recordings base
//         renders the gate's OWN verdict. Scope 0 while product code exists
//         (or under --strict) is NOT-EARNED (exit 1), never a bare PASS; only
//         genuine pre-Phase-6 emptiness prints SKIP-pending (exit 0).
//
//   PD-7  scripts/check-acceptance-methods.reference.mjs — a waiver suppresses
//         a failure only while its STATUS is OPEN. A closed/resolved/expired
//         waiver stops suppressing and the failure resurfaces; missing status
//         stays open for back-compat.
//
// Both run the real reference scripts as child processes against SYNTHETIC
// fixture trees under tests/fixtures/pd/** (no client content). Plain Node,
// self-contained, exits non-zero on any failed assertion.
//
// Run: node tests/pd-fixes.test.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RECORDINGS = join(here, "..", "scripts", "check-recordings.reference.mjs");
const ACCEPTANCE = join(here, "..", "scripts", "check-acceptance-methods.reference.mjs");
const FIXTURES = join(here, "fixtures", "pd");

let failed = 0;
let n = 0;
function check(name, cond, detail = "") {
  n += 1;
  if (cond) console.log(`ok ${n} - ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${n} - ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const tmps = [];
function runIn(script, fixture, args, mutate) {
  const tmp = mkdtempSync(join(tmpdir(), "pd-fixture-"));
  tmps.push(tmp);
  cpSync(join(FIXTURES, fixture), tmp, { recursive: true });
  if (mutate) mutate(tmp);
  const r = spawnSync(process.execPath, [script, ...args], { cwd: tmp, encoding: "utf8" });
  return { tmp, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ==================== PD-4 — check-recordings ====================

// 1. RED: product code + zero clips => NOT-EARNED (exit 1), never a bare PASS.
{
  const { status, out } = runIn(RECORDINGS, "recordings-red", []);
  check("PD-4 red: product code + 0 clips exits 1", status === 1, `exit=${status}\n${out}`);
  check("PD-4 red: Result is NOT-EARNED (not PASS)", /^Result: NOT-EARNED/m.test(out) && !/^Result: PASS/m.test(out), out);
  check("PD-4 red: prints Scope: 0 clip(s)", /^Scope: 0 clip\(s\)/m.test(out), out);
  check("PD-4 red: names the empty-evidence NOT-EARNED reason", /NOT-EARNED\s+\[recordings\].*product code exists/.test(out), out);
}

// 2. GREEN: product code + one REAL clip => PASS (exit 0).
{
  const { status, out } = runIn(RECORDINGS, "recordings-green", []);
  check("PD-4 green: real clip exits 0", status === 0, `exit=${status}\n${out}`);
  check("PD-4 green: Result is PASS", /^Result: PASS/m.test(out), out);
  check("PD-4 green: Scope is 1 clip", /^Scope: 1 clip\(s\)/m.test(out), out);
}

// 3. PRE-PHASE: no product code, no --strict => SKIP-pending (exit 0), never PASS.
{
  const { status, out } = runIn(RECORDINGS, "recordings-prephase", []);
  check("PD-4 pre-phase: exits 0", status === 0, `exit=${status}\n${out}`);
  check("PD-4 pre-phase: Result is SKIP-pending, never a bare PASS", /^Result: SKIP-pending/m.test(out) && !/^Result: PASS/m.test(out), out);
}

// 4. --strict flips pre-phase emptiness to NOT-EARNED (exit 1).
{
  const { status, out } = runIn(RECORDINGS, "recordings-prephase", ["--strict"]);
  check("PD-4 --strict: pre-phase emptiness exits 1", status === 1, `exit=${status}\n${out}`);
  check("PD-4 --strict: Result is NOT-EARNED", /^Result: NOT-EARNED/m.test(out), out);
}

// ==================== PD-7 — acceptance waiver STATUS ====================

const OPEN_WAIVER = "# Waiver: FR-1\n\nStatus: open\n\nVision-verify evidence deferred to the next milestone.\n";
const CLOSED_WAIVER = "# Waiver: FR-1\n\nStatus: closed\n\nThis waiver was resolved; do not let it launder a live failure.\n";
const NOSTATUS_WAIVER = "# Waiver: FR-1\n\nOwner-signed exception for this milestone.\n";
function writeWaiver(tmp, body) {
  mkdirSync(join(tmp, "docs", "qa", "waivers"), { recursive: true });
  writeFileSync(join(tmp, "docs", "qa", "waivers", "fr1.md"), body);
}

// 5. No waiver: FR-1's missing vision-verify mechanism is a live FAIL.
{
  const { status, out } = runIn(ACCEPTANCE, "acceptance", ["--mode=existence"]);
  check("PD-7 no waiver: exits 1", status === 1, `exit=${status}\n${out}`);
  check("PD-7 no waiver: FAIL [FR-1] vision-verify", /FAIL\s+\[FR-1\].*vision-verify/.test(out), out);
}

// 6. OPEN waiver suppresses (visible WAIVED line, exit 0).
{
  const { status, out } = runIn(ACCEPTANCE, "acceptance", ["--mode=existence"], (tmp) => writeWaiver(tmp, OPEN_WAIVER));
  check("PD-7 open waiver: exits 0", status === 0, `exit=${status}\n${out}`);
  check("PD-7 open waiver: prints a visible WAIVED line", /^WAIVED \[FR-1\]/m.test(out), out);
  check("PD-7 open waiver: no live FAIL for FR-1", !/FAIL\s+\[FR-1\]/.test(out), out);
}

// 7. CLOSED waiver STOPS suppressing — the failure resurfaces (exit 1) and a
//    visible note is printed. This is the PD-7 defect: previously any waiver
//    that merely mentioned the id suppressed forever.
{
  const { status, out } = runIn(ACCEPTANCE, "acceptance", ["--mode=existence"], (tmp) => writeWaiver(tmp, CLOSED_WAIVER));
  check("PD-7 closed waiver: exits 1 (failure resurfaces)", status === 1, `exit=${status}\n${out}`);
  check("PD-7 closed waiver: FAIL [FR-1] is back", /FAIL\s+\[FR-1\].*vision-verify/.test(out), out);
  check("PD-7 closed waiver: NOT rendered as WAIVED", !/^WAIVED \[FR-1\]/m.test(out), out);
  check("PD-7 closed waiver: prints a visible closed-waiver note", /note: waiver .*FR-1 is closed/.test(out), out);
}

// 8. Back-compat: a waiver with NO status field is treated as OPEN.
{
  const { status, out } = runIn(ACCEPTANCE, "acceptance", ["--mode=existence"], (tmp) => writeWaiver(tmp, NOSTATUS_WAIVER));
  check("PD-7 no-status waiver: still suppresses (back-compat), exit 0", status === 0, `exit=${status}\n${out}`);
  check("PD-7 no-status waiver: prints WAIVED line", /^WAIVED \[FR-1\]/m.test(out), out);
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });

console.log(`\n${n - failed}/${n} assertions passed`);
console.log(`Result: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
