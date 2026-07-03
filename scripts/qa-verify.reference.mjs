// REFERENCE IMPLEMENTATION (proven on a real production delivery).
// Copy to scripts/qa-verify.mjs in the new project and adapt the `commands`
// list to the npm scripts that exist. Runs the whole validation battery and
// writes a markdown evidence report to docs/qa/automated-verification-latest.md.
// Wire as: "qa:verify": "node scripts/qa-verify.mjs".
//
// THREE-VALUED SEMANTICS (reflection design, mechanism 3 — the vacuous-pass
// fix; see docs/field-reports/2026-07-02-reflection-mechanism-design.md and
// the pixel forensics that motivated it). Every battery member is CLASSIFIED,
// not just exit-coded:
//   PASS         — exit 0 with real scope (or no "Scope:" contract to parse).
//   FAIL         — non-zero exit (and no NOT-EARNED self-verdict).
//   NOT-EARNED   — emptiness where evidence is due: "Scope: 0" / SKIP output
//                  while product code exists or the current-state.md header
//                  claims Phase >= 4; an echo/"not yet configured" npm stub
//                  (laundering, forensics RC4); or the member itself printing
//                  "Result: NOT-EARNED".
//   SKIP-pending — the same emptiness BEFORE any product code exists:
//                  visible, never counted as PASS.
//   MISSING      — a battery member not installed in this project. Printed
//                  explicitly, never silent. Post-phase, an uninstalled
//                  `node scripts/...` honesty check renders NOT-EARNED
//                  instead — and an all-MISSING battery never prints Pass.
// qa-verify is FORBIDDEN from printing "Overall result: Pass" while any
// member is NOT-EARNED — it prints "Overall result: NOT-EARNED (N member(s)
// unearned)" and exits 1 (the pixel run printed "Overall result: Pass" over
// "Scope: 0 clip(s)"; that is the disease this classification cures).
//
// These honesty checks live HERE, outside the FACTORY_TELEMETRY kill switch
// (design invariant 1). The ledger emission below is fail-open telemetry only
// and may never block or alter the battery verdict.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Root is the CURRENT WORKING DIRECTORY, matching every sibling check
// (check-acceptance-methods / gate-status / ledger-report). It must NEVER be
// derived from this script's own location: invoked by absolute path from
// another tree, a script-relative root would audit the WRONG project (and
// write its report/ledger into it) — observed printing "Overall result: Pass"
// over a red sandbox during validation. Run this from the project root.
const root = process.cwd();

const commands = [
  {
    name: "traceability",
    command: "node",
    args: ["scripts/check-traceability.mjs"],
  },
  {
    name: "trajectory",
    command: "node",
    args: ["scripts/check-trajectory.mjs"],
  },
  {
    // Real recordings gate: video artifacts exist + asserted + vision met
    // (graceful before Phase 6 — but "Scope: 0" over product code is
    // NOT-EARNED, never PASS: see classify() below).
    name: "recordings",
    command: "node",
    args: ["scripts/check-recordings.mjs"],
  },
  {
    // Acceptance-contract join (mechanism 2, HARD): every declared
    // verification method must resolve to a fresh threshold-passing artifact.
    name: "acceptance-artifacts",
    command: "node",
    args: ["scripts/check-acceptance-methods.mjs", "--mode=artifact"],
  },
  {
    // Pixel-parity acceptance gate (forensics fix 1) — reads
    // quality/visual-parity.config.json, writes docs/qa/visual-diff/*/report.json.
    name: "visual-fidelity",
    command: "node",
    args: ["scripts/check-visual-fidelity.mjs"],
  },
  {
    // Process ratchet (mechanism 5). EXPERIMENTAL per RULES-CHANGELOG.md —
    // run WITHOUT --strict until promoted there. Its NOT-EARNED verdict still
    // blocks the overall Pass below; that is the point.
    name: "process-ratchet",
    command: "node",
    args: ["scripts/check-process-ratchet.mjs"],
  },
  {
    // Integrity lock (mechanism 8): gate-bearing script drift + stub scan.
    name: "factory-integrity",
    command: "node",
    args: ["scripts/check-factory-integrity.mjs"],
  },
  {
    name: "unit-tests",
    command: "npm",
    args: ["run", "test:run"],
  },
  {
    name: "db-integration-tests",
    command: "npm",
    args: ["run", "test:integration"],
  },
  {
    name: "browser-e2e-tests",
    command: "npm",
    args: ["run", "test:e2e"],
  },
  {
    // Guards the committed eval score (quality bar). Needs evals/results/
    // latest.json from the eval-suite workflow — include once evals exist.
    name: "eval-ratchet",
    command: "node",
    args: ["scripts/check-eval-ratchet.mjs"],
  },
  {
    name: "lint",
    command: "npm",
    args: ["run", "lint"],
  },
  {
    name: "production-build",
    command: "npm",
    args: ["run", "build"],
  },
  {
    name: "openspec-all",
    command: "npx",
    args: ["openspec", "validate", "--all", "--strict"],
  },
  {
    name: "openspec-active-list",
    command: "npx",
    args: ["openspec", "list"],
  },
];

// ---------------------------------------------------------------------------
// Fail-open ledger emission (mechanism 1). Import errors and write errors are
// swallowed — telemetry must never block the battery. FACTORY_TELEMETRY=off
// is honored inside ledger.mjs and disables telemetry ONLY, never the
// honesty classification below.
// ---------------------------------------------------------------------------
let ledger = null;
try {
  for (const rel of ["scripts/ledger.mjs", "scripts/ledger.reference.mjs"]) {
    const candidate = join(root, rel);
    if (existsSync(candidate)) {
      ledger = await import(pathToFileURL(candidate).href);
      break;
    }
  }
} catch {
  ledger = null;
}
function emitLedger(event) {
  try {
    ledger?.emit?.(event, { root });
  } catch {
    /* fail-open */
  }
}

// ---------------------------------------------------------------------------
// Three-valued classification inputs: product-code heuristic + phase header.
// When the two disagree (code exists but the header claims pre-phase, or the
// header claims Phase >= 4 over an empty tree), strictness is ON — render
// NOT-EARNED, never PASS (mechanism 3).
// ---------------------------------------------------------------------------
const IMPL_DIRS = ["app", "src", "lib", "pages", "components", "server", "api"];
const IMPL_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|vue|svelte|py|go|rb|rs|java|cs|php)$/i;
function hasProductCode() {
  const stack = IMPL_DIRS.map((d) => join(root, d)).filter((p) => existsSync(p));
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (IMPL_EXT.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) return true;
    }
  }
  return false;
}

// Parse the machine-readable phase header from docs/current-state.md
// (template line "- **Current phase:** Phase {{N}}"; also tolerates a
// factory-state comment block and a bare "Phase: N" line). Unfilled
// {{N}} placeholders simply fail the \d+ match and yield null.
function claimedPhase() {
  try {
    const text = readFileSync(join(root, "docs", "current-state.md"), "utf8");
    const m =
      text.match(/\*\*Current phase:\*\*\s*Phase\s*(\d+)/i) ??
      text.match(/<!--\s*factory-state[\s\S]*?\bphase\s*:\s*(\d+)/i) ??
      text.match(/^phase\s*:\s*(\d+)\s*$/im);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

const productCode = hasProductCode();
const phase = claimedPhase();
const postPhase = productCode || (phase !== null && phase >= 4);
console.log(
  `qa-verify: product code ${productCode ? "present" : "absent"}; claimed phase ${phase ?? "unknown"} — ` +
    (postPhase
      ? "post-phase strictness ON (emptiness renders NOT-EARNED)"
      : "pre-phase (emptiness renders SKIP-pending)"),
);

let pkgScripts = {};
try {
  pkgScripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
} catch {
  pkgScripts = {};
}

// A battery member that is not installed renders an explicit MISSING line.
// Pre-phase (and for npm/npx members, as adoption tolerance) MISSING is a
// tolerated warning — but NEVER silent: it appears in stdout, the report,
// and the ledger. Post-phase, an uninstalled `node scripts/...` honesty check
// is classified NOT-EARNED in the loop below: deleting (or never installing)
// check-acceptance-methods/check-factory-integrity over product code must
// not leave the battery green (absence of the check is absence of evidence).
function availability(entry) {
  if (entry.command === "node" && entry.args[0]?.startsWith("scripts/")) {
    return existsSync(join(root, entry.args[0])) ? null : `${entry.args[0]} is not installed`;
  }
  if (entry.command === "npm" && entry.args[0] === "run") {
    return pkgScripts[entry.args[1]] === undefined ? `npm script "${entry.args[1]}" is not defined in package.json` : null;
  }
  if (entry.command === "npx" && entry.args[0] === "openspec") {
    return existsSync(join(root, "openspec")) ? null : "openspec/ is not present";
  }
  return null;
}

// Stub scan (forensics RC4): an npm battery script whose body is an echo /
// true / "not yet configured" placeholder is laundering, not verification —
// NOT-EARNED without even running it.
const STUB_RE = /^echo |^true$|not yet configured/i;
function stubBody(entry) {
  if (entry.command === "npm" && entry.args[0] === "run") {
    const body = pkgScripts[entry.args[1]];
    if (typeof body === "string" && STUB_RE.test(body)) return body;
  }
  return null;
}

// Classify one member from its stdout contract ("Scope: <n> <unit>" +
// final "Result: PASS|FAIL|SKIP-pending|NOT-EARNED") and exit code. Members
// without the contract (unit tests, lint, build) classify on exit code alone.
function classify(output, exitCode) {
  const scopeMatch = output.match(/^Scope:\s*(\d+)\b/m);
  const scopeN = scopeMatch ? Number(scopeMatch[1]) : null;
  const declared = [...output.matchAll(/^Result:\s*(PASS|FAIL|SKIP-pending|NOT-EARNED)\b/gm)].pop()?.[1] ?? null;
  const empty = (reason) => ({ status: postPhase ? "NOT-EARNED" : "SKIP-pending", scopeN, reason });
  if (declared === "NOT-EARNED") return { status: "NOT-EARNED", scopeN, reason: "self" };
  if (declared === "SKIP-pending") return empty("skip");
  if (exitCode !== 0) return { status: "FAIL", scopeN, reason: "exit" };
  if (scopeN === 0) return empty("scope-0");
  if (declared === null && (/^SKIP\b/m.test(output) || /\bNothing to ratchet\b/.test(output))) return empty("skip");
  return { status: "PASS", scopeN, reason: "pass" };
}

const startedAt = new Date();
const results = [];

for (const entry of commands) {
  console.log(`\n==> ${entry.name}`);
  const commandStr = [entry.command, ...entry.args].join(" ");
  const notInstalled = availability(entry);
  if (notInstalled) {
    // Post-phase, an uninstalled node-script honesty check is NOT-EARNED —
    // never a tolerated warning. Deleting/never-installing the checks must
    // not render a green battery over product code (the pixel-run evasion).
    if (postPhase && entry.command === "node") {
      console.log(`NOT-EARNED ${entry.name}: ${notInstalled} — a missing check over product code is absence of evidence, never success; install it (copy the reference script) before the battery can pass.`);
      results.push({ name: entry.name, command: commandStr, exitCode: null, output: `NOT-EARNED (missing member): ${notInstalled}`, status: "NOT-EARNED", scopeN: null });
      emitLedger({ event: "check-run", check: entry.name, exitCode: null, scope_n: null, meta: { status: "NOT-EARNED", reason: "missing-member", productCode, notEarned: true } });
      continue;
    }
    console.log(`MISSING ${entry.name}: ${notInstalled} — rendered explicitly (never silent); install it or adapt the battery list.`);
    results.push({ name: entry.name, command: commandStr, exitCode: null, output: `MISSING: ${notInstalled}`, status: "MISSING", scopeN: null });
    emitLedger({ event: "check-run", check: entry.name, exitCode: null, scope_n: null, meta: { status: "MISSING", productCode } });
    continue;
  }
  const stub = stubBody(entry);
  if (stub !== null) {
    console.log(`NOT-EARNED ${entry.name}: npm script "${entry.args[1]}" is a stub (${JSON.stringify(stub)}) — an echo stub exiting 0 is laundering, not verification.`);
    results.push({ name: entry.name, command: commandStr, exitCode: null, output: `stub npm script body: ${stub}`, status: "NOT-EARNED", scopeN: null });
    emitLedger({ event: "check-run", check: entry.name, exitCode: null, scope_n: null, meta: { status: "NOT-EARNED", reason: "stub-script", productCode, notEarned: true } });
    continue;
  }
  const startedMs = Date.now();
  const result = await run(entry.command, entry.args);
  const { status, scopeN, reason } = classify(result.output, result.exitCode);
  if (status === "NOT-EARNED" && reason !== "self") {
    console.log(`NOT-EARNED ${entry.name}: emptiness (${reason}) while product code exists / header claims Phase ${phase ?? "?"} — absence of evidence is never success.`);
  } else if (status === "SKIP-pending") {
    console.log(`SKIP-pending ${entry.name}: pre-phase emptiness — visible, never counted as PASS.`);
  }
  results.push({
    name: entry.name,
    command: commandStr,
    exitCode: result.exitCode,
    output: result.output.trim(),
    status,
    scopeN,
  });
  emitLedger({
    event: "check-run",
    check: entry.name,
    exitCode: result.exitCode,
    scope_n: scopeN,
    durationMs: Date.now() - startedMs,
    meta: { status, productCode, notEarned: status === "NOT-EARNED" },
  });
  if (status === "FAIL") {
    console.error(`Command failed: ${entry.name}`);
    break;
  }
}

const finishedAt = new Date();
const failMember = results.find((r) => r.status === "FAIL");
const unearned = results.filter((r) => r.status === "NOT-EARNED");
const skipped = results.filter((r) => r.status === "SKIP-pending");
const missing = results.filter((r) => r.status === "MISSING");

// FORBIDDEN: "Overall result: Pass" while any member is NOT-EARNED — and a
// battery where EVERY member is MISSING verified nothing at all, so it may
// never print Pass either (all-missing = zero evidence in any phase).
let overall;
if (failMember) overall = "Fail";
else if (unearned.length) overall = `NOT-EARNED (${unearned.length} member(s) unearned)`;
else if (results.length > 0 && missing.length === results.length)
  overall = `NOT-EARNED (all ${results.length} battery member(s) missing — nothing was verified)`;
else overall = "Pass";
const exitCode = failMember ? failMember.exitCode || 1 : overall.startsWith("NOT-EARNED") ? 1 : 0;

const markdown = renderReport({ startedAt, finishedAt, results, overall });
const outputPath = join(root, "docs", "qa", "automated-verification-latest.md");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown, "utf8");
console.log(`\nWrote ${outputPath}`);

console.log(`\nScope: ${results.length} battery member(s)`);
if (missing.length) console.log(`MISSING member(s): ${missing.map((m) => m.name).join(", ")} — explicit warnings, never silent successes.`);
if (skipped.length) console.log(`SKIP-pending member(s): ${skipped.map((m) => m.name).join(", ")} — pre-phase, not counted as PASS.`);
console.log(`Overall result: ${overall}`);

emitLedger({
  event: "battery-run",
  check: "qa-verify",
  exitCode,
  scope_n: results.length,
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  meta: { overall, productCode, unearned: unearned.length, missing: missing.length },
});
process.exitCode = exitCode;

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      shell: process.platform === "win32",
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, output });
    });
  });
}

function renderReport({ startedAt, finishedAt, results, overall }) {
  const rows = results
    .map(
      (result) =>
        `| ${result.name} | \`${result.command}\` | ${result.status} | ${result.exitCode ?? "—"} |`,
    )
    .join("\n");
  const details = results
    .map(
      (result) => `## ${result.name}

Command: \`${result.command}\`

Status: ${result.status} (exit code: ${result.exitCode ?? "—"}${result.scopeN !== null && result.scopeN !== undefined ? `, Scope: ${result.scopeN}` : ""})

\`\`\`text
${result.output || "(no output)"}
\`\`\`
`,
    )
    .join("\n");

  return `# Automated Verification Latest

Generated by \`node scripts/qa-verify.mjs\`.

- Started: ${startedAt.toISOString()}
- Finished: ${finishedAt.toISOString()}
- Classification context: product code ${productCode ? "present" : "absent"}; claimed phase ${phase ?? "unknown"}
- Overall result: ${overall}

| Check | Command | Result | Exit code |
|---|---|---|---|
${rows}

${details}`;
}
