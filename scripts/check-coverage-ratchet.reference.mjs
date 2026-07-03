// REFERENCE IMPLEMENTATION — coverage ratchet (quality can only go up).
//
// Compares the current Vitest coverage summary against a committed baseline.
// Drops FAIL the build; improvements update the baseline (commit the bump).
// This is a "ratchet": the loop is allowed to tighten the constraint, never
// to loosen it silently.
//
// DIRECTION GUARD: `--update` is tighten-only. A write that would LOWER any
// baseline metric exits 1 unless an explicit waiver file under
// docs/qa/waivers/ names this check and the metric:
//   docs/qa/waivers/<name>.json:
//   { "check": "coverage-ratchet", "metrics": ["lines"], "reason": "..." }
//
// Usage:
//   npm run test:coverage          # produces coverage/coverage-summary.json
//   node scripts/check-coverage-ratchet.mjs           # compare (CI mode)
//   node scripts/check-coverage-ratchet.mjs --update  # ratchet the baseline up
//
// Wire as: "check:coverage": "node scripts/check-coverage-ratchet.mjs"
// Requires vitest coverage reporter "json-summary" in vitest.config.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SUMMARY = "coverage/coverage-summary.json";
const BASELINE = "quality/coverage-baseline.json";
const METRICS = ["lines", "statements", "functions", "branches"];
const TOLERANCE = 0.1; // percentage points of float noise allowed
const WAIVER_DIR = "docs/qa/waivers";

// Metrics explicitly waived for loosening: any docs/qa/waivers/*.json whose
// "check" matches and whose "metrics" (or "metric") names the metric.
function waivedMetrics(check) {
  const waived = new Set();
  if (!existsSync(WAIVER_DIR)) return waived;
  for (const f of readdirSync(WAIVER_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const w = JSON.parse(readFileSync(join(WAIVER_DIR, f), "utf8"));
      if (w.check !== check) continue;
      for (const m of [].concat(w.metrics ?? w.metric ?? [])) waived.add(m);
    } catch {
      /* unparseable file is not a valid waiver — ignore */
    }
  }
  return waived;
}

if (!existsSync(SUMMARY)) {
  // Graceful before coverage has ever been generated (pre-baseline): SKIP, don't fail.
  console.warn(`SKIP  ${SUMMARY} not found — no coverage yet (run \`npm run test:coverage\`). Nothing to ratchet.`);
  console.log("Scope: 0 coverage metric(s)");
  console.log("Result: SKIP-pending");
  process.exit(0);
}
const total = JSON.parse(readFileSync(SUMMARY, "utf8")).total;
const current = Object.fromEntries(METRICS.map((m) => [m, total[m].pct]));
console.log(`Scope: ${METRICS.length} coverage metric(s)`);

// A missing baseline is NEVER silently re-created by a compare run: deleting
// quality/coverage-baseline.json before a run would otherwise mint a fresh,
// LOWER floor with exit 0 — the direction guard would only exist while the
// baseline file existed. Creation requires an explicit --update and is loud.
if (!process.argv.includes("--update") && !existsSync(BASELINE)) {
  console.warn(`WARN  ${BASELINE} not found — no committed baseline to ratchet against. Create it EXPLICITLY with --update (and commit + review the diff); a compare run never mints a baseline.`);
  console.log("Result: SKIP-pending");
  process.exit(0);
}

if (process.argv.includes("--update")) {
  const existed = existsSync(BASELINE);
  if (existed) {
    // Tighten-only direction guard: refuse any --update that lowers a metric
    // unless an explicit waiver artifact names it. A ratchet may never be
    // loosened silently (LOOP.md's "quality can only go up").
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    let refused = false;
    const waived = waivedMetrics("coverage-ratchet");
    for (const m of METRICS) {
      const was = baseline[m] ?? 0;
      const now = current[m] ?? 0;
      if (now + TOLERANCE < was) {
        if (waived.has(m)) {
          console.warn(`WARN  ${m} loosened ${was}% -> ${now}% under an explicit waiver in ${WAIVER_DIR}/`);
        } else {
          console.error(`FAIL  coverage ratchet: --update would LOWER ${m} ${was}% -> ${now}% — the ratchet is tighten-only`);
          refused = true;
        }
      }
    }
    if (refused) {
      console.error(`      To loosen intentionally, add a waiver file under ${WAIVER_DIR}/ naming the metric, e.g.`);
      console.error(`      ${WAIVER_DIR}/loosen-coverage.json: {"check":"coverage-ratchet","metrics":["<metric>"],"reason":"..."}`);
      console.log("Result: FAIL");
      process.exit(1);
    }
  }
  mkdirSync("quality", { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  if (!existed) console.warn(`WARN  baseline created from current values — commit ${BASELINE} and review the diff (the floor is whatever coverage exists right now)`);
  console.log(`baseline ${existed ? "updated" : "created"}: ${JSON.stringify(current)}`);
  console.log("Result: PASS");
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
let failed = false;
for (const m of METRICS) {
  const was = baseline[m] ?? 0;
  const now = current[m] ?? 0;
  if (now + TOLERANCE < was) {
    console.error(`FAIL  coverage ratchet: ${m} dropped ${was}% -> ${now}%`);
    failed = true;
  } else if (now > was + TOLERANCE) {
    console.log(`INFO  ${m} improved ${was}% -> ${now}% — run with --update to ratchet the baseline`);
  } else {
    console.log(`OK    ${m} ${now}% (baseline ${was}%)`);
  }
}
console.log(`Result: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
