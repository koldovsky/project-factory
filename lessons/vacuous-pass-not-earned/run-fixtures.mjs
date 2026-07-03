// Lesson fixture runner — vacuous-pass-not-earned.
// Proves the pattern executably: the red fixture (product code + ZERO
// evidence) must come out NOT-EARNED (exit 1); the green fixture (product
// code + a real, asserted recording artifact) must PASS (exit 0).
// The tiny check below is the distilled vacuity rule from the reflection
// design (mechanism 3): post-phase emptiness = NOT-EARNED, pre-phase
// emptiness = SKIP-pending, never a silent PASS.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

function hasProductCode(root) {
  const exts = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|vue|svelte)$/i;
  for (const d of ["app", "src", "lib", "server", "packages"]) {
    for (const f of walk(join(root, d))) if (exts.test(f)) return true;
  }
  return false;
}

// The distilled check: count REAL evidence artifacts (manifest results whose
// video file exists, is non-empty, and is asserted), then apply the
// three-valued rule.
function vacuityCheck(root) {
  const productCode = hasProductCode(root);
  let scope = 0;
  let broken = 0;
  for (const mf of walk(join(root, "docs", "qa"))) {
    if (!mf.endsWith("manifest.json")) continue;
    const data = JSON.parse(readFileSync(mf, "utf8"));
    for (const r of data.results ?? []) {
      const v = r.video ? join(root, r.video) : null;
      if (v && existsSync(v) && statSync(v).size > 0 && r.asserted === true) scope += 1;
      else broken += 1;
    }
  }
  if (broken > 0) return { result: "FAIL", code: 1, scope };
  if (scope === 0 && productCode) return { result: "NOT-EARNED", code: 1, scope };
  if (scope === 0) return { result: "SKIP-pending", code: 0, scope };
  return { result: "PASS", code: 0, scope };
}

let bad = 0;
const red = vacuityCheck(join(here, "fixtures", "red"));
if (red.code === 1 && red.result === "NOT-EARNED") {
  console.log(`ok    red fixture: scope ${red.scope} + product code => ${red.result} (exit 1)`);
} else {
  bad += 1;
  console.error(`FAIL  red fixture expected NOT-EARNED/exit 1, got ${red.result}/exit ${red.code}`);
}
const green = vacuityCheck(join(here, "fixtures", "green"));
if (green.code === 0 && green.result === "PASS") {
  console.log(`ok    green fixture: scope ${green.scope} real artifact(s) => PASS (exit 0)`);
} else {
  bad += 1;
  console.error(`FAIL  green fixture expected PASS/exit 0, got ${green.result}/exit ${green.code}`);
}

console.log("\nScope: 2 fixture(s)");
console.log(`Result: ${bad ? "FAIL" : "PASS"}`);
process.exit(bad ? 1 : 0);
