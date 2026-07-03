// Git commit-msg hook — enforce trace trailers so every commit is linkable.
//
// Rule: a commit that touches feature code (app/, lib/, db/, src/) must carry
// at least one trace reference — either a `Refs:` trailer with FR/NFR/BUG ids
// or a `Slice:` trailer naming the OpenSpec change. Docs/test/chore commits
// are exempt. This makes `git log --grep "FR-24"` a complete audit trail.
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Fail-open process-health telemetry (reflection design, mechanism 1): append
// a hook-run event with the final exit code to trace/ledger.jsonl. Ledger
// errors are swallowed — telemetry must NEVER block a commit.
process.on("exit", (code) => {
  try {
    if (!existsSync("scripts/ledger.mjs")) return;
    spawnSync(
      process.execPath,
      ["scripts/ledger.mjs", "emit", JSON.stringify({ event: "hook-run", check: "commit-msg", exitCode: code ?? 0 })],
      { stdio: "ignore" },
    );
  } catch {
    /* fail-open */
  }
});

const msgFile = process.argv[2];
const msg = readFileSync(msgFile, "utf8");

const staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const touchesFeatureCode = staged.some((f) => /^(app|lib|db|src)\//.test(f) && !/\.(test|spec)\./.test(f));

if (!touchesFeatureCode) process.exit(0);

// Ids may be plain (FR-12) or categorized (FR-SHELL-01, NFR-A11Y-02).
const hasRefs = /^Refs:\s*((FR|NFR|TC|BC|BUG)-(?:[A-Z0-9]+-)?\d+)(,\s*(FR|NFR|TC|BC|BUG)-(?:[A-Z0-9]+-)?\d+)*\s*$/m.test(msg);
const hasSlice = /^Slice:\s*[a-z0-9-]+\s*$/m.test(msg);

if (!hasRefs && !hasSlice) {
  console.error(
    [
      "commit-msg: this commit touches feature code but has no trace trailer.",
      "Add one (or both) of these lines to the commit message body:",
      "  Slice: add-<capability>",
      "  Refs: FR-12, FR-13",
      "(Use Refs: BUG-<n> for UAT bug fixes.)",
    ].join("\n"),
  );
  process.exit(1);
}
process.exit(0);
