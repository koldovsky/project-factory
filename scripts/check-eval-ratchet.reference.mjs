// REFERENCE IMPLEMENTATION — eval ratchet (graded quality can only go up).
//
// Sibling of check-coverage-ratchet.mjs. Compares the latest eval scores
// (per dimension) against a committed baseline. Drops FAIL the build;
// improvements update the baseline (commit the bump). A "ratchet": the loop
// may tighten the quality bar, never loosen it silently.
//
// The LLM judging happens in the `eval-suite` workflow (a fresh judge agent,
// maker≠checker), which writes evals/results/latest.json. THIS script does no
// judging — it only guards the committed score, so it runs in CI with no API
// key, keeping "gates are commands with exit codes" intact.
//
// Usage:
//   (run the eval-suite workflow first — it writes evals/results/latest.json)
//   node scripts/check-eval-ratchet.mjs           # compare (CI mode)
//   node scripts/check-eval-ratchet.mjs --update  # ratchet the baseline up
//
// Wire as: "check:eval": "node scripts/check-eval-ratchet.mjs"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const SUMMARY = "evals/results/latest.json";
const BASELINE = "quality/eval-baseline.json";
// LLM-judge scores are noisier than coverage percentages, so allow a wider
// band before a dip counts as a real regression. Tune per project.
const TOLERANCE = 1.0;

if (!existsSync(SUMMARY)) {
  // Graceful before the eval suite has ever run (early project / pre-baseline):
  // there is nothing to ratchet yet, so SKIP rather than fail the build.
  console.warn(`SKIP  ${SUMMARY} not found — no eval results yet (run the eval-suite workflow). Nothing to ratchet.`);
  process.exit(0);
}
const summary = JSON.parse(readFileSync(SUMMARY, "utf8"));
const current = summary.dimensions ?? {};
if (Object.keys(current).length === 0) {
  console.error(`FAIL  ${SUMMARY} has no "dimensions" scores — did the eval-suite aggregate step run?`);
  process.exit(1);
}

if (process.argv.includes("--update") || !existsSync(BASELINE)) {
  const existed = existsSync(BASELINE);
  mkdirSync("quality", { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`baseline ${existed ? "updated" : "created"}: ${JSON.stringify(current)}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
// Union of dimensions: a baseline dimension missing from the current run means
// its cases were dropped — that is a regression, not a free pass.
const dimensions = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort();
let failed = false;
for (const d of dimensions) {
  const was = baseline[d] ?? 0;
  const now = current[d] ?? 0;
  if (now + TOLERANCE < was) {
    console.error(`FAIL  eval ratchet: ${d} dropped ${was} -> ${now}`);
    failed = true;
  } else if (now > was + TOLERANCE) {
    console.log(`INFO  ${d} improved ${was} -> ${now} — run with --update to ratchet the baseline`);
  } else {
    console.log(`OK    ${d} ${now} (baseline ${was})`);
  }
}
process.exit(failed ? 1 : 0);
