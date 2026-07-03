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
// DIRECTION GUARD: `--update` is tighten-only. A write that would LOWER any
// baseline dimension exits 1 unless an explicit waiver file under
// docs/qa/waivers/ names this check and the dimension:
//   docs/qa/waivers/<name>.json:
//   { "check": "eval-ratchet", "metrics": ["error-clarity"], "reason": "..." }
//
// Usage:
//   (run the eval-suite workflow first — it writes evals/results/latest.json)
//   node scripts/check-eval-ratchet.mjs           # compare (CI mode)
//   node scripts/check-eval-ratchet.mjs --update  # ratchet the baseline up
//
// Wire as: "check:eval": "node scripts/check-eval-ratchet.mjs"
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SUMMARY = "evals/results/latest.json";
const BASELINE = "quality/eval-baseline.json";
// LLM-judge scores are noisier than coverage percentages, so allow a wider
// band before a dip counts as a real regression. Tune per project.
const TOLERANCE = 1.0;
const WAIVER_DIR = "docs/qa/waivers";

// Dimensions explicitly waived for loosening: any docs/qa/waivers/*.json whose
// "check" matches and whose "metrics" (or "metric") names the dimension.
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
  // Graceful before the eval suite has ever run (early project / pre-baseline):
  // there is nothing to ratchet yet, so SKIP rather than fail the build.
  console.warn(`SKIP  ${SUMMARY} not found — no eval results yet (run the eval-suite workflow). Nothing to ratchet.`);
  console.log("Scope: 0 eval case(s)");
  console.log("Result: SKIP-pending");
  process.exit(0);
}
const summary = JSON.parse(readFileSync(SUMMARY, "utf8"));
const current = summary.dimensions ?? {};
// eval-suite writes { dimensions, cases: [...] } — scope is the case count.
const caseCount = Array.isArray(summary.cases) ? summary.cases.length : Object.keys(current).length;
console.log(`Scope: ${caseCount} eval case(s)`);
if (Object.keys(current).length === 0) {
  console.error(`FAIL  ${SUMMARY} has no "dimensions" scores — did the eval-suite aggregate step run?`);
  console.log("Result: FAIL");
  process.exit(1);
}

// A missing baseline is NEVER silently re-created by a compare run: deleting
// quality/eval-baseline.json before a run would otherwise mint a fresh, LOWER
// floor with exit 0 — the direction guard would only exist while the baseline
// file existed. Creation requires an explicit --update and is loud.
if (!process.argv.includes("--update") && !existsSync(BASELINE)) {
  console.warn(`WARN  ${BASELINE} not found — no committed baseline to ratchet against. Create it EXPLICITLY with --update (and commit + review the diff); a compare run never mints a baseline.`);
  console.log("Result: SKIP-pending");
  process.exit(0);
}

if (process.argv.includes("--update")) {
  const existed = existsSync(BASELINE);
  if (existed) {
    // Tighten-only direction guard: refuse any --update that lowers a
    // dimension (or drops one — union of keys) unless an explicit waiver
    // artifact names it. A ratchet may never be loosened silently.
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    let refused = false;
    const waived = waivedMetrics("eval-ratchet");
    for (const d of [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()) {
      const was = baseline[d] ?? 0;
      const now = current[d] ?? 0;
      if (now + TOLERANCE < was) {
        if (waived.has(d)) {
          console.warn(`WARN  ${d} loosened ${was} -> ${now} under an explicit waiver in ${WAIVER_DIR}/`);
        } else {
          console.error(`FAIL  eval ratchet: --update would LOWER ${d} ${was} -> ${now} — the ratchet is tighten-only`);
          refused = true;
        }
      }
    }
    if (refused) {
      console.error(`      To loosen intentionally, add a waiver file under ${WAIVER_DIR}/ naming the dimension, e.g.`);
      console.error(`      ${WAIVER_DIR}/loosen-eval.json: {"check":"eval-ratchet","metrics":["<dimension>"],"reason":"..."}`);
      console.log("Result: FAIL");
      process.exit(1);
    }
  }
  mkdirSync("quality", { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  if (!existed) console.warn(`WARN  baseline created from current values — commit ${BASELINE} and review the diff (the floor is whatever scores exist right now)`);
  console.log(`baseline ${existed ? "updated" : "created"}: ${JSON.stringify(current)}`);
  console.log("Result: PASS");
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
console.log(`Result: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
