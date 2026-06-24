// REFERENCE IMPLEMENTATION — gate status summary (truly satisfied vs pending/retrofit).
//
// Runs the DETERMINISTIC half of each gate (the exit-coded `check-*` commands)
// and prints a G0–G8 summary: PASS / FAIL / SKIP per check, so it's clear which
// gates are actually green vs. pending or retrofitted. Judgment criteria
// (human sign-offs, review verdicts) sit ON TOP and are noted, not auto-checked.
//
// Retrofit honesty: if `.project-factory/retrofit.json` exists (written by
// onboard), its slices are flagged — historical red-first evidence for legacy
// code cannot be reconstructed, so those gates are "retrofit", not "earned".
//
// Run: `node scripts/gate-status.mjs`  (tool-agnostic — pure Node).
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const has = (rel) => existsSync(rel);
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  // A check that prints SKIP (e.g. ratchets pre-baseline) is reported as SKIP.
  if (/^SKIP\b/m.test(out) || /\bNothing to ratchet\b/.test(out)) return { status: "SKIP", out };
  return { status: (r.status ?? 1) === 0 ? "PASS" : "FAIL", out };
}
const scriptExists = (n) => has(`scripts/${n}.mjs`);
const check = (n, args = []) => (scriptExists(n) ? run("node", [`scripts/${n}.mjs`, ...args]) : { status: "n/a", out: `scripts/${n}.mjs not installed` });

// Deterministic checks that back the gates.
const checks = {
  traceability: check("check-traceability"),
  trajectory: check("check-trajectory"),
  recordings: check("check-recordings"),
  coverage: check("check-coverage-ratchet"),
  evals: check("check-eval-ratchet"),
};

// Gate → which deterministic checks back it (judgment criteria sit on top).
const GATES = [
  ["G0", "scaffold + loop installed", () => (has("scripts/check-traceability.mjs") && has(".githooks") ? "PASS" : "FAIL")],
  ["G1", "requirements signed off", () => (has("docs/requirements.md") ? "needs sign-off" : "FAIL")],
  ["G2", "baseline specs", () => checks.traceability.status],
  ["G3", "capability plan signed off", () => (has("docs/mvp-capability-plan.md") ? "needs sign-off" : "FAIL")],
  ["G4", "per-slice (trace + trajectory)", () => worst(checks.traceability.status, checks.trajectory.status)],
  ["G5", "hardening (coverage)", () => checks.coverage.status],
  ["G6", "QA proof (recordings + evals)", () => worst(checks.recordings.status, checks.evals.status)],
  ["G7", "release (trace --release + recordings)", () => worst(checks.traceability.status, checks.recordings.status)],
  ["G8", "UAT (trace regressions)", () => checks.traceability.status],
];
function worst(...s) {
  if (s.includes("FAIL")) return "FAIL";
  if (s.includes("needs sign-off")) return "needs sign-off";
  if (s.every((x) => x === "SKIP" || x === "n/a")) return "SKIP";
  return "PASS";
}

let retrofit = null;
if (has(".project-factory/retrofit.json")) {
  try {
    retrofit = JSON.parse(readFileSync(".project-factory/retrofit.json", "utf8"));
  } catch {}
}

console.log("Gate status (deterministic checks — judgment criteria sit on top, verify those by hand):\n");
for (const [g, label, fn] of GATES) console.log(`  ${g}  ${String(fn()).padEnd(14)} ${label}`);
console.log("\nDeterministic checks:");
for (const [k, v] of Object.entries(checks)) console.log(`  ${k.padEnd(13)} ${v.status}`);
if (retrofit?.slices?.length) {
  console.log(`\n⚠ RETROFIT MODE: ${retrofit.slices.length} slice(s) onboarded from existing code — their gate evidence is RETROFITTED, not earned red-first:`);
  console.log(`  ${retrofit.slices.join(", ")}`);
  console.log("  Historical red-first slice history cannot be reconstructed for legacy code; treat as documented baseline, not proof of process.");
}
console.log("\n(Reviews, sign-offs, and vision-verify are judgment gates — confirm them in docs/qa + the gate checklist.)");
const anyFail = Object.values(checks).some((c) => c.status === "FAIL");
process.exit(anyFail ? 1 : 0);
