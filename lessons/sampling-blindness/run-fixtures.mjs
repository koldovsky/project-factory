// Lesson fixture runner — sampling-blindness.
//
// Proves the pattern executably. The distilled rule has two teeth:
//
//   SHAPE   — a check that samples a CONTINUOUS dimension must (a) declare its
//             `samplingDimension`, (b) declare an `escalation` to a stricter
//             instrument, and (c) NOT advertise `coverage:"continuum"` (or a
//             "100% / all widths" claim) while enumerating only discrete
//             `samples`. Verified samples are never presented as continuum
//             coverage.
//   PROOF   — given the declared sample points, the runner shows that a real
//             divergence BETWEEN samples goes undetected by the matrix (the
//             red candidate diverges only at 1200px, which the 5-width sample
//             set never probes), whereas the green candidate holds across the
//             continuum AND its report declares the escalation path that would
//             have caught such a residual.
//
// Grounded (abstractly) in the multi-layer visual-parity campaign
// (docs/field-reports/2026-07-02-pixel-perfect-forensics.md and its follow-on
// parity work): three documented occurrences of the same blindness — the
// element matrix (a fixed element set stood in for every element), the width
// matrix (five calibrated widths stood in for the width continuum), and the
// geometry-only sweep (a geometry channel read 0 divergence bands while the
// pixel distribution it could not see carried 100+ below-floor residuals).
//
// Browser-free and deterministic: per-width parity scores are read from the
// subject pages' `data-widths` attribute.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLOSED_CLAIM = /\b(continuum|100\s*%|all\s+widths|full\s+coverage|every\s+width)\b/i;

function parseWidths(html) {
  const m = html.match(/data-widths="([^"]+)"/);
  const map = {};
  if (m) for (const pair of m[1].split(",")) {
    const [w, s] = pair.split(":");
    map[Number(w)] = Number(s);
  }
  return map;
}

// The distilled audit. Returns { verdict: "GREEN"|"RED", reasons: [...] }.
function samplingAudit(dir) {
  const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  const refW = parseWidths(readFileSync(join(here, "fixtures", "reference.html"), "utf8"));
  const candW = parseWidths(readFileSync(join(dir, "candidate.html"), "utf8"));
  const floor = report.floor ?? 0.985;
  const samples = new Set((report.samples ?? []).map(Number));
  const reasons = [];

  // SHAPE checks.
  if (!report.samplingDimension) reasons.push("no samplingDimension declared");
  if (!report.escalation || !report.escalation.instrument) reasons.push("no stricter-instrument escalation path declared");
  const overclaims = CLOSED_CLAIM.test(String(report.coverage ?? "")) || CLOSED_CLAIM.test(String(report.claim ?? ""));
  if (overclaims && report.coverage !== "sampled") reasons.push(`presents ${report.samples?.length ?? 0} samples as continuum coverage (coverage/claim overclaims)`);

  // PROOF: does a between-sample divergence exist that the sample set misses?
  const continuumBad = Object.entries(candW).filter(([w, s]) => s < floor).map(([w]) => Number(w));
  const sampledBad = continuumBad.filter((w) => samples.has(w));
  const missed = continuumBad.filter((w) => !samples.has(w));
  if (missed.length && sampledBad.length === 0)
    reasons.push(`below-floor divergence at unsampled width(s) [${missed.join(", ")}] the sample set never probes (sampling blind)`);

  return { verdict: reasons.length ? "RED" : "GREEN", reasons, missed, continuumBad };
}

let bad = 0;
const red = samplingAudit(join(here, "fixtures", "red"));
if (red.verdict === "RED" && red.missed.includes(1200)) {
  console.log(`ok    red fixture: ${red.verdict} — ${red.reasons.join("; ")}`);
} else {
  bad += 1;
  console.error(`FAIL  red fixture expected RED with a missed 1200px divergence, got ${red.verdict} (${red.reasons.join("; ") || "no reasons"})`);
}
const green = samplingAudit(join(here, "fixtures", "green"));
if (green.verdict === "GREEN") {
  console.log(`ok    green fixture: GREEN — declares samplingDimension + escalation, no continuum overclaim, parity holds`);
} else {
  bad += 1;
  console.error(`FAIL  green fixture expected GREEN, got ${green.verdict} (${green.reasons.join("; ")})`);
}

console.log("\nScope: 2 fixture(s)");
console.log(`Result: ${bad ? "FAIL" : "PASS"}`);
process.exit(bad ? 1 : 0);
