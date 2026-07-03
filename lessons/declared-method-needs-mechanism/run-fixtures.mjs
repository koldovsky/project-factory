// Lesson fixture runner — declared-method-needs-mechanism.
// Proves the pattern executably, twice over:
//   1. A distilled existence-mode check: every `verification: <method>` tag
//      declared in docs/requirements.md must resolve to a real, non-stub
//      mechanism. Red (pixel-diff declared, no tool; echo-stub e2e) must
//      fail; green (real check script + real e2e runner) must pass.
//   2. The sibling scripts/check-factory-integrity.reference.mjs stub scan,
//      run as a child process against both fixtures: red must exit 1 on the
//      echo-stub battery script, green must exit 0.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const INTEGRITY = join(here, "..", "..", "scripts", "check-factory-integrity.reference.mjs");
const STUB_RE = /^echo |^true$|not yet configured/i;

// method -> is a mechanism installed in this fixture tree?
const MECHANISMS = {
  "pixel-diff": (root) =>
    existsSync(join(root, "scripts")) &&
    readdirSync(join(root, "scripts")).some((f) => /^check-(visual|pixel)/.test(f)),
  e2e: (root) => {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      const body = pkg.scripts?.["test:e2e"];
      return typeof body === "string" && !STUB_RE.test(body.trim());
    } catch {
      return false;
    }
  },
};

function existenceCheck(root) {
  const req = readFileSync(join(root, "docs", "requirements.md"), "utf8");
  const missing = [];
  const blocks = req.split(/^## /m).slice(1);
  for (const block of blocks) {
    const id = block.split(/\s/)[0];
    for (const m of block.matchAll(/verification:\s*([a-z0-9-]+)/gi)) {
      const method = m[1].toLowerCase();
      const resolver = MECHANISMS[method];
      if (!resolver || !resolver(root)) missing.push(`${id} declares "${method}" with no executable mechanism`);
    }
  }
  return missing;
}

let bad = 0;
const expect = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`);
  else {
    bad += 1;
    console.error(`FAIL  ${name} — ${detail}`);
  }
};

const redRoot = join(here, "fixtures", "red");
const greenRoot = join(here, "fixtures", "green");

const redMissing = existenceCheck(redRoot);
expect(
  "red fixture: existence mode reds on phantom methods",
  redMissing.length >= 2 && redMissing.some((m) => m.startsWith("NFR-19")),
  `expected NFR-19 + FR-70 findings, got: ${JSON.stringify(redMissing)}`,
);
const greenMissing = existenceCheck(greenRoot);
expect("green fixture: every declared method resolves", greenMissing.length === 0, JSON.stringify(greenMissing));

// Sibling-script proof: the integrity check's stub scan.
const runIntegrity = (cwd) => spawnSync(process.execPath, [INTEGRITY], { cwd, encoding: "utf8" });
const ri = runIntegrity(redRoot);
expect(
  "red fixture: check-factory-integrity stub scan exits 1",
  ri.status === 1 && /stub/.test(ri.stdout + ri.stderr),
  `exit ${ri.status}: ${(ri.stdout + ri.stderr).trim()}`,
);
const gi = runIntegrity(greenRoot);
expect(
  "green fixture: check-factory-integrity exits 0 (SKIP-pending, no stubs)",
  gi.status === 0 && /Result: SKIP-pending/.test(gi.stdout),
  `exit ${gi.status}: ${(gi.stdout + gi.stderr).trim()}`,
);

console.log("\nScope: 2 fixture(s)");
console.log(`Result: ${bad ? "FAIL" : "PASS"}`);
process.exit(bad ? 1 : 0);
