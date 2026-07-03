// Lesson fixture runner — done-claims-need-evidence.
// Proves the pattern executably: strong completion language in
// docs/current-state.md must sit on the same line as a resolvable evidence
// pointer (a path that exists on disk). Red (naked "Convergence reached" /
// "verification-only" / "Overall result: Pass") must fail; green (claim +
// existing docs/qa artifact) must pass.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const CLAIM_RE =
  /convergence reached|verification-only|overall result:\s*pass|all (?:gates|checks|surfaces)[^.\n]*(?:pass|green|match)|ready for (?:release|sign-?off)|work is (?:done|complete)/i;
const POINTER_RE = /(?:docs|evals|trace)\/[A-Za-z0-9_./-]+/g;

function claimCheck(root) {
  const file = join(root, "docs", "current-state.md");
  const unbacked = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!CLAIM_RE.test(line)) return;
    const pointers = [...line.matchAll(POINTER_RE)].map((m) => m[0].replace(/[).,;:]+$/, ""));
    const backed = pointers.some((p) => existsSync(join(root, p)));
    if (!backed) unbacked.push(`line ${i + 1}: "${line.trim()}" carries no resolvable evidence pointer`);
  });
  return unbacked;
}

let bad = 0;
const expect = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`);
  else {
    bad += 1;
    console.error(`FAIL  ${name} — ${detail}`);
  }
};

const red = claimCheck(join(here, "fixtures", "red"));
expect("red fixture: unbacked done-claims detected", red.length >= 2, `expected >=2 findings, got ${JSON.stringify(red)}`);
const green = claimCheck(join(here, "fixtures", "green"));
expect("green fixture: claim backed by existing evidence file", green.length === 0, JSON.stringify(green));

console.log("\nScope: 2 fixture(s)");
console.log(`Result: ${bad ? "FAIL" : "PASS"}`);
process.exit(bad ? 1 : 0);
