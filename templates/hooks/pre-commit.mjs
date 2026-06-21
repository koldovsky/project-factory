// Git pre-commit hook (deterministic inner loop) — install per hooks/README.md.
// Fast, staged-scope checks only; the full battery runs at gates and in CI.
//
//   1. block committing real env files / obvious secrets
//   2. ESLint on staged JS/TS files
//   3. tsc --noEmit (whole project, but incremental and fast)
//   4. traceability validator (fast, pure file parsing)
import { execSync } from "node:child_process";

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
const capture = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

const staged = capture("git diff --cached --name-only --diff-filter=ACM")
  .split("\n")
  .filter(Boolean);

// 1 — secret hygiene
const envViolations = staged.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".example"));
if (envViolations.length) {
  console.error(`pre-commit: refusing to commit env file(s): ${envViolations.join(", ")}`);
  process.exit(1);
}
const SECRET_PATTERNS = [
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  /\b(sk|rk|re|ghp|gho|xox[bap])_[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /postgres(ql)?:\/\/[^\s'"]+:[^\s'"]+@/,
];
for (const file of staged) {
  if (/\.(png|webm|jpg|jpeg|gif|pdf|ico|woff2?)$/.test(file)) continue;
  let content = "";
  try {
    content = capture(`git show :"${file}"`);
  } catch {
    continue;
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      console.error(`pre-commit: possible secret in ${file} (pattern ${pattern}). Use env vars; bypass only with an explicit allowlist edit to this hook.`);
      process.exit(1);
    }
  }
}

// 2 — lint staged sources
const lintable = staged.filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));
if (lintable.length) {
  run(`npx eslint ${lintable.map((f) => `"${f}"`).join(" ")}`);
}

// 3 — typecheck
run("npx tsc --noEmit");

// 4 — traceability (fails on broken FR chain / archived-but-unchecked tasks).
// The validator regenerates the report + trace graph; stage them so the
// commit always contains the fresh versions (otherwise the worktree is left
// dirty and CI --check-fresh fails on staleness).
run("node scripts/check-traceability.mjs");
run('git add docs/qa/traceability-report.md trace/trace.json');

// 5 — trajectory (process audit: review evidence, Slice: trailers, scope).
// Warns only by default, so it won't block a commit; regenerates + stages its
// report so CI --check-fresh stays green.
run("node scripts/check-trajectory.mjs");
run('git add docs/qa/trajectory-report.md trace/trajectory.json');

console.log("pre-commit: all deterministic checks passed");
