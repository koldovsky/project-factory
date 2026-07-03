// Self-contained red→green proof for scripts/correct.reference.mjs
// (mechanism 4 — correction intake + auto-correction detectors).
//
// Run:  node tests/correct.test.mjs      (exits non-zero on any failure)
//
// Covers:
//   - --check on the red fixture (waiver + UAT-bug-vs-G6, no correction
//     artifacts) exits non-zero with the expected messages
//   - --check on the green fixture (dispositioned correction, no events)
//     exits 0
//   - intake writes a schema-valid artifact with append-only numbering
//   - invalid input is rejected (exit 1)
//   - detectAutoCorrections finds the waiver + UAT events in the red tree
//   - --detect appends exactly one correction per event, idempotently,
//     and --check then reds on the OPEN (undispositioned) corrections
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const SCRIPT = join(repo, "scripts", "correct.reference.mjs");
const FIX = join(here, "fixtures", "correct");
const RED = join(FIX, "red");
const GREEN = join(FIX, "green");

let count = 0;
let failed = 0;
function check(name, cond, extra = "") {
  count += 1;
  if (cond) console.log(`ok ${count} - ${name}`);
  else {
    failed += 1;
    console.error(`not ok ${count} - ${name}${extra ? `\n  # ${String(extra).split("\n").join("\n  # ")}` : ""}`);
  }
}
function run(cwd, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// --- 1. RED fixture: --check must exit non-zero with actionable messages.
{
  const r = run(RED, ["--check"]);
  check("red fixture: --check exits non-zero", r.code !== 0, r.out);
  check("red fixture: names the waiver event", /waiver-created.*WVR-001\.md.*no correction artifact/.test(r.out), r.out);
  check("red fixture: names the UAT-vs-gate event", /uat-bug-vs-gate.*UAT-BUG-001\.md/.test(r.out), r.out);
  check("red fixture: prints Scope line", /^Scope: 2 correction signal\(s\)$/m.test(r.out), r.out);
  check("red fixture: prints Result: FAIL", /^Result: FAIL \(2\)$/m.test(r.out), r.out);
}

// --- 2. GREEN fixture: --check must exit 0.
{
  const r = run(GREEN, ["--check"]);
  check("green fixture: --check exits 0", r.code === 0, r.out);
  check("green fixture: prints Scope line", /^Scope: 1 correction signal\(s\)$/m.test(r.out), r.out);
  check("green fixture: prints Result: PASS", /^Result: PASS$/m.test(r.out), r.out);
  check("green fixture: gate-less UAT note is not an event", !/UAT-NOTE-001/.test(r.out), r.out);
}

// --- Sandboxes (fixtures stay pristine).
const tmp = mkdtempSync(join(tmpdir(), "correct-test-"));
const sboxIntake = join(tmp, "intake");
const sboxDetect = join(tmp, "detect");
cpSync(GREEN, sboxIntake, { recursive: true });
cpSync(RED, sboxDetect, { recursive: true });

try {
  // --- 3. Intake writes a valid artifact with append-only numbering.
  {
    const r = run(sboxIntake, ["this is not pixel perfect!", "--claim", "docs/current-state.md:85", "--req", "FR-70,NFR-19", "--gate", "G6"]);
    check("intake: exits 0", r.code === 0, r.out);
    check("intake: prints Scope + Result: PASS", /^Scope: 1 utterance\(s\)$/m.test(r.out) && /^Result: PASS$/m.test(r.out), r.out);
    check("intake: prints OPEN-CORRECTION notice", /OPEN-CORRECTION COR-2/.test(r.out), r.out);
    const file = join(sboxIntake, "retro", "corrections", "002-this-is-not-pixel-perfect.correction.json");
    check("intake: append-only numbering continues at 002", existsSync(file), readdirSync(join(sboxIntake, "retro", "corrections")).join(", "));
    const rec = JSON.parse(readFileSync(file, "utf8"));
    check("intake: id is COR-2", rec.id === "COR-2", JSON.stringify(rec));
    check("intake: ts is ISO-8601", !Number.isNaN(Date.parse(rec.ts)), rec.ts);
    check("intake: utterance recorded verbatim", rec.utterance === "this is not pixel perfect!");
    check("intake: contradictedClaim mapped", rec.contradictedClaim === "docs/current-state.md:85");
    check("intake: mappedReqIds mapped", JSON.stringify(rec.mappedReqIds) === JSON.stringify(["FR-70", "NFR-19"]));
    check("intake: gateThatShouldHaveCaught mapped", rec.gateThatShouldHaveCaught === "G6");
    check("intake: heuristic failureMode defaults to wrong-claim", rec.failureMode === "wrong-claim" && rec.failureModeSource === "heuristic");
    check("intake: disposition is null at intake", rec.disposition === null);
    check("intake: source is human, autoKey null", rec.source === "human" && rec.autoKey === null);

    // validate the written artifact against the AUTHORED schema file
    const mod = await import(pathToFileURL(SCRIPT).href);
    const schema = JSON.parse(readFileSync(join(repo, "templates", "retro", "correction.schema.json"), "utf8"));
    const errors = mod.validateAgainstSchema(rec, schema);
    check("intake: artifact validates against templates/retro/correction.schema.json", errors.length === 0, errors.join("; "));

    // second intake: numbering advances, first file untouched
    const r2 = run(sboxIntake, ["gate passed over zero clips", "--failure-mode", "vacuous-pass"]);
    check("intake #2: exits 0", r2.code === 0, r2.out);
    const files = readdirSync(join(sboxIntake, "retro", "corrections")).sort();
    check("intake #2: three files, append-only (001..003)", files.length === 3 && files[2].startsWith("003-"), files.join(", "));
    const rec3 = JSON.parse(readFileSync(join(sboxIntake, "retro", "corrections", files[2]), "utf8"));
    check("intake #2: explicit --failure-mode wins over heuristic", rec3.failureMode === "vacuous-pass" && rec3.failureModeSource === "explicit");
    check("intake #2: earlier artifact unchanged", JSON.parse(readFileSync(file, "utf8")).id === "COR-2");
  }

  // --- 4. Invalid input rejected (exit 1, Result: FAIL).
  {
    const cases = [
      [[], "missing utterance"],
      [["   "], "blank utterance"],
      [["late again", "--failure-mode", "bogus"], "bad --failure-mode"],
      [["late again", "--req", "FRX-1"], "bad --req id"],
      [["late again", "--gate", "G9"], "bad --gate"],
      [["late again", "--claim", "no-line-number"], "bad --claim"],
      [["two", "utterances"], "extra positional arg"],
      [["late again", "--frobnicate"], "unknown flag"],
    ];
    for (const [args, label] of cases) {
      const r = run(sboxIntake, args);
      check(`invalid input rejected: ${label}`, r.code === 1 && /^Result: FAIL$/m.test(r.out), r.out);
    }
    check("invalid input left no new artifacts", readdirSync(join(sboxIntake, "retro", "corrections")).length === 3);
  }

  // --- 5. detectAutoCorrections finds the waiver + UAT events in the red tree.
  {
    const mod = await import(pathToFileURL(SCRIPT).href);
    const events = mod.detectAutoCorrections(RED);
    check("detector: finds exactly 2 events in red fixture", events.length === 2, JSON.stringify(events, null, 2));
    const waiver = events.find((e) => e.type === "waiver-created");
    const uat = events.find((e) => e.type === "uat-bug-vs-gate");
    check("detector: waiver event points at the waiver file", waiver?.path === "docs/qa/waivers/WVR-001.md", JSON.stringify(waiver));
    check("detector: UAT event carries the mentioned gate id", uat?.path === "docs/qa/uat/UAT-BUG-001.md" && uat?.gateIds.includes("G6"), JSON.stringify(uat));
    check("detector: green tree yields no waiver/uat events", mod.detectAutoCorrections(GREEN).length === 0);
  }

  // --- 6. --detect appends one correction per event, idempotently.
  {
    const r = run(sboxDetect, ["--detect"]);
    check("--detect: exits 0", r.code === 0, r.out);
    const dir = join(sboxDetect, "retro", "corrections");
    const files = existsSync(dir) ? readdirSync(dir).sort() : [];
    check("--detect: appended 2 correction artifacts", files.length === 2, files.join(", "));
    const recs = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
    check("--detect: sources are auto-waiver + auto-uat-bug", recs.some((x) => x.source === "auto-waiver") && recs.some((x) => x.source === "auto-uat-bug"), JSON.stringify(recs));
    check("--detect: UAT correction blames G6", recs.find((x) => x.source === "auto-uat-bug")?.gateThatShouldHaveCaught === "G6");
    const r2 = run(sboxDetect, ["--detect"]);
    check("--detect: idempotent (no duplicates on re-run)", r2.code === 0 && readdirSync(dir).length === 2, r2.out);
    // now everything is recorded but undispositioned → --check reds with OPEN-CORRECTION
    const r3 = run(sboxDetect, ["--check"]);
    check("--check after --detect: exits non-zero on OPEN corrections", r3.code !== 0, r3.out);
    check("--check after --detect: prints OPEN-CORRECTION lines", (r3.out.match(/OPEN-CORRECTION COR-\d+/g) ?? []).length === 2, r3.out);
    check("--check after --detect: events are no longer 'unrecorded'", !/no correction artifact/.test(r3.out), r3.out);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\ncorrect.test: ${count} assertion(s), ${failed} failure(s)`);
process.exit(failed ? 1 : 0);
