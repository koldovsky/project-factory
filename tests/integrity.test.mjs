// Self-contained red-to-green proof for check-factory-integrity.reference.mjs
// and the seeded lessons library. Plain Node, no framework; exits non-zero on
// any failed assertion. Fixture trees are copied into the OS temp dir so runs
// never mutate the committed fixtures and sit outside any git repo (making
// "no Refs: PD- commit found" deterministic).
//
// Run: node tests/integrity.test.mjs
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const SCRIPT = join(root, "scripts", "check-factory-integrity.reference.mjs");
const FIX = join(here, "fixtures", "integrity");
const LESSON_IDS = ["vacuous-pass-not-earned", "declared-method-needs-mechanism", "done-claims-need-evidence"];

let failed = 0;
let n = 0;
function check(name, cond, detail = "") {
  n += 1;
  if (cond) console.log(`ok ${n} - ${name}`);
  else {
    failed += 1;
    console.error(`not ok ${n} - ${name}${detail ? `\n  ---\n  ${detail.split("\n").join("\n  ")}\n  ---` : ""}`);
  }
}

function run(cwd, file, args = []) {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const runIntegrity = (cwd, args = []) => run(cwd, SCRIPT, args);

const tempDirs = [];
function copyFix(which) {
  const d = mkdtempSync(join(tmpdir(), "pf-integrity-"));
  tempDirs.push(d);
  cpSync(join(FIX, which), d, { recursive: true });
  return d;
}

try {
  // 1. Lock roundtrip: --init-lock then a clean verify PASS.
  const g1 = copyFix("green");
  const init = runIntegrity(g1, ["--init-lock"]);
  check("init-lock exits 0", init.code === 0, init.out);
  check("init-lock writes factory-lock.json", existsSync(join(g1, "factory-lock.json")));
  check("init-lock prints Scope line", /^Scope: \d+ locked file\(s\)$/m.test(init.out), init.out);
  const clean = runIntegrity(g1);
  check("clean verify exits 0", clean.code === 0, clean.out);
  check("clean verify prints Result: PASS", /^Result: PASS/m.test(clean.out), clean.out);

  // 2. Tamper a gate-bearing file without a Refs: PD- commit => hard FAIL.
  appendFileSync(join(g1, "scripts", "check-traceability.mjs"), "\n// tampered: weakened check\n");
  const tampered = runIntegrity(g1);
  check("gate-bearing tamper exits 1", tampered.code === 1, tampered.out);
  check(
    "tamper failure names the file and the missing Refs: PD- commit",
    /check-traceability\.mjs/.test(tampered.out) && /Refs:\s*PD-/.test(tampered.out),
    tampered.out,
  );

  // 3. Workflow-file drift => WARN + still PASS (exit 0), never FAIL — and the
  //    drift EVENT actually lands in the ledger (the CLI's only write command
  //    is "emit"; a wrong verb would warn-and-drop silently under
  //    stdio:"ignore", turning fail-open telemetry into fail-silent-and-lost).
  const g2 = copyFix("green");
  copyFileSync(join(root, "scripts", "ledger.reference.mjs"), join(g2, "scripts", "ledger.mjs"));
  runIntegrity(g2, ["--init-lock"]);
  appendFileSync(join(g2, ".claude", "workflows", "build-feature.md"), "\nforked step (Workflow-args bug workaround)\n");
  const wf = runIntegrity(g2);
  check("workflow drift exits 0", wf.code === 0, wf.out);
  check(
    "workflow drift is a WARN naming the file",
    /WARN\s+\[\.claude\/workflows\/build-feature\.md\]/.test(wf.out),
    wf.out,
  );
  check("workflow drift result is PASS with warnings", /^Result: PASS, \d+ warning\(s\)$/m.test(wf.out), wf.out);
  const ledgerPath = join(g2, "trace", "ledger.jsonl");
  check("workflow drift emitted a ledger event", existsSync(ledgerPath), "trace/ledger.jsonl was never written — the drift event was dropped");
  check(
    "ledger event is integrity-workflow-drift naming the file",
    existsSync(ledgerPath) && /"event":\s*"integrity-workflow-drift"/.test(readFileSync(ledgerPath, "utf8")) && /build-feature\.md/.test(readFileSync(ledgerPath, "utf8")),
    existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "(no ledger file)",
  );

  // 4. Deleting a locked gate-bearing file => FAIL.
  rmSync(join(g2, "scripts", "gate-status.mjs"));
  const del = runIntegrity(g2);
  check("deleted gate script exits 1", del.code === 1, del.out);
  check("deletion failure says MISSING", /gate-status\.mjs/.test(del.out) && /MISSING/.test(del.out), del.out);

  // 5. Echo-stub scan: red fixture (test:e2e = echo stub) => FAIL.
  const r1 = copyFix("red");
  runIntegrity(r1, ["--init-lock"]);
  const stub = runIntegrity(r1);
  check("stub fixture exits 1", stub.code === 1, stub.out);
  check(
    "stub failure names test:e2e and the stub body",
    /test:e2e/.test(stub.out) && /stub/.test(stub.out) && /not yet configured/.test(stub.out),
    stub.out,
  );
  check("stub fixture result line is FAIL", /^Result: FAIL/m.test(stub.out), stub.out);

  // 6. No lock + product code => NOT-EARNED (exit 1), never PASS.
  const g3 = copyFix("green");
  const notEarned = runIntegrity(g3);
  check("missing lock with product code exits 1", notEarned.code === 1, notEarned.out);
  check("missing lock renders NOT-EARNED", /^Result: NOT-EARNED/m.test(notEarned.out), notEarned.out);

  // 7. No lock + no product code => SKIP-pending printed explicitly, exit 0.
  const g4 = copyFix("green");
  rmSync(join(g4, "app"), { recursive: true, force: true });
  const skip = runIntegrity(g4);
  check("pre-phase emptiness exits 0", skip.code === 0, skip.out);
  check("pre-phase emptiness renders SKIP-pending", /^Result: SKIP-pending/m.test(skip.out), skip.out);
  check("SKIP-pending is explained, not silent", /SKIP-pending: no factory-lock\.json yet/.test(skip.out), skip.out);

  // 8. Every seeded lesson's red/green fixture proof executes and passes.
  for (const id of LESSON_IDS) {
    const runner = join(root, "lessons", id, "run-fixtures.mjs");
    const res = run(root, runner);
    check(`lesson ${id}: run-fixtures exits 0`, res.code === 0, res.out);
    check(`lesson ${id}: prints Result: PASS`, /^Result: PASS$/m.test(res.out), res.out);
  }
} finally {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

console.log(`\n${n - failed}/${n} assertions passed`);
process.exit(failed ? 1 : 0);
