// REFERENCE IMPLEMENTATION — coverage ratchet (quality can only go up).
//
// Compares the current Vitest coverage summary against a committed baseline.
// Drops FAIL the build; improvements update the baseline (commit the bump).
// This is a "ratchet": the loop is allowed to tighten the constraint, never
// to loosen it silently.
//
// Usage:
//   npm run test:coverage          # produces coverage/coverage-summary.json
//   node scripts/check-coverage-ratchet.mjs           # compare (CI mode)
//   node scripts/check-coverage-ratchet.mjs --update  # ratchet the baseline up
//
// Wire as: "check:coverage": "node scripts/check-coverage-ratchet.mjs"
// Requires vitest coverage reporter "json-summary" in vitest.config.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SUMMARY = "coverage/coverage-summary.json";
const BASELINE = "quality/coverage-baseline.json";
const METRICS = ["lines", "statements", "functions", "branches"];
const TOLERANCE = 0.1; // percentage points of float noise allowed

if (!existsSync(SUMMARY)) {
  // Graceful before coverage has ever been generated (pre-baseline): SKIP, don't fail.
  console.warn(`SKIP  ${SUMMARY} not found — no coverage yet (run \`npm run test:coverage\`). Nothing to ratchet.`);
  process.exit(0);
}
const total = JSON.parse(readFileSync(SUMMARY, "utf8")).total;
const current = Object.fromEntries(METRICS.map((m) => [m, total[m].pct]));

if (process.argv.includes("--update") || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`baseline ${existsSync(BASELINE) ? "updated" : "created"}: ${JSON.stringify(current)}`);
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
process.exit(failed ? 1 : 0);
