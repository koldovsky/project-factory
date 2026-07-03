// Red-to-green proof for scripts/check-visual-fidelity.reference.mjs.
//
// Plain Node (>= 18), zero dependencies, self-contained: exits non-zero when
// any assertion fails. Two layers:
//   1. unit tests of the exported pure decision core (validateConfig,
//      heightGate, evaluateScore, shapeReport, masksForPage);
//   2. child-process runs of the script against fixture project trees under
//      tests/fixtures/visual/, with fake capture/diff adapters injected via
//      CHECK_VISUAL_FIDELITY_ADAPTERS — so the proof runs without playwright:
//        red            -> exit 1 (height pre-gate +23.14%/+44.8% AND score 0.93 < 0.99)
//        green          -> exit 0, report.json {score:0.996, pass:true} + diff.png written
//        missing-config -> exit 1, NOT-EARNED with guidance (product code present)
//        deps-missing   -> exit 1 with install instructions (simulated absent playwright)
//        pre-phase      -> exit 0, explicit SKIP-pending (no product code yet)
//
// Run: node tests/visual.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "scripts", "check-visual-fidelity.reference.mjs");
const FIXTURES = join(HERE, "fixtures", "visual");

const { validateConfig, heightGate, evaluateScore, shapeReport, masksForPage, DEFAULTS } = await import(
  pathToFileURL(SCRIPT).href
);

let passed = 0;
const failed = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok    ${name}`);
  } catch (err) {
    failed.push(name);
    console.error(`FAIL  ${name}\n      ${err.message.split("\n").join("\n      ")}`);
  }
}

function runFixture(name, { adapters } = {}) {
  const cwd = join(FIXTURES, name);
  rmSync(join(cwd, "docs"), { recursive: true, force: true }); // generated artifacts, not fixture content
  const env = { ...process.env };
  delete env.CHECK_VISUAL_FIDELITY_ADAPTERS;
  if (adapters) env.CHECK_VISUAL_FIDELITY_ADAPTERS = adapters;
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, env, encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, cwd };
}

// ---------------------------------------------------------- 1. pure core

await test("validateConfig: applies defaults (threshold 0.99, settle, height gate)", () => {
  const { config, errors } = validateConfig({
    referenceUrl: "https://a.example/",
    localUrl: "http://localhost:3000/",
    breakpoints: [{ name: "desktop", width: 1440, height: 900 }],
  });
  assert.deepEqual(errors, []);
  assert.equal(config.threshold, 0.99);
  assert.equal(config.maxHeightDeltaPct, 2);
  assert.equal(config.settleMs, DEFAULTS.settleMs);
});

await test("validateConfig: rejects missing urls and empty breakpoints", () => {
  const { config, errors } = validateConfig({ breakpoints: [] });
  assert.equal(config, null);
  assert.ok(errors.some((e) => e.includes("referenceUrl")));
  assert.ok(errors.some((e) => e.includes("localUrl")));
  assert.ok(errors.some((e) => e.includes("breakpoints")));
});

await test("validateConfig: rejects duplicate/unsafe breakpoint names and bad masks", () => {
  const { errors } = validateConfig({
    referenceUrl: "https://a.example/",
    localUrl: "http://localhost:3000/",
    breakpoints: [
      { name: "a b", width: 100, height: 100 },
      { name: "x", width: 100, height: 100 },
      { name: "x", width: 200, height: 200 },
    ],
    masks: [{ page: "*", selectorOrRect: 42 }],
  });
  assert.ok(errors.some((e) => e.includes("[A-Za-z0-9._-]+")));
  assert.ok(errors.some((e) => e.includes("duplicated")));
  assert.ok(errors.some((e) => e.includes("selectorOrRect")));
});

await test("validateConfig: warns when threshold is loosened below 0.99", () => {
  const { warnings, errors } = validateConfig({
    referenceUrl: "https://a.example/",
    localUrl: "http://localhost:3000/",
    threshold: 0.9,
    breakpoints: [{ name: "d", width: 1, height: 1 }],
  });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("below the 0.99 default")));
});

await test("heightGate: the pixel-case desktop numbers (+23.14%) FAIL before diffing", () => {
  const g = heightGate(8275, 10190, 2);
  assert.equal(g.pass, false);
  assert.equal(g.deltaPct, 23.14);
  assert.ok(g.message.includes("pixel diff skipped"));
});

await test("heightGate: the pixel-case mobile numbers (+44.8%) FAIL", () => {
  const g = heightGate(13742, 19899, 2);
  assert.equal(g.pass, false);
  assert.equal(g.deltaPct, 44.8);
});

await test("heightGate: 1.5% delta passes, 0/negative heights never pass", () => {
  assert.equal(heightGate(1000, 1015, 2).pass, true);
  assert.equal(heightGate(0, 1000, 2).pass, false);
  assert.equal(heightGate(1000, 0, 2).pass, false);
});

await test("evaluateScore: 0.93 < 0.99 fails with message; 0.996 passes; exact threshold passes", () => {
  const bad = evaluateScore(0.93, 0.99);
  assert.equal(bad.pass, false);
  assert.ok(bad.message.includes("0.93"));
  assert.equal(evaluateScore(0.996, 0.99).pass, true);
  assert.equal(evaluateScore(0.99, 0.99).pass, true);
  assert.equal(evaluateScore(NaN, 0.99).pass, false);
});

await test("shapeReport: emits the contract keys {score, threshold, heightDelta, masked, pass}", () => {
  const r = shapeReport({ breakpoint: "desktop", score: 0.996, threshold: 0.99, heightDelta: 0, masked: 2, pass: true });
  for (const k of ["score", "threshold", "heightDelta", "masked", "pass"]) assert.ok(k in r, `missing key ${k}`);
  assert.equal(r.pass, true);
  const f = shapeReport({ breakpoint: "d", threshold: 0.99, pass: false, reason: "why" });
  assert.equal(f.score, null);
  assert.equal(f.pass, false);
  assert.equal(f.reason, "why");
});

await test("masksForPage: filters by page and splits selectors from rects", () => {
  const config = {
    masks: [
      { page: "*", selectorOrRect: ".cookie" },
      { page: "/other", selectorOrRect: ".nope" },
    ],
    dynamicRegions: [{ page: "/", selectorOrRect: { x: 0, y: 0, width: 10, height: 10 } }],
  };
  const { selectors, rects } = masksForPage(config, "https://a.example/");
  assert.deepEqual(selectors, [".cookie"]);
  assert.equal(rects.length, 1);
});

// ------------------------------------------- 2. child-process red -> green

await test("RED fixture: exit 1 — height pre-gate reds +23.14%/+44.8% AND score 0.93 reds tablet", () => {
  const { code, out, cwd } = runFixture("red", { adapters: "adapters.mjs" });
  assert.equal(code, 1, `expected exit 1, got ${code}\n${out}`);
  assert.ok(out.includes("page-height delta 23.14%"), `missing desktop height-gate message:\n${out}`);
  assert.ok(out.includes("page-height delta 44.8%"), `missing mobile height-gate message:\n${out}`);
  assert.ok(out.includes("pixel diff skipped"), `pre-gate must say the diff was skipped:\n${out}`);
  assert.ok(out.includes("pixel score 0.93 below threshold 0.99"), `missing tablet score failure:\n${out}`);
  assert.ok(out.includes("Scope: 3 breakpoint(s)"), `missing Scope line:\n${out}`);
  assert.ok(out.includes("Result: FAIL"), `missing Result: FAIL line:\n${out}`);
  // failing breakpoints still leave auditable reports
  const desktop = JSON.parse(readFileSync(join(cwd, "docs/qa/visual-diff/desktop/report.json"), "utf8"));
  assert.equal(desktop.pass, false);
  assert.equal(desktop.heightDelta, 23.14);
  assert.equal(desktop.score, null); // pre-gate fired before any pixel work
  const tablet = JSON.parse(readFileSync(join(cwd, "docs/qa/visual-diff/tablet/report.json"), "utf8"));
  assert.equal(tablet.pass, false);
  assert.equal(tablet.score, 0.93);
});

await test("GREEN fixture: exit 0 — matching heights, score 0.996, PASS report + diff.png written", () => {
  const { code, out, cwd } = runFixture("green", { adapters: "adapters.mjs" });
  assert.equal(code, 0, `expected exit 0, got ${code}\n${out}`);
  assert.ok(out.includes("Scope: 2 breakpoint(s)"), `missing Scope line:\n${out}`);
  assert.ok(/Result: PASS(\r?\n|$)/.test(out), `missing clean Result: PASS line:\n${out}`);
  for (const bp of ["desktop", "mobile"]) {
    const report = JSON.parse(readFileSync(join(cwd, `docs/qa/visual-diff/${bp}/report.json`), "utf8"));
    assert.equal(report.pass, true, `${bp} report must pass`);
    assert.equal(report.score, 0.996);
    assert.equal(report.threshold, 0.99);
    assert.equal(report.heightDelta, 0);
    assert.ok(existsSync(join(cwd, `docs/qa/visual-diff/${bp}/diff.png`)), `${bp} diff.png missing`);
  }
});

await test("MISSING CONFIG + product code: exit 1, NOT-EARNED with guidance (never a vacuous pass)", () => {
  const { code, out } = runFixture("missing-config");
  assert.equal(code, 1, `expected exit 1, got ${code}\n${out}`);
  assert.ok(out.includes("visual-parity.config.json not found"), `missing guidance:\n${out}`);
  assert.ok(out.includes("templates/quality/visual-parity.config.json"), `must point at the template:\n${out}`);
  assert.ok(out.includes("Result: NOT-EARNED"), `missing Result: NOT-EARNED line:\n${out}`);
});

await test("PLAYWRIGHT MISSING (simulated by injection): exit 1 with install instructions, not 0", () => {
  const { code, out } = runFixture("deps-missing", { adapters: "adapters.mjs" });
  assert.equal(code, 1, `expected exit 1, got ${code}\n${out}`);
  assert.ok(out.includes("npm i -D playwright"), `missing install instructions:\n${out}`);
  assert.ok(out.includes("Result: FAIL"), `missing Result: FAIL line:\n${out}`);
});

await test("PRE-PHASE (no config, no product code): explicit SKIP-pending, exit 0", () => {
  const { code, out } = runFixture("pre-phase");
  assert.equal(code, 0, `expected exit 0, got ${code}\n${out}`);
  assert.ok(out.includes("SKIP-pending"), `SKIP must be printed explicitly:\n${out}`);
  assert.ok(out.includes("Result: SKIP-pending"), `missing Result: SKIP-pending line:\n${out}`);
});

// cleanup generated artifacts so fixtures stay minimal in the tree
for (const f of ["red", "green", "deps-missing"]) rmSync(join(FIXTURES, f, "docs"), { recursive: true, force: true });

console.log(`\nvisual.test: ${passed} passed, ${failed.length} failed${failed.length ? ` (${failed.join(", ")})` : ""}`);
process.exit(failed.length ? 1 : 0);
