// Browser-backed red-to-green proof for the parity harness against a SYNTHETIC
// fixture site served over node http (tests/fixtures/parity/*.html). It exercises
// the REAL capture + diff pipeline end-to-end on real served DOM:
//
//   1. SUITE VERDICT  — runs the actual scripts/check-parity-suite.reference.mjs
//      via child process (a real Playwright browser injected through the
//      CHECK_PARITY_ADAPTERS hook). reference-vs-green -> Result: PASS (L1 0
//      content, L3 overlay >= floor); reference-vs-red -> Result: FAIL (L1
//      content diff + L3 overlay below floor).
//   2. SUBTREE DIFF   — walkSubtree + pairSubtree + diffPair on #sec-hero:
//      green -> 0 unpaired / 0 paint; red -> unpaired (badge + retitled h1) +
//      a root background-color paint mismatch.
//   3. SWEEP BANDS    — captureGeom across a width grid on #sec-features:
//      green -> 0 divergence bands; red (stacks below 900px) -> a band at the
//      narrow widths.
//
// Playwright/pngjs/pixelmatch are resolved normally OR via PARITY_DEPS_DIR (a
// directory containing node_modules). If none is resolvable this test SKIPs with
// exit 0 (a fresh public clone has no browser) — the pure-logic red-green proof in
// tests/parity-core.test.mjs always runs regardless. To run this proof:
//   PARITY_DEPS_DIR=/path/to/project/with/node_modules node tests/parity-e2e.test.mjs
//
// Run: node tests/parity-e2e.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const LIB = join(ROOT, "scripts", "lib", "parity-capture.reference.mjs");
const SUITE = join(ROOT, "scripts", "check-parity-suite.reference.mjs");
const FIXTURES = join(HERE, "fixtures", "parity");

const lib = await import(pathToFileURL(LIB).href);
const { gotoWithRetry, preparePage, walkSubtree, pairSubtree, diffPair, captureGeom, seriesForBlock, computeBands, validateConfig, loadDep, PAINT_KEYS, DEFAULT_FLOORS } = lib;

// --- resolve a browser (normal node_modules, or PARITY_DEPS_DIR fallback) ---
let chromium = null;
try {
  const pw = await loadDep("playwright");
  chromium = pw.chromium ?? pw.default?.chromium;
} catch {
  console.log("SKIP  parity-e2e: playwright not resolvable (set PARITY_DEPS_DIR to a dir with node_modules, or `npm i -D playwright pixelmatch pngjs && npx playwright install chromium`).");
  console.log("Result: SKIP");
  process.exit(0);
}

let passed = 0;
const failed = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok    ${name}`);
  } catch (err) {
    failed.push(name);
    console.error(`FAIL  ${name}\n      ${String(err.message).split("\n").join("\n      ")}`);
  }
}

// --- fixture server -------------------------------------------------------
const PAGES = {
  "/reference": readFileSync(join(FIXTURES, "reference.html")),
  "/green": readFileSync(join(FIXTURES, "local-green.html")),
  "/red": readFileSync(join(FIXTURES, "local-red.html")),
};
const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  const body = PAGES[path];
  if (!body) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// --- config for the direct-drive proofs (prepare knobs are empty/no-op) ---
const rawConfig = (localPath) => ({
  referenceUrl: `${base}/reference`,
  localUrl: `${base}${localPath}`,
  breakpoints: [
    { name: "768", width: 768, height: 1024 },
    { name: "1440", width: 1440, height: 900 },
  ],
  matrixBreakpoint: "1440",
  sections: [
    { id: "01-hero", label: "Hero", local: "#sec-hero", live: "#sec-hero" },
    { id: "02-features", label: "Features", local: "#sec-features", live: "#sec-features" },
    { id: "03-footer", label: "Footer", local: "#sec-footer", live: "#sec-footer" },
  ],
  elements: [{ key: "hero-heading", section: "01-hero", pick: "heading", index: 0, role: "heading" }],
  hover: [],
  behaviors: [],
});
const { config: cfg } = validateConfig(rawConfig("/green"));

const browser = await chromium.launch({ headless: true });
async function loadPage(url, width, height, role) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await gotoWithRetry(page, url, { retries: 1, timeout: 30000 });
  await preparePage(page, cfg, { role });
  return { ctx, page };
}

try {
  // =========================== 2. SUBTREE DIFF ============================
  await test("SUBTREE GREEN: reference vs green #sec-hero -> 0 unpaired, 0 paint/geometry", async () => {
    const ref = await loadPage(`${base}/reference`, 1440, 900, "reference");
    const loc = await loadPage(`${base}/green`, 1440, 900, "local");
    try {
      const refTree = await walkSubtree(ref.page, "#sec-hero", PAINT_KEYS);
      const locTree = await walkSubtree(loc.page, "#sec-hero", PAINT_KEYS);
      const { pairs, unpairedRef, unpairedLocal } = pairSubtree(refTree.nodes, locTree.nodes);
      assert.equal(unpairedRef.length, 0, `unpaired ref: ${JSON.stringify(unpairedRef.map((n) => n.key))}`);
      assert.equal(unpairedLocal.length, 0, `unpaired local: ${JSON.stringify(unpairedLocal.map((n) => n.key))}`);
      const diffs = pairs.flatMap((p) => diffPair(p.ref, p.local, DEFAULT_FLOORS));
      assert.deepEqual(diffs, [], `expected no diffs, got ${JSON.stringify(diffs.map((d) => `${d.prop}:${d.ref}->${d.local}`))}`);
    } finally {
      await ref.ctx.close();
      await loc.ctx.close();
    }
  });

  await test("SUBTREE RED: reference vs red #sec-hero -> unpaired badge + retitled h1, root bg paint mismatch", async () => {
    const ref = await loadPage(`${base}/reference`, 1440, 900, "reference");
    const loc = await loadPage(`${base}/red`, 1440, 900, "local");
    try {
      const refTree = await walkSubtree(ref.page, "#sec-hero", PAINT_KEYS);
      const locTree = await walkSubtree(loc.page, "#sec-hero", PAINT_KEYS);
      const { pairs, unpairedRef, unpairedLocal } = pairSubtree(refTree.nodes, locTree.nodes);
      assert.ok(unpairedLocal.some((n) => n.key.includes("NEW")), `expected the badge unpaired, got ${JSON.stringify(unpairedLocal.map((n) => n.key))}`);
      assert.ok(unpairedLocal.some((n) => n.text.includes("Hello There")), "expected the retitled h1 unpaired local");
      assert.ok(unpairedRef.some((n) => n.text.includes("Welcome Home")), "expected the original h1 unpaired ref");
      const diffs = pairs.flatMap((p) => diffPair(p.ref, p.local, DEFAULT_FLOORS));
      assert.ok(diffs.some((d) => d.kind === "paint" && d.prop === "backgroundColor"), `expected a root bg paint mismatch, got ${JSON.stringify(diffs.map((d) => d.prop))}`);
    } finally {
      await ref.ctx.close();
      await loc.ctx.close();
    }
  });

  // =========================== 3. SWEEP BANDS ============================
  const SWEEP_WIDTHS = [320, 480, 640, 800, 960, 1120, 1280, 1440];
  const SWEEP_STEP = 160;
  async function geomSeries(localPath) {
    const ref = await loadPage(`${base}/reference`, SWEEP_WIDTHS[SWEEP_WIDTHS.length - 1], 1000, "reference");
    const loc = await loadPage(`${base}${localPath}`, SWEEP_WIDTHS[SWEEP_WIDTHS.length - 1], 1000, "local");
    const refGeom = [];
    const locGeom = [];
    try {
      // capture downward (widest -> narrowest), then order ascending for bands.
      for (const w of [...SWEEP_WIDTHS].reverse()) {
        await ref.page.setViewportSize({ width: w, height: 1000 });
        await loc.page.setViewportSize({ width: w, height: 1000 });
        await lib.sweepSettle(ref.page);
        await lib.sweepSettle(loc.page);
        refGeom[SWEEP_WIDTHS.indexOf(w)] = await captureGeom(ref.page, "#sec-features");
        locGeom[SWEEP_WIDTHS.indexOf(w)] = await captureGeom(loc.page, "#sec-features");
      }
    } finally {
      await ref.ctx.close();
      await loc.ctx.close();
    }
    return computeBands(seriesForBlock(SWEEP_WIDTHS, refGeom, locGeom), SWEEP_STEP);
  }

  await test("SWEEP GREEN: reference vs green #sec-features -> 0 divergence bands", async () => {
    const { bands } = await geomSeries("/green");
    assert.equal(bands.length, 0, `expected 0 bands, got ${JSON.stringify(bands.map((b) => `${b.from}-${b.to}`))}`);
  });

  await test("SWEEP RED: reference vs red #sec-features stacks below 900px -> a narrow-width band", async () => {
    const { bands, baseline, threshold } = await geomSeries("/red");
    assert.ok(bands.length >= 1, `expected >=1 band, got ${JSON.stringify({ bands, baseline, threshold })}`);
    const covers = bands.some((b) => b.from <= 640 && b.to >= 640);
    assert.ok(covers, `a band should cover the narrow reflow zone (<=900px), got ${JSON.stringify(bands.map((b) => `${b.from}-${b.to}`))}`);
  });
} finally {
  await browser.close().catch(() => {});
}

// =========================== 1. SUITE VERDICT (child process) ============
// Inject a real browser through CHECK_PARITY_ADAPTERS so the actual suite script
// runs end-to-end against the served fixtures.
const work = mkdtempSync(join(tmpdir(), "parity-e2e-"));
const adapterPath = join(work, "adapter.mjs");
writeFileSync(
  adapterPath,
  `const lib = await import(${JSON.stringify(pathToFileURL(LIB).href)});\n` +
    `export async function launch() { const pw = await lib.loadDep("playwright"); const chromium = pw.chromium ?? pw.default?.chromium; return chromium.launch({ headless: true }); }\n`,
);

// IMPORTANT: async spawn (NOT spawnSync). The fixture server runs in THIS
// process's event loop; spawnSync would block it, deadlocking the child's HTTP
// requests to that server. Async spawn keeps the loop free to serve the child.
function runSuite(localPath, outSub) {
  // config + out are passed RELATIVE to the child cwd (the script resolves them
  // as join(cwd, path)); the adapter path is absolute (resolved from cwd too).
  const cfgRel = `config-${outSub}.json`;
  writeFileSync(join(work, cfgRel), JSON.stringify(rawConfig(localPath), null, 2));
  const env = { ...process.env, CHECK_PARITY_ADAPTERS: adapterPath };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SUITE, "--config", cfgRel, "--out", outSub], { cwd: work, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 300000);
    child.on("close", (code) => {
      clearTimeout(timer);
      let summary = null;
      try {
        summary = JSON.parse(readFileSync(join(work, outSub, "summary.json"), "utf8"));
      } catch {
        /* summary may be absent on hard failure */
      }
      resolve({ code, out, summary });
    });
  });
}

await test("SUITE GREEN: reference vs green -> exit 0, Result: PASS, L1 0 content, L3 overlay >= floor", async () => {
  const { code, out, summary } = await runSuite("/green", "green");
  assert.equal(code, 0, `expected exit 0, got ${code}\n${out}`);
  assert.ok(/Result: PASS/.test(out), `missing Result: PASS\n${out}`);
  assert.ok(summary, "summary.json must be written");
  assert.equal(summary.pass, true);
  assert.equal(summary.contentMismatches, 0);
  assert.ok(summary.layers.L3_overlay.minScore >= DEFAULT_FLOORS.sectionScoreFloor, `L3 min ${summary.layers.L3_overlay.minScore} should be >= floor`);
  assert.equal(summary.layers.L5_breakpoints.pass, true);
});

await test("SUITE RED: reference vs red -> exit 1, Result: FAIL, L1 content diff + L3 below floor", async () => {
  const { code, out, summary } = await runSuite("/red", "red");
  assert.equal(code, 1, `expected exit 1, got ${code}\n${out}`);
  assert.ok(/Result: FAIL/.test(out), `missing Result: FAIL\n${out}`);
  assert.ok(summary, "summary.json must be written even on failure (auditable)");
  assert.equal(summary.pass, false);
  assert.ok(summary.contentMismatches >= 1, `expected >=1 content mismatch (retitled hero h1), got ${summary.contentMismatches}`);
  assert.ok(summary.layers.L3_overlay.minScore < DEFAULT_FLOORS.sectionScoreFloor, `L3 min ${summary.layers.L3_overlay.minScore} should be below floor (tinted hero)`);
  assert.equal(summary.layers.L5_breakpoints.pass, false);
});

// cleanup
rmSync(work, { recursive: true, force: true });
await new Promise((resolve) => server.close(resolve));

console.log(`\nparity-e2e.test: ${passed} passed, ${failed.length} failed${failed.length ? ` (${failed.join(", ")})` : ""}`);
process.exit(failed.length ? 1 : 0);
