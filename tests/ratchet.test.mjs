// Executed red->green proof for scripts/check-process-ratchet.reference.mjs.
//
// Plain Node (>= 18), zero deps, self-contained: runs the check as a child
// process against minimal fake project trees under tests/fixtures/ratchet/
// and exits non-zero if any expectation fails. Mutating cases (--update) run
// against a temp copy so the fixtures stay pristine.
//
// Run: node tests/ratchet.test.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "scripts", "check-process-ratchet.reference.mjs");
const FIX = join(here, "fixtures", "ratchet");

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`ok    ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${detail}`);
  }
}
function run(cwd, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const tempCopy = (fixture) => {
  const dir = mkdtempSync(join(tmpdir(), "ratchet-test-"));
  cpSync(join(FIX, fixture), dir, { recursive: true });
  return dir;
};

// ---------- green: everything truthful, under budget -> PASS ----------
{
  const r = run(join(FIX, "green"));
  check("green exits 0", r.code === 0, `exit ${r.code}\n${r.out}`);
  check("green prints Result: PASS", /Result: PASS/.test(r.out), r.out);
  check("green prints a Scope line", /^Scope: \d+ guard/m.test(r.out), r.out);
}

// ---------- red: class over its phase budget -> FAIL ----------
{
  const r = run(join(FIX, "red-budget"));
  check("red-budget exits 1", r.code === 1, `exit ${r.code}\n${r.out}`);
  check("red-budget names the class over budget", /"recording-evidence": 3 warning\(s\) over budget \(0\) for phase 6/.test(r.out), r.out);
  check("red-budget prints Result: FAIL", /Result: FAIL/.test(r.out), r.out);
}

// ---------- red: vacuous passes with product code present -> FAIL ----------
{
  const r = run(join(FIX, "red-vacuous"));
  check("red-vacuous exits 1", r.code === 1, `exit ${r.code}\n${r.out}`);
  check("red-vacuous names the vacuous passes", /vacuous pass\(es\).*must be 0 once product code exists/.test(r.out), r.out);
}

// ---------- red: @trace annotations that join nothing -> FAIL ----------
{
  const r = run(join(FIX, "red-dead-trace"));
  check("red-dead-trace exits 1", r.code === 1, `exit ${r.code}\n${r.out}`);
  check("red-dead-trace raises the dead-@trace alarm", /dead-@trace alarm: 1 @trace annotation\(s\).*0 join the traceability chain/.test(r.out), r.out);
}

// ---------- red: open review finding without fix-commit/waiver at --release ----------
{
  const r = run(join(FIX, "red-release"), ["--release"]);
  check("red-release exits 1", r.code === 1, `exit ${r.code}\n${r.out}`);
  check("red-release names the open finding", /open review finding "RF-1" has no fix-commit or waiver/.test(r.out), r.out);
  const r2 = run(join(FIX, "red-release"));
  check("open finding is release-scoped (no --release: not a failure line)", !/open review finding/.test(r2.out), r2.out);
}

// ---------- direction guard: loosening --update rejected, baseline untouched ----------
{
  const dir = tempCopy("red-loosen");
  const before = readFileSync(join(dir, "quality", "process-baseline.json"), "utf8");
  const r = run(dir, ["--update"]);
  const after = readFileSync(join(dir, "quality", "process-baseline.json"), "utf8");
  check("loosening --update exits 1", r.code === 1, `exit ${r.code}\n${r.out}`);
  check("rejects the coverage drop", /acceptanceCoverage would drop 100% -> 60%/.test(r.out), r.out);
  check("rejects the budget widening", /budget would widen: recording-evidence\[6\+\] 0 -> 50/.test(r.out), r.out);
  check("points to the waiver path", /docs\/qa\/waivers\//.test(r.out) && /tighten-only/.test(r.out), r.out);
  check("never prints Result: PASS on rejection", !/Result: PASS/.test(r.out), r.out);
  check("baseline file was NOT modified", before === after, "baseline changed on a rejected update");
  rmSync(dir, { recursive: true, force: true });
}

// ---------- direction guard: tightening --update accepted ----------
{
  const dir = tempCopy("green-tighten");
  const r = run(dir, ["--update"]);
  check("tightening --update exits 0", r.code === 0, `exit ${r.code}\n${r.out}`);
  check("reports the baseline tightened", /baseline tightened/.test(r.out), r.out);
  const b = JSON.parse(readFileSync(join(dir, "quality", "process-baseline.json"), "utf8"));
  check("baseline coverage ratcheted 3/5 -> 5/5", b.acceptanceCoverage.covered === 5 && b.acceptanceCoverage.declared === 5, JSON.stringify(b));
  rmSync(dir, { recursive: true, force: true });
}

// ---------- direction guard: NEW warning-class laundering rejected ----------
// A config that introduces a class the baseline never named (or renames one)
// with a huge per-class budget must NOT slip past --update: the class was
// previously capped by baseline["*"], so exceeding that cap is a widening.
{
  const dir = tempCopy("green-tighten");
  const cfgPath = join(dir, "quality", "telemetry.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.warningBudgets["missing-artifact"] = { "0+": 9999 };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  const before = readFileSync(join(dir, "quality", "process-baseline.json"), "utf8");
  const r = run(dir, ["--update"]);
  const after = readFileSync(join(dir, "quality", "process-baseline.json"), "utf8");
  check("new-class laundering --update exits 1", r.code === 1, `exit ${r.code}\n${r.out}`);
  check(
    "names the new class and the * cap it exceeds",
    /budget would widen via NEW class: missing-artifact\[0\+\] 9999 exceeds the baseline "\*" cap 25/.test(r.out),
    r.out,
  );
  check("baseline untouched after rejected rename-laundering", before === after, "baseline changed on a rejected update");
  rmSync(dir, { recursive: true, force: true });
}

// ---------- direction guard: a new class UNDER the * cap is accepted ----------
{
  const dir = tempCopy("green-tighten");
  const cfgPath = join(dir, "quality", "telemetry.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.warningBudgets["missing-artifact"] = { "0+": 10 };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  const r = run(dir, ["--update"]);
  check("new class within the * cap is accepted (no false positive)", r.code === 0 && /baseline tightened/.test(r.out), `exit ${r.code}\n${r.out}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---------- missing baseline: NOT-EARNED, never PASS ----------
{
  const r = run(join(FIX, "missing-baseline"));
  check("missing-baseline exits 0 in default mode", r.code === 0, `exit ${r.code}\n${r.out}`);
  check("missing-baseline prints NOT-EARNED (pending baseline)", /Result: NOT-EARNED \(pending baseline/.test(r.out), r.out);
  check("missing-baseline never prints Result: PASS", !/Result: PASS/.test(r.out), r.out);
  const rs = run(join(FIX, "missing-baseline"), ["--strict"]);
  check("missing-baseline exits 1 under --strict", rs.code === 1, `exit ${rs.code}\n${rs.out}`);
  check("--strict still renders NOT-EARNED, not FAIL-invented-evidence", /NOT-EARNED/.test(rs.out), rs.out);
}

console.log(`\nratchet.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
