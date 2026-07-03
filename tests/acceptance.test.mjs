// Red→green proof for scripts/check-acceptance-methods.reference.mjs.
//
// Plain Node, self-contained, exits non-zero on any failed assertion.
// Runs the auditor as a child process against two fixture project trees:
//   tests/fixtures/acceptance/red    — the pixel-perfect forensics case in
//     miniature: NFR-19 declares pixel-diff + vision-verify (">= 99% pixel
//     match"), FR-70 declares e2e, test:e2e is an echo stub, playwright is
//     absent, no acceptance artifacts exist, product code exists.
//   tests/fixtures/acceptance/green  — same contract with a real script,
//     playwright in devDependencies, and fresh threshold-passing artifacts.
// Both --mode=existence and --mode=artifact are exercised on both fixtures,
// plus one waiver-visibility case (WAIVED must be printed, never silent).
//
// Run: node tests/acceptance.test.mjs
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "scripts", "check-acceptance-methods.reference.mjs");
const FIXTURES = join(here, "fixtures", "acceptance");

let failed = 0;
let n = 0;
function check(name, cond, detail = "") {
  n += 1;
  if (cond) console.log(`ok ${n} - ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${n} - ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const tmps = [];
function runIn(fixture, args, mutate) {
  const tmp = mkdtempSync(join(tmpdir(), "acceptance-fixture-"));
  tmps.push(tmp);
  cpSync(join(FIXTURES, fixture), tmp, { recursive: true });
  if (mutate) mutate(tmp);
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: tmp, encoding: "utf8" });
  return { tmp, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ---------- 1. existence mode, red fixture: must go RED ----------
{
  const { tmp, status, out } = runIn("red", ["--mode=existence"]);
  check("existence/red exits 1", status === 1, `exit=${status}\n${out}`);
  check("existence/red prints Scope line", /^Scope: 2 tagged requirement\(s\)/m.test(out), out);
  check("existence/red prints Result: FAIL", /^Result: FAIL/m.test(out), out);
  check("existence/red names the echo stub", /echo stub/i.test(out) && /test:e2e/.test(out), out);
  check("existence/red unconditional battery stub scan flags test:e2e", /FAIL\s+\[scripts\.test:e2e\].*echo stub/.test(out), out);
  check("existence/red fails pixel-diff with no mechanism", /FAIL\s+\[NFR-19\].*pixel-diff.*no mechanism exists/.test(out), out);
  check("existence/red fails vision-verify with no mechanism", /FAIL\s+\[NFR-19\].*vision-verify.*no mechanism exists/.test(out), out);
  check("existence/red FAILS untagged MVP FR-1 (the G3 template rule — not a warning)", /FAIL\s+\[FR-1\].*untagged/.test(out), out);

  const draft = join(tmp, "trace", "missing-gate-candidates", "pixel-diff.md");
  check("existence/red drafts missing-gate candidate for pixel-diff", existsSync(draft));
  if (existsSync(draft)) {
    const d = readFileSync(draft, "utf8");
    check("draft carries threshold 0.99 parsed from requirement text", d.includes("0.99") && d.includes("parsed from requirement"), d);
    check("draft carries the reference URL from the spec", d.includes("https://approvedadmissions.example.com/"), d);
    check("draft carries breakpoints placeholder", /Breakpoints: TODO/.test(d), d);
    const urlLine = d.split("\n").find((l) => l.startsWith("- Reference URL:")) ?? "";
    check(
      "draft URL is deduped and stripped of trailing markdown junk",
      urlLine === "- Reference URL: https://approvedadmissions.example.com/",
      urlLine,
    );
  } else { n += 4; failed += 4; }
  check("existence/red drafts candidate for e2e too", existsSync(join(tmp, "trace", "missing-gate-candidates", "e2e.md")));

  const cj = join(tmp, "trace", "acceptance-contracts.json");
  check("existence/red emits trace/acceptance-contracts.json", existsSync(cj));
  if (existsSync(cj)) {
    const data = JSON.parse(readFileSync(cj, "utf8"));
    const nfr = data.contracts["NFR-19"] ?? [];
    check(
      "contracts map: NFR-19 pixel-diff = missing-mechanism",
      nfr.some((e) => e.method === "pixel-diff" && e.status === "missing-mechanism" && e.mechanism === null),
      JSON.stringify(data.contracts),
    );
    check(
      "contracts map: FR-70 e2e = stub-mechanism",
      (data.contracts["FR-70"] ?? []).some((e) => e.method === "e2e" && e.status === "stub-mechanism"),
      JSON.stringify(data.contracts),
    );
  } else { n += 2; failed += 2; }
}

// ---------- 2. existence mode, green fixture: must go GREEN ----------
{
  const { status, out } = runIn("green", ["--mode=existence"]);
  check("existence/green exits 0", status === 0, `exit=${status}\n${out}`);
  check("existence/green prints Result: PASS", /^Result: PASS/m.test(out), out);
  check("existence/green has no untagged failures (every MVP row tagged)", !/untagged/.test(out), out);
  check("existence/green prints Scope line", /^Scope: 3 tagged requirement\(s\)/m.test(out), out);
}

// ---------- 3. artifact mode, red fixture: must go RED ----------
{
  const { tmp, status, out } = runIn("red", ["--mode=artifact"]);
  check("artifact/red exits 1", status === 1, `exit=${status}\n${out}`);
  check("artifact/red prints Result: FAIL", /^Result: FAIL/m.test(out), out);
  check("artifact/red fails missing pixel-diff artifact", /FAIL\s+\[NFR-19\].*no pixel-diff artifact found/.test(out), out);
  check("artifact/red fails missing vision-verify artifact", /FAIL\s+\[NFR-19\].*no vision-verify artifact found/.test(out), out);
  check("artifact/red fails missing e2e artifact", /FAIL\s+\[FR-70\].*no e2e artifact found/.test(out), out);
  const cj = join(tmp, "trace", "acceptance-contracts.json");
  check("artifact/red contracts map shows missing-artifact", existsSync(cj) && readFileSync(cj, "utf8").includes("missing-artifact"));
}

// ---------- 4. artifact mode, green fixture: must go GREEN ----------
{
  const { tmp, status, out } = runIn("green", ["--mode=artifact"]);
  check("artifact/green exits 0", status === 0, `exit=${status}\n${out}`);
  check("artifact/green prints Result: PASS", /^Result: PASS/m.test(out), out);
  const cj = join(tmp, "trace", "acceptance-contracts.json");
  if (existsSync(cj)) {
    const data = JSON.parse(readFileSync(cj, "utf8"));
    check(
      "artifact/green: NFR-19 pixel-diff resolves to visual-diff report",
      (data.contracts["NFR-19"] ?? []).some((e) => e.method === "pixel-diff" && e.status === "artifact-ok" && /visual-diff/.test(e.artifact ?? "")),
      JSON.stringify(data.contracts),
    );
  } else { n += 1; failed += 1; console.error("FAIL - artifact/green contracts json missing"); }
}

// ---------- 5. waiver is visible, never silent (and never blanket) ----------
{
  const { status, out } = runIn("red", ["--mode=artifact"], (tmp) => {
    mkdirSync(join(tmp, "docs", "qa", "waivers"), { recursive: true });
    writeFileSync(
      join(tmp, "docs", "qa", "waivers", "nfr-19-visual.md"),
      "# Waiver: NFR-19\n\nVisual fidelity evidence waived by the owner for this milestone.\n",
    );
  });
  check("waived NFR-19 prints a visible WAIVED line", /^WAIVED \[NFR-19\]/m.test(out), out);
  check("waiver does not rescue unwaived FR-70 — still exits 1", status === 1 && /FAIL\s+\[FR-70\]/.test(out), `exit=${status}\n${out}`);
}

// ---------- 6. below-threshold artifact must not pass ----------
{
  const { status, out } = runIn("green", ["--mode=artifact"], (tmp) => {
    writeFileSync(
      join(tmp, "docs", "qa", "visual-diff", "home", "report.json"),
      JSON.stringify({ page: "home", score: 0.42, threshold: 0.99 }, null, 2),
    );
  });
  check("score below parsed threshold fails", status === 1 && /score 0.42 is below threshold 0.99/.test(out), `exit=${status}\n${out}`);
}

// ---------- 7. a FAILING e2e run's HTML report must not count as passing evidence ----------
// playwright writes playwright-report/index.html on failing runs too; the
// fresh status-bearing .last-run.json must veto the mere-existence report.
{
  const { status, out } = runIn("green", ["--mode=artifact"], (tmp) => {
    writeFileSync(join(tmp, "test-results", ".last-run.json"), JSON.stringify({ status: "failed", failedTests: ["home spec"] }, null, 2));
    mkdirSync(join(tmp, "playwright-report"), { recursive: true });
    writeFileSync(join(tmp, "playwright-report", "index.html"), "<html><body>report of a FAILING run</body></html>");
  });
  check(
    "failing .last-run.json vetoes the sibling playwright-report/index.html",
    status === 1 && /FAIL\s+\[FR-70\].*status is "failed", not passed/.test(out),
    `exit=${status}\n${out}`,
  );
}

// ---------- 8. Scope 0 over product code: NOT-EARNED, never a clean PASS ----------
// requirements.md EXISTS but declares zero verification tags (the untouched
// template / pixel-run shape) while product code exists — both modes must
// exit 1 with Result: NOT-EARNED.
{
  const untaggedOnly = [
    "# Requirements Document",
    "",
    "| ID | Phase | Area | Description |",
    "|---|---|---|---|",
    "| FR-1 | MVP | Content | Home page reproduces the live site. |",
    "",
  ].join("\n");
  for (const mode of ["--mode=existence", "--mode=artifact"]) {
    const { status, out } = runIn("red", [mode], (tmp) => {
      writeFileSync(join(tmp, "docs", "requirements.md"), untaggedOnly);
      rmSync(join(tmp, "openspec"), { recursive: true, force: true });
    });
    check(`${mode} scope-0 over product code exits 1`, status === 1, `exit=${status}\n${out}`);
    check(`${mode} scope-0 over product code prints Result: NOT-EARNED`, /^Result: NOT-EARNED/m.test(out) && /^Scope: 0 tagged requirement\(s\)/m.test(out), out);
  }
}

// ---------- 9. Scope 0 with NO product code: SKIP-pending, exit 0 ----------
{
  const untaggedOnly = "# Requirements Document\n\n| ID | Phase | Area | Description |\n|---|---|---|---|\n| FR-1 | MVP | Content | Home page. |\n";
  const { status, out } = runIn("red", ["--mode=existence"], (tmp) => {
    writeFileSync(join(tmp, "docs", "requirements.md"), untaggedOnly);
    rmSync(join(tmp, "openspec"), { recursive: true, force: true });
    rmSync(join(tmp, "app"), { recursive: true, force: true });
  });
  check("scope-0 pre-phase exits 0", status === 0, `exit=${status}\n${out}`);
  check("scope-0 pre-phase prints Result: SKIP-pending (visible, never PASS)", /^Result: SKIP-pending$/m.test(out) && !/^Result: PASS/m.test(out), out);
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });

console.log(`\n${n - failed}/${n} assertions passed`);
process.exit(failed ? 1 : 0);
