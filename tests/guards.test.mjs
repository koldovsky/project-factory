// Red-to-green proof for the ratchet DIRECTION GUARD (tighten-only --update)
// and the normalized "Scope: <n> <unit>" / "Result: ..." stdout convention in
// check-coverage-ratchet, check-eval-ratchet, check-trajectory and
// check-recordings.
//
// Plain Node (>=18), no deps. Each case copies a fixture tree from
// tests/fixtures/guards/{red,green}/ into a fresh temp dir (fixtures stay
// pristine), runs the reference script as a child process there, and asserts
// exit code + messages. Exits non-zero if any assertion fails.
//
// Run: node tests/guards.test.mjs
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(here, "..", "scripts");
const FIXTURES = join(here, "fixtures", "guards");
const COVERAGE = join(SCRIPTS, "check-coverage-ratchet.reference.mjs");
const EVAL = join(SCRIPTS, "check-eval-ratchet.reference.mjs");
const TRAJECTORY = join(SCRIPTS, "check-trajectory.reference.mjs");
const RECORDINGS = join(SCRIPTS, "check-recordings.reference.mjs");

let failures = 0;
let checks = 0;
const tempDirs = [];

function stage(fixtureRel) {
  const dir = mkdtempSync(join(tmpdir(), "guards-test-"));
  tempDirs.push(dir);
  cpSync(join(FIXTURES, fixtureRel), dir, { recursive: true });
  return dir;
}

function runScript(script, args, cwd) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function assert(cond, label, detail = "") {
  checks += 1;
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

const scopeLines = (out) => out.split(/\r?\n/).filter((l) => l.startsWith("Scope: "));
const resultLines = (out) => out.split(/\r?\n/).filter((l) => l.startsWith("Result: "));

// ---------------------------------------------------------------- coverage --
console.log("\n[red] coverage ratchet: --update with LOWER coverage must be refused");
{
  const dir = stage("red/coverage-lower");
  const r = runScript(COVERAGE, ["--update"], dir);
  assert(r.code === 1, "exits 1", `exit=${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert(/would LOWER lines 80% -> 60%/.test(r.stderr), "names the lowered metric and direction", r.stderr);
  assert(/tighten-only/.test(r.stderr), "says the ratchet is tighten-only", r.stderr);
  assert(/docs\/qa\/waivers\//.test(r.stderr), "points at the docs/qa/waivers/ path", r.stderr);
  assert(resultLines(r.stdout).join() === "Result: FAIL", "prints Result: FAIL", r.stdout);
  const baseline = JSON.parse(readFileSync(join(dir, "quality", "coverage-baseline.json"), "utf8"));
  assert(baseline.lines === 80, "baseline file was NOT overwritten", JSON.stringify(baseline));
}

console.log("\n[green] coverage ratchet: --update with HIGHER coverage writes the baseline");
{
  const dir = stage("green/coverage-higher");
  const r = runScript(COVERAGE, ["--update"], dir);
  assert(r.code === 0, "exits 0", `exit=${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert(/baseline updated/.test(r.stdout), 'prints "baseline updated"', r.stdout);
  assert(scopeLines(r.stdout).join() === "Scope: 4 coverage metric(s)", "prints exactly one Scope line", r.stdout);
  assert(resultLines(r.stdout).join() === "Result: PASS", "prints Result: PASS", r.stdout);
  const baseline = JSON.parse(readFileSync(join(dir, "quality", "coverage-baseline.json"), "utf8"));
  assert(baseline.lines === 85.5 && baseline.branches === 78, "baseline ratcheted up to current", JSON.stringify(baseline));
}

console.log("\n[green] coverage ratchet: an explicit waiver naming the metric allows the loosening");
{
  const dir = stage("green/coverage-waived");
  const r = runScript(COVERAGE, ["--update"], dir);
  assert(r.code === 0, "exits 0", `exit=${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert(/loosened 80% -> 60% under an explicit waiver/.test(r.stderr), "loosening is loud (WARN), not silent", r.stderr);
  const baseline = JSON.parse(readFileSync(join(dir, "quality", "coverage-baseline.json"), "utf8"));
  assert(baseline.lines === 60, "waived baseline written", JSON.stringify(baseline));
}

// -------------------------------------------------------- missing baseline --
console.log("\n[red] coverage ratchet: deleting the baseline must NOT silently mint a lower floor");
{
  const dir = stage("green/coverage-higher");
  rmSync(join(dir, "quality", "coverage-baseline.json"));
  const r = runScript(COVERAGE, [], dir);
  assert(r.code === 0, "compare mode exits 0 (pending, not laundered)", `exit=${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert(resultLines(r.stdout).join() === "Result: SKIP-pending", "prints Result: SKIP-pending, never PASS", r.stdout);
  assert(/never mints a baseline/.test(r.stderr) && /--update/.test(r.stderr), "WARN points at explicit --update", r.stderr);
  assert(!existsSync(join(dir, "quality", "coverage-baseline.json")), "compare run did NOT re-create the baseline");
}

console.log("\n[green] coverage ratchet: --update creates the missing baseline LOUDLY");
{
  const dir = stage("green/coverage-higher");
  rmSync(join(dir, "quality", "coverage-baseline.json"));
  const r = runScript(COVERAGE, ["--update"], dir);
  assert(r.code === 0, "exits 0", `exit=${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert(/baseline created from current values — commit/.test(r.stderr), "creation is a visible WARN (commit + review the diff)", r.stderr);
  assert(/baseline created/.test(r.stdout), 'prints "baseline created"', r.stdout);
  assert(existsSync(join(dir, "quality", "coverage-baseline.json")), "baseline written under explicit --update");
}

console.log("\n[red] eval ratchet: deleting the baseline must NOT silently mint a lower floor");
{
  const dir = stage("green/eval-results");
  rmSync(join(dir, "quality", "eval-baseline.json"), { force: true });
  const r = runScript(EVAL, [], dir);
  assert(r.code === 0 && resultLines(r.stdout).join() === "Result: SKIP-pending", "compare mode is SKIP-pending, never PASS", `exit=${r.code}\n${r.stdout}${r.stderr}`);
  assert(!existsSync(join(dir, "quality", "eval-baseline.json")), "compare run did NOT re-create the baseline");
  const u = runScript(EVAL, ["--update"], dir);
  assert(u.code === 0 && /baseline created from current values/.test(u.stderr), "--update creates it loudly", `exit=${u.code}\n${u.stdout}${u.stderr}`);
}

// -------------------------------------------------------------------- eval --
console.log("\n[red] eval ratchet: --update with LOWER dimension score must be refused");
{
  const dir = stage("red/eval-lower");
  const r = runScript(EVAL, ["--update"], dir);
  assert(r.code === 1, "exits 1", `exit=${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert(/would LOWER error-clarity 90 -> 70/.test(r.stderr), "names the lowered dimension", r.stderr);
  assert(/docs\/qa\/waivers\//.test(r.stderr), "points at the docs/qa/waivers/ path", r.stderr);
  assert(resultLines(r.stdout).join() === "Result: FAIL", "prints Result: FAIL", r.stdout);
  const baseline = JSON.parse(readFileSync(join(dir, "quality", "eval-baseline.json"), "utf8"));
  assert(baseline["error-clarity"] === 90, "baseline file was NOT overwritten", JSON.stringify(baseline));
}

console.log("\n[green] eval ratchet: compare mode on real results prints the Scope line");
{
  const dir = stage("green/eval-results");
  const r = runScript(EVAL, [], dir);
  assert(r.code === 0, "exits 0", `exit=${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert(scopeLines(r.stdout).join() === "Scope: 3 eval case(s)", 'prints exactly one "Scope: 3 eval case(s)"', r.stdout);
  assert(resultLines(r.stdout).join() === "Result: PASS", "prints Result: PASS", r.stdout);
}

console.log("\n[green] eval ratchet: --update with HIGHER scores writes the baseline");
{
  const dir = stage("green/eval-results");
  const r = runScript(EVAL, ["--update"], dir);
  assert(r.code === 0, "exits 0", `exit=${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const baseline = JSON.parse(readFileSync(join(dir, "quality", "eval-baseline.json"), "utf8"));
  assert(baseline["error-clarity"] === 88, "baseline ratcheted up to current", JSON.stringify(baseline));
}

console.log("\n[green] eval ratchet: missing results = explicit SKIP-pending, never a silent pass");
{
  const dir = stage("green/empty-project");
  const r = runScript(EVAL, [], dir);
  assert(r.code === 0, "exits 0 (pre-phase)", `exit=${r.code}\nstderr: ${r.stderr}`);
  assert(scopeLines(r.stdout).join() === "Scope: 0 eval case(s)", "prints Scope: 0 eval case(s)", r.stdout);
  assert(resultLines(r.stdout).join() === "Result: SKIP-pending", "prints Result: SKIP-pending", r.stdout);
}

// ------------------------------------------------- stdout convention: scope --
console.log("\n[green] check-recordings: normalized Scope + Result lines on stdout");
{
  const dir = stage("green/empty-project");
  const r = runScript(RECORDINGS, [], dir);
  assert(r.code === 0, "exits 0", `exit=${r.code}\nstderr: ${r.stderr}`);
  assert(scopeLines(r.stdout).join() === "Scope: 0 clip(s) across 0 manifest(s)", "prints exactly one Scope line", r.stdout);
  // PD-4: an empty tree with no product code and no --strict is SKIP-pending,
  // never a bare PASS over zero clips (the vacuous-pass-not-earned rule).
  assert(/^Result: SKIP-pending, 1 warning\(s\)$/m.test(r.stdout), "prints Result: SKIP-pending, 1 warning(s)", r.stdout);
}

console.log("\n[green] check-trajectory: normalized Scope + Result lines on stdout");
{
  const dir = stage("green/empty-project");
  const r = runScript(TRAJECTORY, [], dir);
  assert(r.code === 0, "exits 0", `exit=${r.code}\nstderr: ${r.stderr}`);
  assert(scopeLines(r.stdout).join() === "Scope: 0 archived slice(s)", "prints exactly one Scope line", r.stdout);
  assert(/^Result: PASS/m.test(r.stdout), "prints Result: PASS[, N warning(s)]", r.stdout);
}

// ----------------------------------------------------------------- summary --
for (const d of tempDirs) {
  try {
    rmSync(d, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}
console.log(`\nguards: ${checks} assertion(s), ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
