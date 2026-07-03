// REFERENCE IMPLEMENTATION — factory-integrity lock (tamper evidence for gate-bearing files).
//
// The gates only mean something if the gate SCRIPTS themselves cannot be
// quietly weakened. In the pixel-perfect field run the qa-verify battery had
// its e2e/eval entries deleted ("Re-add when those layers exist") and the
// all-green summary was then presented as verification (forensics RC4); in the
// one full factory field run the PostToolUse hook silently never installed and
// nothing flagged it (course field study §2.4). This check makes both failure
// modes loud:
//
//   1. LOCK — `--init-lock` (run at post-adaptation G0, AFTER the project has
//      legitimately adapted the copied reference scripts) writes
//      factory-lock.json { createdAt, gitHead, files: { path: sha256 },
//      adaptations } over every gate-bearing file that exists in THIS project:
//      scripts/check-*.mjs, scripts/qa-verify.mjs, scripts/gate-status.mjs,
//      .githooks/*, .github/workflows/*.yml — plus .claude/workflows/* at the
//      softer workflow tier and quality/*-baseline.json +
//      quality/telemetry.config.json at the soft quality tier (WARN + ledger
//      event: ratchet baselines legitimately tighten via --update, but their
//      deletion/hand-editing must be tamper-evident). Drift is measured
//      against the project's OWN locked state, not the upstream reference,
//      so legitimate adaptation never reds.
//   2. VERIFY (default) — recompute hashes and enforce:
//      * drift (changed OR deleted) on a gate-bearing file WITHOUT a commit
//        touching that file whose message contains "Refs: PD-<n>" (an
//        approved improvement) = FAIL, hard red;
//      * drift on .claude/workflows/* = WARN + ledger event only (the
//        confirmed Workflow-args bug forces legitimate workflow forks —
//        punishing them trains people to disable this check); ledger emission
//        is fail-open via scripts/ledger.mjs when present;
//      * echo-stub scan: any package.json script named in the qa-verify
//        battery whose body matches /^echo |^true$|not yet configured/i =
//        FAIL (a stub exiting 0 is a vacuous pass, not verification);
//      * hook presence: .githooks/ wired via `git config core.hooksPath` AND
//        Claude hooks merged into .claude/settings.json — otherwise WARN
//        naming the exact gap;
//      * no lock yet: product code present = NOT-EARNED (exit 1); no product
//        code = SKIP-pending (exit 0, printed explicitly — never a silent
//        PASS over absence of evidence).
//
// Copy to scripts/check-factory-integrity.mjs in the target project and wire:
//   "check:integrity": "node scripts/check-factory-integrity.mjs"
// Usage:
//   node scripts/check-factory-integrity.mjs --init-lock [--adaptation "<note>"]...
//   node scripts/check-factory-integrity.mjs
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const argv = process.argv.slice(2);
const INIT = argv.includes("--init-lock");
const adaptations = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--adaptation" && argv[i + 1]) adaptations.push(argv[(i += 1)]);
}

const LOCK_PATH = "factory-lock.json";
const WORKFLOW_PREFIX = ".claude/workflows/";
const STUB_RE = /^echo |^true$|not yet configured/i;

const failures = [];
const warnings = [];
const fail = (id, msg) => failures.push({ id, msg });
const warn = (id, msg) => warnings.push({ id, msg });

function* walk(rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  for (const e of readdirSync(abs)) {
    if (e === "node_modules" || e === ".git") continue;
    const r = `${rel}/${e}`;
    if (statSync(join(root, r)).isDirectory()) yield* walk(r);
    else yield r;
  }
}

// Hash with CRLF normalized so a checkout-only line-ending flip is not "drift".
const sha256 = (rel) =>
  createHash("sha256").update(readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n")).digest("hex");

function git(args) {
  try {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status === 0) return (r.stdout ?? "").trim();
  } catch {
    /* git unavailable — callers treat null as "cannot verify" */
  }
  return null;
}

// Gate-bearing files that exist in THIS project (fixture trees included) plus
// the softer workflow tier. Extend the lists when the project adds gate layers.
function collectLockTargets() {
  const files = [];
  const scriptsDir = join(root, "scripts");
  if (existsSync(scriptsDir)) {
    for (const e of readdirSync(scriptsDir)) {
      if (statSync(join(scriptsDir, e)).isDirectory()) continue;
      if (/^check-.*\.mjs$/.test(e) || /^(qa-verify|gate-status)(\.reference)?\.mjs$/.test(e)) {
        files.push(`scripts/${e}`);
      }
    }
  }
  for (const f of walk(".githooks")) files.push(f);
  const wfDir = join(root, ".github", "workflows");
  if (existsSync(wfDir)) {
    for (const e of readdirSync(wfDir)) if (/\.ya?ml$/.test(e)) files.push(`.github/workflows/${e}`);
  }
  for (const f of walk(".claude/workflows")) files.push(f);
  // Quality tier: ratchet baselines + telemetry config. Deleting or
  // hand-editing quality/coverage-baseline.json used to be invisible to every
  // check; locking them makes it tamper-EVIDENT. They sit at a soft tier
  // (WARN + ledger event, like workflows) because legitimate tighten-only
  // `--update` runs rewrite them routinely — hard-failing every ratchet
  // tighten would train people to disable this check.
  const qualityDir = join(root, "quality");
  if (existsSync(qualityDir)) {
    for (const e of readdirSync(qualityDir)) {
      if (statSync(join(qualityDir, e)).isDirectory()) continue;
      if (/-baseline\.json$/.test(e) || e === "telemetry.config.json") files.push(`quality/${e}`);
    }
  }
  return files.sort();
}

const isWorkflowTier = (rel) => rel.startsWith(WORKFLOW_PREFIX);
const isQualityTier = (rel) => rel.startsWith("quality/");

function hasApprovedPdCommit(rel, sinceIso) {
  const args = ["log", "--format=%B%x1e"];
  if (sinceIso) args.push(`--since=${sinceIso}`);
  args.push("--", rel);
  const out = git(args);
  if (!out) return false;
  return out.split("\u001e").some((msg) => /Refs:\s*PD-\d+/i.test(msg));
}

// Fail-open ledger emission (mechanism 1 is soft; its CONSUMERS are hard).
// The ledger CLI's ONLY write command is "emit" — any other verb warns on
// stderr and exits 0 WITHOUT writing, which with stdio:"ignore" here would
// silently drop the event (fail-open telemetry becoming fail-silent-and-lost).
function emitLedger(event) {
  try {
    for (const cand of ["scripts/ledger.mjs", "scripts/ledger.reference.mjs"]) {
      const p = join(root, cand);
      if (!existsSync(p)) continue;
      spawnSync(process.execPath, [p, "emit", JSON.stringify(event)], { cwd: root, stdio: "ignore", timeout: 5000 });
      return;
    }
  } catch {
    /* fail-open by design */
  }
}

function productCodeExists() {
  const exts = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|vue|svelte)$/i;
  for (const dir of ["app", "src", "lib", "server", "packages"]) {
    for (const f of walk(dir)) if (exts.test(f)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// --init-lock mode
// ---------------------------------------------------------------------------
if (INIT) {
  const targets = collectLockTargets();
  const lock = {
    createdAt: new Date().toISOString(),
    gitHead: git(["rev-parse", "HEAD"]),
    files: Object.fromEntries(targets.map((f) => [f, sha256(f)])),
    adaptations,
  };
  const existed = existsSync(join(root, LOCK_PATH));
  writeFileSync(join(root, LOCK_PATH), `${JSON.stringify(lock, null, 2)}\n`);
  if (existed) {
    console.warn(
      "WARN  [lock] existing factory-lock.json superseded — re-locking is a post-adaptation-G0 / approved-improvement action, not routine.",
    );
  }
  console.log(`Locked ${targets.length} gate-bearing file(s) into ${LOCK_PATH} (gitHead: ${lock.gitHead ?? "n/a"}).`);
  console.log(`Scope: ${targets.length} locked file(s)`);
  console.log(`Result: PASS${existed ? ", 1 warning(s)" : ""}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// verify mode (default)
// ---------------------------------------------------------------------------
let lock = null;
if (existsSync(join(root, LOCK_PATH))) {
  try {
    lock = JSON.parse(readFileSync(join(root, LOCK_PATH), "utf8"));
  } catch {
    fail(
      "lock",
      "factory-lock.json is not valid JSON — re-establish it via --init-lock through an approved improvement (Refs: PD-<n>).",
    );
  }
}

const lockedFiles = lock?.files ? Object.keys(lock.files) : [];

if (lock?.files) {
  for (const rel of lockedFiles) {
    const exists = existsSync(join(root, rel));
    const drifted = !exists || sha256(rel) !== lock.files[rel];
    if (!drifted) continue;
    const kind = exists ? "hash drift" : "file MISSING (deleted?)";
    if (isWorkflowTier(rel)) {
      warn(
        rel,
        `workflow-tier drift (${kind}) vs factory-lock.json — tolerated (the confirmed Workflow-args bug forces legitimate forks) but recorded as a ledger event.`,
      );
      emitLedger({
        ts: new Date().toISOString(),
        event: "integrity-workflow-drift",
        check: "check-factory-integrity",
        // Ledger schema is fixed — free-form fields survive only inside meta.
        meta: { file: rel, kind },
      });
    } else if (isQualityTier(rel)) {
      warn(
        rel,
        `quality-tier drift (${kind}) vs factory-lock.json — a ratchet baseline/config changed since the lock. Legitimate if a tighten-only --update wrote it (reseal at the next --init-lock); a hand-edit or deletion that lowers the floor is laundering. Recorded as a ledger event.`,
      );
      emitLedger({
        ts: new Date().toISOString(),
        event: "integrity-quality-drift",
        check: "check-factory-integrity",
        meta: { file: rel, kind },
      });
    } else if (hasApprovedPdCommit(rel, lock.createdAt)) {
      warn(
        rel,
        `gate-bearing drift (${kind}) is covered by an approved improvement commit (message contains "Refs: PD-<n>") — reseal with --init-lock inside that improvement.`,
      );
    } else {
      fail(
        rel,
        `gate-bearing file drift (${kind}) vs factory-lock.json with NO commit touching it whose message contains "Refs: PD-<n>". Gate scripts may only change through an approved improvement (executed red-to-green proof + human approval). Restore the locked file or land the approved "Refs: PD-<n>" commit.`,
      );
    }
  }
  for (const rel of collectLockTargets()) {
    if (isWorkflowTier(rel) || rel in lock.files) continue;
    warn(rel, `gate-bearing file exists but is NOT in factory-lock.json — reseal via --init-lock in an approved "Refs: PD-<n>" commit so it becomes tamper-evident too.`);
  }
}

// Echo-stub scan over the npm scripts the qa battery actually names.
function batteryScriptNames() {
  const names = new Set();
  for (const cand of ["scripts/qa-verify.mjs", "scripts/qa-verify.reference.mjs"]) {
    const p = join(root, cand);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/["']run["']\s*,\s*["']([^"']+)["']/g)) names.add(m[1]);
  }
  if (names.size === 0) {
    for (const n of ["test", "test:run", "test:integration", "test:e2e", "lint", "build"]) names.add(n);
  }
  return names;
}

if (existsSync(join(root, "package.json"))) {
  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    warn("package.json", "not valid JSON — stub scan skipped.");
  }
  if (pkg?.scripts) {
    for (const name of batteryScriptNames()) {
      const body = pkg.scripts[name];
      if (typeof body !== "string") continue;
      if (STUB_RE.test(body.trim())) {
        fail(
          `scripts.${name}`,
          `package.json script "${name}" is a stub ("${body}") but the qa battery names it — a stub exiting 0 is a vacuous pass, not verification (forensics RC1: test:e2e = echo stub = green). Implement it or remove it from the battery via an explicit waiver.`,
        );
      }
    }
  }
}

// Hook presence — the silently-never-installed-hook fix. Each gap is NAMED.
if (!existsSync(join(root, ".githooks"))) {
  warn("hooks", "gap: .githooks/ directory missing — git hooks were never installed (templates/hooks/README.md step 1).");
} else {
  const hp = git(["config", "core.hooksPath"]);
  if (hp === null) {
    warn(
      "hooks",
      "gap: cannot verify core.hooksPath (git unavailable or not a repo) — .githooks/ exists but may silently never fire; run `git config core.hooksPath .githooks` inside the repo.",
    );
  } else if (hp !== ".githooks") {
    warn(
      "hooks",
      `gap: core.hooksPath is "${hp || "(unset)"}" — .githooks/ exists but git will never run it; run \`git config core.hooksPath .githooks\`.`,
    );
  }
}
let claudeHooks = false;
for (const cand of [".claude/settings.json", ".claude/settings.local.json"]) {
  try {
    const s = JSON.parse(readFileSync(join(root, cand), "utf8"));
    if (s && typeof s === "object" && s.hooks) claudeHooks = true;
  } catch {
    /* absent or unparsable = not installed */
  }
}
if (!claudeHooks) {
  warn(
    "hooks",
    "gap: Claude hooks not installed — no `hooks` key in .claude/settings.json. Merge templates/hooks/claude-code-hooks.json (field evidence: the PostToolUse hook silently never installed in the one full factory run and nothing flagged it).",
  );
}

// Three-valued verdict — never render absence of the lock as PASS.
let result;
if (!lock && failures.length === 0) {
  if (productCodeExists()) {
    fail(
      "lock",
      "factory-lock.json missing while product code exists — the integrity lock was never established at post-adaptation G0, so every gate script is unverifiable. Run `node scripts/check-factory-integrity.mjs --init-lock` (G0 checklist) or land it via an approved improvement.",
    );
    result = "NOT-EARNED";
  } else {
    result = "SKIP-pending";
  }
} else {
  result = failures.length ? "FAIL" : "PASS";
}

for (const w of warnings) console.warn(`WARN  [${w.id}] ${w.msg}`);
for (const f of failures) console.error(`FAIL  [${f.id}] ${f.msg}`);
if (result === "SKIP-pending") {
  console.log("SKIP-pending: no factory-lock.json yet and no product code — establish the lock with --init-lock at post-adaptation G0.");
}

console.log(`\nScope: ${lockedFiles.length} locked file(s)`);
console.log(`Result: ${result}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
process.exit(failures.length ? 1 : 0);
