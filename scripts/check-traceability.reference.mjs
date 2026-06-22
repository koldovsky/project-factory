// REFERENCE IMPLEMENTATION — deterministic traceability validator.
//
// Verifies, with exit codes (no LLM judgment), that the requirement chain is
// intact:  FR -> spec -> slice plan -> tests -> recordings, plus OpenSpec
// hygiene (archived tasks all ticked, no forgotten active changes).
//
// Conventions it enforces (see MASTER-PROMPT / AGENTS template):
//   - specs cite the FR ids they implement (plain "FR-12" mentions);
//   - the capability plan owns every MVP FR;
//   - tests carry "@trace FR-12" (or "@trace BUG-3") annotations;
//   - recording manifests mention the FR/BUG ids they prove.
//
// Usage:
//   node scripts/check-traceability.mjs                 # report + exit code
//   node scripts/check-traceability.mjs --strict-tests  # missing test trace = FAIL
//   node scripts/check-traceability.mjs --strict-recordings
//   node scripts/check-traceability.mjs --release       # active changes = FAIL
//   node scripts/check-traceability.mjs --check-fresh   # committed report must match
//
// Outputs (deterministic, no timestamps — safe to diff in CI):
//   docs/qa/traceability-report.md   (generated matrix — do not hand-edit)
//   trace/trace.json                 (machine-readable graph: nodes + edges)
//
// Wire as: "check:trace": "node scripts/check-traceability.mjs"
// Run in pre-commit (fast) and CI (with --check-fresh and release flags).
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const flags = new Set(process.argv.slice(2));
const PATHS = {
  requirements: "docs/requirements.md",
  plan: "docs/mvp-capability-plan.md",
  specsDir: "openspec/specs",
  changesDir: "openspec/changes",
  qaDir: "docs/qa",
  testDirs: ["lib", "tests", "app", "src", "components", "evals"],
  reportOut: "docs/qa/traceability-report.md",
  jsonOut: "trace/trace.json",
};

const failures = [];
const warnings = [];
const fail = (check, msg) => failures.push({ check, msg });
const warn = (check, msg) => warnings.push({ check, msg });

// ---------- helpers ----------
function read(rel) {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
function* walk(dir, filter) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(abs, entry);
    if (statSync(p).isDirectory()) yield* walk(join(dir, entry), filter);
    else if (filter(entry)) yield join(dir, entry);
  }
}
// Ids may be plain (FR-12) or categorized (FR-SHELL-01, NFR-A11Y-02).
const idsIn = (text) => [...new Set(text.match(/\b(?:FR|NFR|TC|BC|BUG)-(?:[A-Z0-9]+-)?\d+\b/g) ?? [])];

// ---------- 1. parse requirements ----------
// Missing requirements file is NORMAL before Phase 1 (the loop installs in
// Phase 0): FR-chain checks are skipped with a warning. At release time the
// file is mandatory.
const reqText = read(PATHS.requirements);
const requirementsPresent = reqText !== null;
if (!requirementsPresent) {
  const msg = `${PATHS.requirements} not found - FR chain checks skipped (expected before Phase 1; mandatory at --release)`;
  if (flags.has("--release")) fail("requirements", msg);
  else warn("requirements", msg);
}
const requirements = new Map(); // id -> { phase }
for (const line of (reqText ?? "").split("\n")) {
  const m = line.match(/^\|\s*((?:FR|NFR|TC|BC)-(?:[A-Z0-9]+-)?\d+)\s*\|/);
  if (!m) continue;
  const phase = /\|\s*Future\s*\|/i.test(line) ? "Future" : "MVP";
  requirements.set(m[1], { phase });
}
const mvpFRs = [...requirements.keys()].filter(
  (id) => id.startsWith("FR-") && requirements.get(id).phase === "MVP",
);
if (requirementsPresent && mvpFRs.length === 0)
  fail("requirements", "no MVP FR rows parsed — check table format `| FR-n | MVP | ... |`");

// ---------- 2. spec mentions ----------
// Before Phase 2 there are no specs at all: missing citations are warnings.
// Once the first spec exists, an uncited MVP FR is a hard failure.
// Active OpenSpec changes (Option B) temporarily HOLD the baseline spec as a
// delta under openspec/changes/<change>/specs/ — those count as citations,
// otherwise every mid-slice commit would fail spec-mention.
const specMentions = new Map(); // id -> [spec files]
let specFileCount = 0;
const recordSpec = (file) => {
  const ids = idsIn(read(file) ?? "");
  for (const id of ids) {
    if (!specMentions.has(id)) specMentions.set(id, []);
    specMentions.get(id).push(file.replaceAll("\\", "/"));
  }
};
for (const file of walk(PATHS.specsDir, (f) => f.endsWith(".md"))) {
  specFileCount += 1;
  recordSpec(file);
}
for (const file of walk(PATHS.changesDir, (f) => f === "spec.md")) {
  // Archived deltas are history (baseline owns them) — match the archive
  // DIRECTORY as a path segment, not a substring, so a change legitimately
  // named e.g. add-archive-export is not silently skipped (review-gate
  // finding, calibration run).
  if (/(^|[\\/])archive([\\/]|$)/.test(file)) continue;
  specFileCount += 1;
  recordSpec(file);
}
const specsStarted = specFileCount > 0;
for (const id of mvpFRs) {
  if (!specMentions.has(id)) {
    const msg = `${id} is not cited by any spec under ${PATHS.specsDir}/`;
    if (specsStarted || flags.has("--release")) fail("spec-mention", msg);
    else warn("spec-mention", `${msg} (no specs authored yet - expected before Phase 2)`);
  }
}

// ---------- 3. plan ownership ----------
const planText = read(PATHS.plan) ?? "";
if (!planText) {
  const msg = `${PATHS.plan} not found - ownership check skipped (expected before Phase 3; mandatory at --release)`;
  if (flags.has("--release")) fail("plan-ownership", msg);
  else warn("plan-ownership", msg);
} else {
  const planIds = new Set(idsIn(planText));
  for (const id of mvpFRs) {
    if (!planIds.has(id)) fail("plan-ownership", `${id} is not assigned in ${PATHS.plan}`);
  }
}

// ---------- 4. test traces ----------
const testTraces = new Map(); // id -> [test files]
// `.eval.ts` files are graded-quality eval cases (evals/cases/*) — they carry
// `@trace` ids just like tests, so an NFR proven only by an eval still joins
// the chain instead of showing as an evidence gap.
const isTestFile = (f) => /\.(test|spec|eval)\.(ts|tsx|js|mjs)$/.test(f) || /integration|e2e/.test(f);
for (const dir of PATHS.testDirs) {
  for (const file of walk(dir, isTestFile)) {
    const text = read(file) ?? "";
    for (const m of text.matchAll(/@trace\s+([A-Z]+-\d+(?:\s*,\s*[A-Z]+-\d+)*)/g)) {
      for (const id of m[1].split(/\s*,\s*/)) {
        if (!testTraces.has(id)) testTraces.set(id, []);
        testTraces.get(id).push(file.replaceAll("\\", "/"));
      }
    }
  }
}
for (const id of mvpFRs) {
  if (!testTraces.has(id)) {
    const report = `${id} has no test annotated "@trace ${id}"`;
    if (flags.has("--strict-tests")) fail("test-trace", report);
    else warn("test-trace", report);
  }
}

// ---------- 5. recording evidence (COVERAGE MAP — weak signal) ----------
// This only checks that an FR id is MENTIONED in a manifest. It does NOT prove
// the clip exists or passed — that is `scripts/check-recordings.mjs`'s job
// (video on disk + size + asserted + vision). Keep both: this maps coverage,
// check-recordings validates the artifacts. `--strict-recordings` here is a
// coverage gate, not an evidence gate.
const recordingMentions = new Map(); // id -> [manifest files]
for (const file of walk(PATHS.qaDir, (f) => f === "manifest.json")) {
  const ids = idsIn(read(file) ?? "");
  for (const id of ids) {
    if (!recordingMentions.has(id)) recordingMentions.set(id, []);
    recordingMentions.get(id).push(file.replaceAll("\\", "/"));
  }
}
for (const id of mvpFRs) {
  if (!recordingMentions.has(id)) {
    const report = `${id} is not referenced by any recording manifest under ${PATHS.qaDir}/`;
    if (flags.has("--strict-recordings")) fail("recording-evidence", report);
    else warn("recording-evidence", report);
  }
}

// ---------- 6. OpenSpec hygiene ----------
const archiveDir = join(PATHS.changesDir, "archive");
for (const file of walk(archiveDir, (f) => f === "tasks.md")) {
  const unchecked = ((read(file) ?? "").match(/^\s*-\s*\[\s\]/gm) ?? []).length;
  if (unchecked > 0) fail("tasks-complete", `${file.replaceAll("\\", "/")} has ${unchecked} unchecked task(s) but is archived`);
}
if (existsSync(join(root, PATHS.changesDir))) {
  const active = readdirSync(join(root, PATHS.changesDir)).filter(
    (e) => e !== "archive" && statSync(join(root, PATHS.changesDir, e)).isDirectory(),
  );
  for (const change of active) {
    const report = `active change "${change}" is not archived`;
    if (flags.has("--release")) fail("active-changes", report);
    else warn("active-changes", report);
  }
}

// ---------- outputs ----------
const rows = mvpFRs.map((id) => ({
  id,
  specs: specMentions.get(id) ?? [],
  planned: planText ? new Set(idsIn(planText)).has(id) : null,
  tests: testTraces.get(id) ?? [],
  recordings: recordingMentions.get(id) ?? [],
}));

// Generated artifacts are ASCII-only on purpose: they get parsed, diffed,
// and displayed by many tools across OSes; encoding drift is a real failure
// mode on Windows toolchains.
const report = `# Traceability Report (generated - do not hand-edit)

Generated by \`node scripts/check-traceability.mjs\`. Regenerate after any
requirements/spec/test/recording change; CI runs \`--check-fresh\`.

Scope: ${mvpFRs.length} MVP functional requirements.
Result: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length} failure${failures.length === 1 ? "" : "s"})`}${warnings.length ? `, ${warnings.length} warning(s)` : ""}

| FR | Spec | Plan | Test trace | Recording |
|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.id} | ${r.specs.length ? "yes" : "**MISSING**"} | ${r.planned === null ? "n/a" : r.planned ? "yes" : "**MISSING**"} | ${r.tests.length ? r.tests.length : "-"} | ${r.recordings.length ? "yes" : "-"} |`,
  )
  .join("\n")}

## Failures

${failures.length ? failures.map((f) => `- **${f.check}**: ${f.msg}`).join("\n") : "None."}

## Warnings

${warnings.length ? warnings.map((w) => `- **${w.check}**: ${w.msg}`).join("\n") : "None."}
`;

const trace = {
  generatedBy: "scripts/check-traceability.mjs",
  requirements: Object.fromEntries([...requirements].map(([id, v]) => [id, v.phase])),
  links: rows,
  failures,
  warnings,
};

if (flags.has("--check-fresh")) {
  const committed = read(PATHS.reportOut);
  if (committed === null) fail("freshness", `${PATHS.reportOut} does not exist — run the validator and commit it`);
  else if (committed.replace(/\r\n/g, "\n") !== report.replace(/\r\n/g, "\n"))
    fail("freshness", `${PATHS.reportOut} is stale — regenerate and commit`);
} else {
  mkdirSync(join(root, "trace"), { recursive: true });
  mkdirSync(join(root, "docs", "qa"), { recursive: true });
  writeFileSync(join(root, PATHS.reportOut), report);
  writeFileSync(join(root, PATHS.jsonOut), `${JSON.stringify(trace, null, 2)}\n`);
}

finish();

function finish() {
  for (const w of warnings) console.warn(`WARN  [${w.check}] ${w.msg}`);
  for (const f of failures) console.error(`FAIL  [${f.check}] ${f.msg}`);
  console.log(
    `\ntraceability: ${mvpFRs?.length ?? 0} MVP FRs checked — ${failures.length} failure(s), ${warnings.length} warning(s)`,
  );
  if (!flags.has("--check-fresh")) console.log(`wrote ${PATHS.reportOut} and ${PATHS.jsonOut}`);
  process.exit(failures.length ? 1 : 0);
}
