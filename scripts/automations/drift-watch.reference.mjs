// Tier-0 automation: drift & hygiene watch. NO LLM, costs nothing.
// Wraps the framework's existing exit-coded checks + a little fs hygiene and
// prints a findings payload (JSON) to stdout for run.mjs to surface. A check
// whose prerequisites don't exist yet is SKIPPED (info), never a false red, so
// this is safe to run at any project maturity.
//
// Copy to scripts/automations/drift-watch.mjs.
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const STALE_DAYS = Number(process.env.HANDOFF_STALE_DAYS ?? 14);
const findings = [];
const add = (level, check, detail) => findings.push({ level, check, detail });
const has = (rel) => existsSync(join(root, rel));
const firstLine = (s) => (s || "").split("\n").find((l) => l.trim()) ?? "";
function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
  return { exit: r.status ?? 1, out: ((r.stdout || "") + (r.stderr || "")).trim() };
}

// 1. Traceability freshness (the committed report must match the code state).
if (has("scripts/check-traceability.mjs")) {
  const { exit, out } = sh("node", ["scripts/check-traceability.mjs", "--check-fresh"]);
  if (exit !== 0) add("red", "trace-fresh", firstLine(out) || "traceability report stale or failing");
} else add("info", "trace-fresh", "skipped (scripts/check-traceability.mjs not present)");

// 2. Coverage ratchet — only if coverage was generated this run.
if (has("scripts/check-coverage-ratchet.mjs") && has("quality/coverage-baseline.json") && has("coverage/coverage-summary.json")) {
  const { exit, out } = sh("node", ["scripts/check-coverage-ratchet.mjs"]);
  if (exit !== 0) add("red", "coverage-ratchet", firstLine(out));
} else add("info", "coverage-ratchet", "skipped (no fresh coverage/baseline)");

// 3. Eval ratchet — only if the eval suite produced results.
if (has("scripts/check-eval-ratchet.mjs") && has("quality/eval-baseline.json") && has("evals/results/latest.json")) {
  const { exit, out } = sh("node", ["scripts/check-eval-ratchet.mjs"]);
  if (exit !== 0) add("red", "eval-ratchet", firstLine(out));
} else add("info", "eval-ratchet", "skipped (no eval results/baseline)");

// 4. OpenSpec hygiene.
const changesDir = join(root, "openspec/changes");
if (existsSync(changesDir)) {
  const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
  const active = readdirSync(changesDir).filter((e) => e !== "archive" && isDir(join(changesDir, e)));
  if (active.length) add("warn", "openspec-active", `unarchived change(s): ${active.join(", ")}`);
  const archive = join(changesDir, "archive");
  if (existsSync(archive)) {
    for (const change of readdirSync(archive)) {
      const t = join(archive, change, "tasks.md");
      if (existsSync(t)) {
        const n = (readFileSync(t, "utf8").match(/^\s*-\s*\[\s\]/gm) ?? []).length;
        if (n) add("red", "openspec-archived-tasks", `${change}: ${n} unchecked task(s) but archived`);
      }
    }
  }
}

// 5. Handoff staleness.
if (has("docs/current-state.md")) {
  const ageDays = (Date.now() - statSync(join(root, "docs/current-state.md")).mtimeMs) / 86400000;
  if (ageDays > STALE_DAYS) add("warn", "handoff-stale", `docs/current-state.md not updated in ${Math.round(ageDays)} day(s)`);
} else add("info", "handoff", "docs/current-state.md not present yet");

const red = findings.some((f) => f.level === "red");
process.stdout.write(JSON.stringify({ id: "drift-watch", title: "Drift & hygiene watch", ok: true, red, findings }));
process.exit(0);
