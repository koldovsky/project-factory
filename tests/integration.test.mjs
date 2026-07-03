// Executed red->green proof for the three-valued semantics integration
// (scripts/qa-verify.reference.mjs + scripts/gate-status.reference.mjs,
// reflection design mechanism 3 / implementation step 3).
//
// Plain Node (>= 18), zero deps, self-contained: deploys minimal fake project
// trees from tests/fixtures/integration/ into a temp dir (the scripts write
// reports/ledger files, so fixtures stay pristine), copies the qa-verify
// reference in as scripts/qa-verify.mjs and runs both scripts as child
// processes with cwd = the deployed tree (both resolve their root from
// process.cwd(), like every sibling check). Exits non-zero if any
// expectation fails.
//
//   red   — pixel-run shape: product code + 0-scope battery outputs + header
//           claiming Phase 4 / G6 + echo-stub npm scripts + an open
//           correction. qa-verify must exit 1 with an overall NOT-EARNED;
//           gate-status must exit 1 flagging DIVERGENCE + OPEN-CORRECTION.
//   green — healthy small project: real scopes, real (tiny) npm commands,
//           truthful header. qa-verify must print "Overall result: Pass" and
//           exit 0; gate-status must exit 0.
//
// Run: node tests/integration.test.mjs
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");
const FIX = join(here, "fixtures", "integration");
const QA_VERIFY_REF = join(REPO, "scripts", "qa-verify.reference.mjs");
const GATE_STATUS_REF = join(REPO, "scripts", "gate-status.reference.mjs");

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
function run(script, cwd) {
  const r = spawnSync(process.execPath, [script], { cwd, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
// Deploy a fixture the way init/onboard deploys the factory: fixture tree +
// the qa-verify reference copied in as scripts/qa-verify.mjs.
function deploy(fixture) {
  const dir = mkdtempSync(join(tmpdir(), `integration-${fixture}-`));
  cpSync(join(FIX, fixture), dir, { recursive: true });
  copyFileSync(QA_VERIFY_REF, join(dir, "scripts", "qa-verify.mjs"));
  return dir;
}

// ---------- red: the pixel-run shape must come out red ----------
{
  const dir = deploy("red");
  const qa = run(join(dir, "scripts", "qa-verify.mjs"), dir);
  check("red qa-verify exits 1", qa.code === 1, `exit ${qa.code}\n${qa.out}`);
  check(
    "red qa-verify overall is NOT-EARNED, never Pass",
    /Overall result: NOT-EARNED \(\d+ member\(s\) unearned\)/.test(qa.out) && !/Overall result: Pass/.test(qa.out),
    qa.out,
  );
  check(
    "red qa-verify flips a 0-scope member to NOT-EARNED",
    /NOT-EARNED traceability: emptiness \(scope-0\)/.test(qa.out),
    qa.out,
  );
  check(
    "red qa-verify catches the echo-stub npm script",
    /NOT-EARNED unit-tests: npm script "test:run" is a stub/.test(qa.out),
    qa.out,
  );
  check(
    "red qa-verify renders the missing member explicitly",
    /MISSING db-integration-tests: npm script "test:integration"/.test(qa.out),
    qa.out,
  );

  const gs = run(GATE_STATUS_REF, dir);
  check("red gate-status exits 1", gs.code === 1, `exit ${gs.code}\n${gs.out}`);
  check("red gate-status flags header divergence", /DIVERGENCE: docs\/current-state\.md claims/.test(gs.out), gs.out);
  check("red gate-status renders G4+ as NOT-EARNED", /G6\s+NOT-EARNED/.test(gs.out) && /G7\s+NOT-EARNED/.test(gs.out), gs.out);
  check("red gate-status shows the open correction", /OPEN-CORRECTION COR-1/.test(gs.out), gs.out);
  check("red gate-status keeps the done-claim grep advisory", /ADVISORY \(not enforced\)/.test(gs.out), gs.out);
  check("red gate-status final Result is FAIL", /^Result: FAIL/m.test(gs.out), gs.out);
  rmSync(dir, { recursive: true, force: true });
}

// ---------- red: deleting a node-script honesty check post-phase = NOT-EARNED, never a tolerated MISSING ----------
{
  const dir = deploy("red");
  rmSync(join(dir, "scripts", "check-acceptance-methods.mjs"));
  const qa = run(join(dir, "scripts", "qa-verify.mjs"), dir);
  check("missing node member over product code exits 1", qa.code === 1, `exit ${qa.code}\n${qa.out}`);
  check(
    "missing node member renders NOT-EARNED (not MISSING)",
    /NOT-EARNED acceptance-artifacts: scripts\/check-acceptance-methods\.mjs is not installed/.test(qa.out) &&
      !/MISSING acceptance-artifacts/.test(qa.out),
    qa.out,
  );
  check("overall stays NOT-EARNED, never Pass", /Overall result: NOT-EARNED/.test(qa.out) && !/Overall result: Pass/.test(qa.out), qa.out);
  rmSync(dir, { recursive: true, force: true });
}

// ---------- red: the pixel run's ACTUAL field header format must trigger the phase divergence ----------
{
  const dir = deploy("red");
  writeFileSync(
    join(dir, "docs", "current-state.md"),
    "# Current state & handoff notes\n\n_Last updated: 2026-06-25 — Phase: **4 — front page built to pixel-perfect state, verification passes ongoing**_\n\n- Convergence reached — all surfaces now match the live site.\n",
    "utf8",
  );
  const gs = run(GATE_STATUS_REF, dir);
  check("field-format header exits 1", gs.code === 1, `exit ${gs.code}\n${gs.out}`);
  check(
    "field-format 'Phase: **4' header fires the claims-Phase-4 divergence",
    /DIVERGENCE: docs\/current-state\.md claims "Current phase: Phase 4" but gates G0–G3 are not all earned/.test(gs.out),
    gs.out,
  );
  rmSync(dir, { recursive: true, force: true });
}

// ---------- red: a waiver file with no correction artifact = UNRECORDED-CORRECTION at gate-status ----------
// (before this, a waiver silently laundered acceptance failures past every
// gate summary from G3 to G6 — correct.mjs --check only ran at G7)
{
  const dir = deploy("green");
  mkdirSync(join(dir, "docs", "qa", "waivers"), { recursive: true });
  writeFileSync(join(dir, "docs", "qa", "waivers", "nfr-19-visual.md"), "# Waiver: NFR-19\n\nVisual evidence waived for this milestone.\n", "utf8");
  const gs = run(GATE_STATUS_REF, dir);
  check("waiver without correction artifact exits 1", gs.code === 1, `exit ${gs.code}\n${gs.out}`);
  check(
    "gate-status prints a red UNRECORDED-CORRECTION line naming the waiver",
    /UNRECORDED-CORRECTION waiver-created \(docs\/qa\/waivers\/nfr-19-visual\.md\)/.test(gs.out),
    gs.out,
  );
  check("final Result is FAIL over the unrecorded correction", /^Result: FAIL/m.test(gs.out), gs.out);
  rmSync(dir, { recursive: true, force: true });
}

// ---------- green: a healthy project must stay green (false-positive check) ----------
{
  const dir = deploy("green");
  const qa = run(join(dir, "scripts", "qa-verify.mjs"), dir);
  check("green qa-verify exits 0", qa.code === 0, `exit ${qa.code}\n${qa.out}`);
  check("green qa-verify overall is Pass", /Overall result: Pass/.test(qa.out), qa.out);
  check(
    "green qa-verify has no NOT-EARNED members",
    !/^NOT-EARNED /m.test(qa.out) && !/Overall result: NOT-EARNED/.test(qa.out),
    qa.out,
  );
  check(
    "green qa-verify still names uninstalled members (explicit, not silent)",
    /MISSING db-integration-tests/.test(qa.out) && /MISSING openspec-all/.test(qa.out),
    qa.out,
  );

  const gs = run(GATE_STATUS_REF, dir);
  check("green gate-status exits 0", gs.code === 0, `exit ${gs.code}\n${gs.out}`);
  check("green gate-status final Result is PASS", /^Result: PASS/m.test(gs.out), gs.out);
  check("green gate-status has no divergence or open corrections", !/DIVERGENCE/.test(gs.out) && !/OPEN-CORRECTION/.test(gs.out), gs.out);
  check("green gate-status executes the strict G7 commands (label = invocation)", /G7\s+PASS.*--release --strict-tests --strict-recordings/.test(gs.out), gs.out);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nintegration.test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
