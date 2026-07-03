// Red→green proof for the ledger substrate + deterministic digest.
//
// Runs scripts/ledger.reference.mjs and scripts/ledger-report.reference.mjs
// as child processes against temp copies of tests/fixtures/ledger/{red,green}
// plus synthetic dirs, and asserts:
//   - emit appends a schema-complete JSONL line (CLI + importable API)
//   - phase auto-enrichment from docs/current-state.md
//   - FAIL-OPEN: a write failure warns on stderr and still exits 0
//   - FACTORY_TELEMETRY=off emits nothing and prints nothing
//   - digest RED  (product code + empty ledger)  => NOT-EARNED, exit 1, skeleton written
//   - digest GREEN (fixture ledger)              => PASS, exit 0, vacuous-pass metric present
//   - digest on truly-pre-build empty dir        => SKIP-pending, exit 0, skeleton written
//   - skeleton never clobbers an auditor-authored process-defects.json
//
// Plain Node (>=18), no deps. Run: node tests/ledger.test.mjs  (exit != 0 on failure)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const LEDGER = join(repo, "scripts", "ledger.reference.mjs");
const REPORT = join(repo, "scripts", "ledger-report.reference.mjs");
const RATCHET = join(repo, "scripts", "check-process-ratchet.reference.mjs");
const FIXTURES = join(here, "fixtures", "ledger");

const base = mkdtempSync(join(tmpdir(), "factory-ledger-test-"));
let failures = 0;
let checks = 0;
function assert(cond, label, detail = "") {
  checks += 1;
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const runNode = (script, args, cwd, env = {}) =>
  spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const caseDir = (name) => {
  const d = join(base, name);
  mkdirSync(d, { recursive: true });
  return d;
};

// ---------------------------------------------------------------------------
console.log("\n[1] CLI emit appends a schema-complete event");
{
  const dir = caseDir("emit-cli");
  const payload = JSON.stringify({
    event: "check-run", check: "traceability", exitCode: 0, failures: 0, warnings: 2,
    warningsByClass: { trace: 2 }, scope_n: 12, phase: "4", gitHead: "deadbeef", dirty: false, durationMs: 42,
  });
  const r = runNode(LEDGER, ["emit", payload], dir);
  assert(r.status === 0, "exit code 0", `got ${r.status}, stderr: ${r.stderr}`);
  const ledgerPath = join(dir, "trace", "ledger.jsonl");
  assert(existsSync(ledgerPath), "trace/ledger.jsonl created");
  const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
  assert(lines.length === 1, "exactly one JSONL line");
  const e = JSON.parse(lines[0]);
  assert(e.check === "traceability" && e.scope_n === 12 && e.exitCode === 0, "fields round-trip");
  assert(typeof e.ts === "string" && e.ts.length > 0, "ts auto-enriched");
  const keys = ["ts", "event", "check", "exitCode", "failures", "warnings", "warningsByClass", "scope_n", "phase", "gitHead", "dirty", "durationMs", "meta"];
  assert(keys.every((k) => k in e), "full schema present", `missing: ${keys.filter((k) => !(k in e)).join(",")}`);
}

// ---------------------------------------------------------------------------
console.log("\n[2] importable emit() + phase enrichment from docs/current-state.md");
{
  const dir = caseDir("emit-import");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "current-state.md"), "# Current State\n\n- **Current phase:** Phase 4 — implementing slice 3 of 7\n", "utf8");
  const { emit } = await import(new URL("../scripts/ledger.reference.mjs", import.meta.url));
  const res = emit({ event: "gate-run", check: "gate-status", exitCode: 0, scope_n: 5, gitHead: "cafe01", dirty: true }, { root: dir });
  assert(res.ok === true, "emit() returns ok:true");
  const e = JSON.parse(readFileSync(join(dir, "trace", "ledger.jsonl"), "utf8").trim());
  assert(e.phase === "4", "phase parsed from current-state.md header", `got ${JSON.stringify(e.phase)}`);
  assert(e.gitHead === "cafe01" && e.dirty === true, "caller-provided gitHead/dirty untouched");
}

// ---------------------------------------------------------------------------
console.log("\n[3] FAIL-OPEN: write failure warns on stderr, still exits 0");
{
  const dir = caseDir("emit-failopen");
  mkdirSync(join(dir, "trace", "ledger.jsonl"), { recursive: true }); // ledger path IS a directory => append fails
  const r = runNode(LEDGER, ["emit", '{"event":"check-run","check":"x","exitCode":0,"gitHead":"h","dirty":false}'], dir);
  assert(r.status === 0, "exit code 0 despite write failure", `got ${r.status}`);
  assert(/ledger: WARN telemetry write failed \(fail-open/.test(r.stderr), "fail-open warning on stderr", `stderr: ${r.stderr}`);

  const bad = runNode(LEDGER, ["emit", "{not json"], dir);
  assert(bad.status === 0, "invalid JSON payload still exits 0", `got ${bad.status}`);
  assert(/ledger: WARN payload is not valid JSON/.test(bad.stderr), "invalid-JSON warning on stderr");
}

// ---------------------------------------------------------------------------
console.log("\n[4] FACTORY_TELEMETRY=off: no file, no output, exit 0");
{
  const dir = caseDir("emit-off");
  const r = runNode(LEDGER, ["emit", '{"event":"check-run","check":"x","exitCode":0}'], dir, { FACTORY_TELEMETRY: "off" });
  assert(r.status === 0, "exit code 0");
  assert(r.stdout === "" && r.stderr === "", "prints nothing at all", `stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);
  assert(!existsSync(join(dir, "trace", "ledger.jsonl")), "no ledger file written");
}

// ---------------------------------------------------------------------------
console.log("\n[5] digest RED fixture: product code + empty ledger => NOT-EARNED, exit 1, skeleton");
{
  const dir = join(base, "digest-red");
  cpSync(join(FIXTURES, "red"), dir, { recursive: true });
  const r = runNode(REPORT, [], dir);
  assert(r.status === 1, "exit code 1 (post-phase emptiness is never success)", `got ${r.status}\n${r.stdout}${r.stderr}`);
  assert(/^Scope: 0 ledger event\(s\)$/m.test(r.stdout), "Scope line printed");
  assert(/^Result: NOT-EARNED$/m.test(r.stdout), "Result: NOT-EARNED printed", r.stdout);
  assert(/no ledger events/.test(r.stdout), "explicitly states the ledger is empty/missing");
  const md = readFileSync(join(dir, "docs", "qa", "process-health.md"), "utf8");
  assert(/NOT-EARNED/.test(md) && /telemetry never ran/i.test(md), "process-health.md written and explicit about emptiness");
  assert(existsSync(join(dir, "trace", "process-health.json")), "process-health.json written");
  const skel = readJson(join(dir, "docs", "qa", "process-defects.json"));
  assert(skel.source === "ledger-report-deterministic-fallback", "skeleton has fallback source marker");
  assert(skel.defects.some((d) => d.class === "telemetry-missing"), "skeleton records telemetry-missing defect");
}

// ---------------------------------------------------------------------------
console.log("\n[6] digest GREEN fixture: PASS, exit 0, vacuous-pass metric surfaces");
{
  const dir = join(base, "digest-green");
  cpSync(join(FIXTURES, "green"), dir, { recursive: true });
  const r = runNode(REPORT, [], dir);
  assert(r.status === 0, "exit code 0", `got ${r.status}\n${r.stdout}${r.stderr}`);
  assert(/^Scope: 5 ledger event\(s\)$/m.test(r.stdout), "Scope: 5 ledger event(s)", r.stdout);
  assert(/^Result: PASS, \d+ warning\(s\)$/m.test(r.stdout), "Result: PASS with warnings", r.stdout);
  assert(/vacuous pass/i.test(r.stdout + r.stderr), "vacuous pass surfaced as a warning");
  const health = readJson(join(dir, "trace", "process-health.json"));
  const m = health.metrics;
  assert(m.vacuousPasses.count === 1 && m.vacuousPasses.events[0].check === "recordings", "vacuousPasses metric = 1 (recordings, scope 0, meta.productCode)", JSON.stringify(m.vacuousPasses));
  assert(m.retriesPerCheck.traceability.retries === 1 && m.retriesPerCheck.traceability.failures === 1, "retries per check computed", JSON.stringify(m.retriesPerCheck));
  assert(m.redToGreenLatency.perCheck.traceability.avgMs === 300000, "red-to-green latency = 5m", JSON.stringify(m.redToGreenLatency));
  assert(m.waivers.total === 1 && m.waivers.ledgerEvents === 1, "waiver count from ledger", JSON.stringify(m.waivers));
  assert(m.claimDivergence.total === 1 && m.claimDivergence.unmetContracts === 1, "claim divergence from unmet acceptance contract", JSON.stringify(m.claimDivergence));
  assert(m.uncommittedWork && m.uncommittedWork.ageMs === 1200000, "uncommitted-work age = 20m trailing dirty streak", JSON.stringify(m.uncommittedWork));
  assert(m.corrections.total === 1 && m.corrections.open === 0, "corrections counted, none open", JSON.stringify(m.corrections));
  const md = readFileSync(join(dir, "docs", "qa", "process-health.md"), "utf8");
  assert(/Vacuous passes/.test(md) && /recordings/.test(md), "report lists the vacuous pass");
  const trend = m.warningTrendByClass;
  assert(trend.trace && trend["recordings-pending"], "per-class warning trend present", JSON.stringify(trend));
  const skel = readJson(join(dir, "docs", "qa", "process-defects.json"));
  assert(skel.defects.some((d) => d.class === "vacuous-pass" && d.severity === "P0"), "skeleton carries the vacuous-pass defect");
  // Ratchet contract (check-process-ratchet reads these at TOP LEVEL):
  assert(health.vacuousPasses === 1, "TOP-LEVEL vacuousPasses is a plain number", JSON.stringify(health.vacuousPasses));
  assert(
    health.acceptanceCoverage && health.acceptanceCoverage.covered === 1 && health.acceptanceCoverage.declared === 2,
    "TOP-LEVEL acceptanceCoverage computed from the contract join",
    JSON.stringify(health.acceptanceCoverage),
  );
  assert(health.warningsByClass && typeof health.warningsByClass === "object", "TOP-LEVEL warningsByClass present", JSON.stringify(health.warningsByClass));
}

// ---------------------------------------------------------------------------
console.log("\n[7] digest on empty pre-build dir: SKIP-pending, exit 0, skeleton still written");
{
  const dir = caseDir("digest-empty");
  const r = runNode(REPORT, [], dir);
  assert(r.status === 0, "exit code 0", `got ${r.status}\n${r.stdout}${r.stderr}`);
  assert(/^Result: SKIP-pending$/m.test(r.stdout), "Result: SKIP-pending (never PASS on emptiness)", r.stdout);
  const skel = readJson(join(dir, "docs", "qa", "process-defects.json"));
  assert(skel.source === "ledger-report-deterministic-fallback" && skel.defects.length === 0, "empty skeleton written");
}

// ---------------------------------------------------------------------------
console.log("\n[8] skeleton never clobbers an auditor-authored process-defects.json");
{
  const dir = join(base, "digest-noclobber");
  cpSync(join(FIXTURES, "green"), dir, { recursive: true });
  mkdirSync(join(dir, "docs", "qa"), { recursive: true });
  const auditor = { source: "process-auditor", defects: [{ id: "PD-1", class: "missing-check", severity: "P0" }] };
  writeFileSync(join(dir, "docs", "qa", "process-defects.json"), JSON.stringify(auditor, null, 2), "utf8");
  const r = runNode(REPORT, [], dir);
  assert(r.status === 0, "exit code 0");
  const after = readJson(join(dir, "docs", "qa", "process-defects.json"));
  assert(after.source === "process-auditor" && after.defects[0].id === "PD-1", "auditor file untouched", JSON.stringify(after));
  assert(/not overwriting a non-fallback file/.test(r.stdout), "digest says why it kept the file", r.stdout);
}

// ---------------------------------------------------------------------------
console.log("\n[9] ledger-report -> check-process-ratchet --update seam: the baseline is EARNABLE through the shipped pipeline");
{
  const dir = caseDir("digest-ratchet-seam");
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app", "page.tsx"), "export default function Page() { return null; }\n", "utf8");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "current-state.md"), "# Current State\n\n- **Current phase:** Phase 4\n", "utf8");
  mkdirSync(join(dir, "trace"), { recursive: true });
  writeFileSync(
    join(dir, "trace", "ledger.jsonl"),
    [
      JSON.stringify({ ts: "2026-07-03T10:00:00Z", event: "check-run", check: "traceability", exitCode: 0, scope_n: 3, warningsByClass: {} }),
      JSON.stringify({ ts: "2026-07-03T10:01:00Z", event: "battery-run", check: "qa-verify", exitCode: 0, scope_n: 8, warningsByClass: {} }),
    ].join("\n") + "\n",
    "utf8",
  );
  // The REAL auditor output shape (object map), not a hand-authored array.
  writeFileSync(
    join(dir, "trace", "acceptance-contracts.json"),
    JSON.stringify({ generatedBy: "scripts/check-acceptance-methods.mjs", mode: "artifact", productCode: true, contracts: { "FR-1": [{ method: "local-verifiable", mechanism: "npm:test", artifact: "tests/x.test.mjs", status: "artifact-ok" }] } }, null, 2),
    "utf8",
  );
  mkdirSync(join(dir, "quality"), { recursive: true });
  writeFileSync(join(dir, "quality", "telemetry.config.json"), JSON.stringify({ warningBudgets: { "*": { "0+": 5 } } }, null, 2), "utf8");

  const rep = runNode(REPORT, [], dir);
  assert(rep.status === 0 && /^Result: PASS/m.test(rep.stdout), "ledger-report PASSes on the seam tree", `exit ${rep.status}\n${rep.stdout}${rep.stderr}`);
  const health = readJson(join(dir, "trace", "process-health.json"));
  assert(health.vacuousPasses === 0 && health.acceptanceCoverage?.covered === 1 && health.acceptanceCoverage?.declared === 1, "digest wrote the ratchet contract fields", JSON.stringify({ v: health.vacuousPasses, c: health.acceptanceCoverage }));

  const upd = runNode(RATCHET, ["--update"], dir);
  assert(upd.status === 0, "check-process-ratchet --update exits 0 straight after ledger-report", `exit ${upd.status}\n${upd.stdout}${upd.stderr}`);
  assert(/baseline created: quality\/process-baseline\.json/.test(upd.stdout), "--update reports the baseline created", upd.stdout);
  assert(existsSync(join(dir, "quality", "process-baseline.json")), "quality/process-baseline.json written");
  const baseline = readJson(join(dir, "quality", "process-baseline.json"));
  assert(baseline.acceptanceCoverage?.covered === 1 && baseline.acceptanceCoverage?.declared === 1 && baseline.vacuousPasses === 0, "baseline carries the digest's evidence", JSON.stringify(baseline));

  const chk = runNode(RATCHET, [], dir);
  assert(chk.status === 0 && /^Result: PASS/m.test(chk.stdout), "ratchet check mode PASSes against the earned baseline", `exit ${chk.status}\n${chk.stdout}${chk.stderr}`);
}

// ---------------------------------------------------------------------------
try {
  rmSync(base, { recursive: true, force: true });
} catch { /* temp cleanup is best-effort on Windows */ }

console.log(`\nledger tests: ${checks} assertion(s), ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
