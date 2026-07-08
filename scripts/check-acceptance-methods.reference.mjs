// REFERENCE IMPLEMENTATION — acceptance-contract auditor (the "pixel-case killer").
//
// Copy to scripts/check-acceptance-methods.mjs in the target project and wire:
//   "check:acceptance":          "node scripts/check-acceptance-methods.mjs --mode=existence",
//   "check:acceptance:artifact": "node scripts/check-acceptance-methods.mjs --mode=artifact"
//
// WHY (see docs/field-reports/2026-07-02-pixel-perfect-forensics.md): a run
// whose requirements literally declared ">= 99% pixel match" + vision-verify
// shipped with NO pixel-diff tool anywhere, an echo-stub test:e2e, and zero
// acceptance artifacts — and every gate rendered green. "Acceptance method
// declared" vs "acceptance mechanism/artifact exists" is a computable join;
// this script computes it with an exit code. It is HARD from day one (the
// documented exception to the promotion ladder — its red evidence already
// exists in the field).
//
// WHAT IT SCANS: docs/requirements.md + openspec/specs/**/spec.md for
// verification-class tags. Closed vocabulary:
//   local-verifiable | vision-verify | recording | e2e | a11y | eval |
//   deploy-gated | pixel-diff
// Tags are recognized as `verify:`/`verification:`/`acceptance:` lists on the
// requirement's line, as bare hyphenated tokens (pixel-diff, vision-verify,
// local-verifiable, deploy-gated), and as free phrasing ("pixel match",
// "pixel-perfect", "pixel diff") — the exact phrasing the pixel run used.
//
// TWO MODES:
//   --mode=existence   (G3, before the autonomous build): every declared
//     method must resolve to a REAL mechanism — an npm script that is not an
//     echo stub (/^echo |^true$|not yet configured/i) or a real script file;
//     e2e/recording additionally require playwright in devDependencies. Any
//     failure auto-drafts trace/missing-gate-candidates/<method>.md (name,
//     threshold parsed from the requirement text, reference URL from the
//     specs, breakpoints/masks placeholders) and exits 1: the build may not
//     legally enter Phase 4 with a phantom acceptance method.
//   --mode=artifact    (G4/G6/G7 + every qa-verify run): every declared
//     method must resolve to a FRESH, threshold-passing artifact. Defaults:
//       pixel-diff     -> docs/qa/visual-diff/*/report.json  score >= threshold
//       vision-verify  -> docs/qa/vision-report.(md|json)    met: true
//       recording      -> docs/qa/demo-recordings/**manifest.json  >= 1 clip
//       e2e            -> test-results/.last-run.json status (a fresh FAILING
//                         status vetoes sibling mere-existence reports) or an
//                         e2e report file
//       eval           -> evals/results/latest.json
//       a11y           -> docs/qa/a11y-report.*
//       local-verifiable -> a test file annotated "@trace <id>"
//       deploy-gated   -> docs/qa/deploy-verification.*
//
// PRIME DIRECTIVE (reflection-mechanism design): absence of evidence is NEVER
// rendered as success. Pre-phase emptiness prints SKIP-pending explicitly
// (exit 0, and gate-status renders it SKIP — never PASS); emptiness while
// product code exists is FAIL / NOT-EARNED (exit 1).
//
// EXTENSIBILITY: quality/telemetry.config.json may carry
//   { "acceptance": { "maxAgeHours": 168, "tokens": { "<class>": {
//       "npmScripts": [], "scriptGlobs": [], "artifactGlobs": [],
//       "artifactCheck": "score|vision-met|recording-clips|exists-passed|trace-test",
//       "threshold": 0.99, "needsPlaywright": true } } } }
// Per-token entries merge over the built-in defaults; unknown tokens extend
// the vocabulary. A corrupt config is a FAIL, not a silent fallback.
//
// WAIVERS (PD-7): a file under docs/qa/waivers/*.md suppresses a requirement's
// failures only while it is OPEN. The matcher keys on the waiver's STATUS, not
// on mere mention of the requirement id: a `Status: open` (or missing status,
// treated as open for back-compat) waiver suppresses with a visible WAIVED
// line + counted warning; a `Status: closed|resolved|expired|revoked` waiver
// STOPS suppressing — the failure resurfaces as a normal FAIL and a visible
// "note: waiver … is closed" line is printed. Never silent, and a stale
// closed waiver can no longer launder a live failure.
//
// OUTPUTS:
//   trace/acceptance-contracts.json    requirement id -> [{method, mechanism,
//                                      artifact, status}] (both modes)
//   trace/missing-gate-candidates/*.md auto-drafted specs (existence failures)
//
// STDOUT CONVENTIONS (parsed by qa-verify/gate-status):
//   "Scope: <n> tagged requirement(s)" ... per-finding WARN/FAIL/WAIVED/
//   SKIP-pending lines ... "Result: PASS|FAIL|SKIP-pending|NOT-EARNED[, N warning(s)]"
//
// Usage:
//   node scripts/check-acceptance-methods.mjs --mode=existence
//   node scripts/check-acceptance-methods.mjs --mode=artifact
//   node scripts/check-acceptance-methods.mjs --mode=artifact --max-age-hours 24
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const argv = process.argv.slice(2);

// ---------- CLI ----------
function flagVal(name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const mode = flagVal("--mode");
if (mode !== "existence" && mode !== "artifact") {
  console.error("Usage: node scripts/check-acceptance-methods.mjs --mode=existence|artifact [--max-age-hours N]");
  process.exit(2);
}

// ---------- config (built-in defaults, extensible via telemetry.config) ----------
const DEFAULT_TOKENS = {
  "local-verifiable": {
    npmScripts: ["test", "test:run", "test:unit"],
    scriptGlobs: [],
    artifactGlobs: [],
    artifactCheck: "trace-test",
  },
  "pixel-diff": {
    npmScripts: ["check:visual", "test:visual", "check:pixel", "check:visual-fidelity", "check:visual-parity"],
    scriptGlobs: ["scripts/check-visual-fidelity.*", "scripts/check-visual-parity.*", "scripts/*pixel*.mjs"],
    artifactGlobs: ["docs/qa/visual-diff/*/report.json"],
    artifactCheck: "score",
    threshold: 0.99,
  },
  "vision-verify": {
    npmScripts: ["check:vision"],
    scriptGlobs: ["scripts/check-vision.*"],
    artifactGlobs: ["docs/qa/vision-report.md", "docs/qa/vision-report.json"],
    artifactCheck: "vision-met",
  },
  recording: {
    npmScripts: ["record:demos", "check:recordings"],
    scriptGlobs: ["scripts/record-demos.*", "scripts/check-recordings.*"],
    artifactGlobs: ["docs/qa/demo-recordings/manifest.json", "docs/qa/demo-recordings/*/manifest.json"],
    artifactCheck: "recording-clips",
    needsPlaywright: true,
  },
  e2e: {
    npmScripts: ["test:e2e", "e2e"],
    scriptGlobs: ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs"],
    // Status-bearing JSON first: playwright writes playwright-report/index.html
    // on FAILING runs too, so the run-status file must be consulted before the
    // mere-existence HTML report (evidence-of-run is not evidence-of-pass).
    artifactGlobs: ["test-results/.last-run.json", "docs/qa/e2e-report.json", "playwright-report/index.html", "docs/qa/e2e-report.md"],
    artifactCheck: "exists-passed",
    needsPlaywright: true,
  },
  a11y: {
    npmScripts: ["check:a11y"],
    scriptGlobs: ["scripts/check-a11y.*"],
    artifactGlobs: ["docs/qa/a11y-report.md", "docs/qa/a11y-report.json", "docs/qa/a11y-report.html"],
    artifactCheck: "exists-passed",
  },
  eval: {
    npmScripts: ["eval", "evals", "eval:run", "check:evals"],
    scriptGlobs: ["scripts/check-eval-ratchet.*", "evals/run-evals.*"],
    artifactGlobs: ["evals/results/latest.json"],
    artifactCheck: "exists-passed",
  },
  "deploy-gated": {
    npmScripts: ["deploy:verify", "check:deploy"],
    scriptGlobs: ["scripts/check-deploy*.*", ".github/workflows/*deploy*"],
    artifactGlobs: ["docs/qa/deploy-verification.json", "docs/qa/deploy-verification.md", "docs/qa/deploy-report.*"],
    artifactCheck: "exists-passed",
  },
};
const STUB_RE = /^echo |^true$|not yet configured/i;
const CONFIG_PATH = "quality/telemetry.config.json";

const failures = [];
const warnings = [];
const skips = []; // SKIP-pending lines (pre-phase emptiness, visible, never PASS)
const waivedLines = [];
const fail = (id, msg) => failures.push({ id, msg });
const warn = (id, msg) => warnings.push({ id, msg });

let maxAgeHours = 168; // "fresh" = artifact mtime within this window
const tokens = structuredClone(DEFAULT_TOKENS);
if (existsSync(join(root, CONFIG_PATH))) {
  try {
    const cfg = JSON.parse(readFileSync(join(root, CONFIG_PATH), "utf8"));
    const acc = cfg.acceptance ?? {};
    if (typeof acc.maxAgeHours === "number") maxAgeHours = acc.maxAgeHours;
    for (const [tok, over] of Object.entries(acc.tokens ?? {})) {
      // A well-formed config may extend the vocabulary freely, but WEAKENING a
      // built-in token's defaults must be visible, never silent (mirrors the
      // visual-fidelity below-default-threshold warning and the process
      // ratchet's widening WARN).
      const def = DEFAULT_TOKENS[tok];
      if (def) {
        if (typeof over.threshold === "number" && typeof def.threshold === "number" && over.threshold < def.threshold)
          warn("config", `token "${tok}": config lowers threshold ${def.threshold} -> ${over.threshold} — a loosened built-in acceptance bar (review ${CONFIG_PATH})`);
        if (typeof over.artifactCheck === "string" && def.artifactCheck && over.artifactCheck !== def.artifactCheck)
          warn("config", `token "${tok}": config changes artifactCheck "${def.artifactCheck}" -> "${over.artifactCheck}" — the built-in validation is being replaced (review ${CONFIG_PATH})`);
      }
      tokens[tok] = { ...(tokens[tok] ?? {}), ...over };
    }
  } catch (e) {
    // Corrupt config must not silently fall back to defaults — that would be
    // an invisible loosening path.
    fail("config", `${CONFIG_PATH} is not valid JSON (${e.message}) — fix or delete it`);
  }
}
const cliAge = flagVal("--max-age-hours");
if (cliAge !== undefined) maxAgeHours = Number(cliAge);
const VOCAB = Object.keys(tokens);
const HYPHEN_TOKENS = VOCAB.filter((t) => t.includes("-"));

// ---------- helpers ----------
const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), "utf8") : null);
const idsIn = (text) => [...new Set(text.match(/\b(?:FR|NFR|TC|BC)-(?:[A-Z0-9]+-)?\d+\b/g) ?? [])];
const URL_RE = /https?:\/\/[^\s)"'<>\]]+/g;
// Strip trailing markdown punctuation the regex over-captures (`https://x/`.
// from backtick-quoted prose) so the same URL never renders twice with
// different trailing junk in candidate drafts.
const cleanUrl = (u) => u.replace(/[`.,;:!?)\]]+$/g, "");

function walkAll(dir, cb) {
  const abs = join(root, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
  for (const e of readdirSync(abs)) {
    if (e === "node_modules" || e === ".git") continue;
    const rel = dir === "." ? e : `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) walkAll(rel, cb);
    else cb(rel);
  }
}
function globToRe(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const DS = String.fromCharCode(1); // temporary placeholder for **
  const body = esc
    .replaceAll("**", DS)
    .replaceAll("*", "[^/]*")
    .replaceAll(DS, ".*")
    .replaceAll("?", "[^/]");
  return new RegExp(`^${body}$`, "i");
}
function listMatches(glob) {
  const norm = glob.replaceAll("\\", "/");
  if (!/[*?]/.test(norm)) return existsSync(join(root, norm)) ? [norm] : [];
  const wildIdx = norm.search(/[*?]/);
  const slash = norm.lastIndexOf("/", wildIdx);
  const baseDir = slash > 0 ? norm.slice(0, slash) : ".";
  const re = globToRe(norm);
  const out = [];
  walkAll(baseDir, (rel) => { if (re.test(rel)) out.push(rel); });
  return out;
}

// Detect the declared verification classes on one line of text.
function methodsIn(line) {
  const found = new Set();
  const kw = line.match(/(?:verif(?:y|ication)|acceptance)\s*[:=]\s*([A-Za-z0-9,\s|/+-]+)/i);
  if (kw) for (const tok of kw[1].toLowerCase().split(/[^a-z0-9-]+/)) if (VOCAB.includes(tok)) found.add(tok);
  for (const t of HYPHEN_TOKENS) if (new RegExp(`\\b${t}\\b`, "i").test(line)) found.add(t);
  if (/pixel[\s-]?(?:diff|match(?:ing)?|perfect)/i.test(line)) found.add("pixel-diff");
  return found;
}
function parseThreshold(text) {
  let m = text.match(/(?:≥|>=|at least|minimum(?: of)?)\s*(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (m) return Number(m[1]) / 100;
  m = text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*pixel/i);
  if (m) return Number(m[1]) / 100;
  m = text.match(/score\s*(?:≥|>=)\s*(0?\.\d+)/i);
  if (m) return Number(m[1]);
  return null;
}

// ---------- parse the acceptance contract (requirements + specs) ----------
const REQUIREMENTS_PATH = "docs/requirements.md";
const SPECS_DIR = "openspec/specs";
const reqText = read(REQUIREMENTS_PATH);
const requirementsPresent = reqText !== null;

const contracts = new Map(); // id -> { phase, methods:Set, texts:[], urls:[] }
const ensure = (id) => {
  if (!contracts.has(id)) contracts.set(id, { phase: "MVP", methods: new Set(), texts: [], urls: [] });
  return contracts.get(id);
};
const untagged = []; // MVP FR/NFR rows with no declared method

for (const line of (reqText ?? "").split("\n")) {
  const m = line.match(/^\|\s*((?:FR|NFR|TC|BC)-(?:[A-Z0-9]+-)?\d+)\s*\|/);
  if (!m) continue;
  const id = m[1];
  const phase = /\|\s*Future\s*\|/i.test(line) ? "Future" : "MVP";
  const methods = methodsIn(line);
  if (methods.size) {
    const c = ensure(id);
    c.phase = phase;
    c.texts.push(line);
    for (const t of methods) c.methods.add(t);
  } else if (phase === "MVP" && /^(?:FR|NFR)-/.test(id)) {
    untagged.push(id);
  }
}

const specFullTextById = new Map(); // id -> concatenated spec text (threshold/URL fallback)
const specFiles = [];
walkAll(SPECS_DIR, (rel) => { if (rel.endsWith("/spec.md") || rel === `${SPECS_DIR}/spec.md`) specFiles.push(rel); });
for (const file of specFiles) {
  const text = read(file) ?? "";
  const fileIds = idsIn(text);
  const urls = [...new Set((text.match(URL_RE) ?? []).map(cleanUrl))];
  for (const line of text.split("\n")) {
    const ids = idsIn(line);
    if (!ids.length) continue;
    const methods = methodsIn(line);
    if (!methods.size) continue;
    for (const id of ids) {
      const c = ensure(id);
      c.texts.push(line);
      for (const t of methods) c.methods.add(t);
    }
  }
  for (const id of fileIds) {
    if (urls.length && contracts.has(id)) contracts.get(id).urls.push(...urls);
    specFullTextById.set(id, `${specFullTextById.get(id) ?? ""}\n${text}`);
  }
}

// ---------- phase heuristic: does product code exist? ----------
const CODE_DIRS = ["app", "src", "lib", "pages", "components", "server", "api"];
const CODE_EXT = /\.(m?[jt]sx?|cjs|py|go|rb|java|cs|php|svelte|vue|html|css)$/i;
let productCode = false;
for (const d of CODE_DIRS) {
  if (productCode) break;
  walkAll(d, (rel) => { if (CODE_EXT.test(rel)) productCode = true; });
}

// ---------- pre-phase / post-phase emptiness (the prime directive) ----------
// Scope 0 = ZERO tagged requirements. Whether docs/requirements.md is missing
// entirely OR exists but declares no verification tags (the untouched
// template / an authored file without the Verification column — exactly the
// pixel-run shape), there is no acceptance contract to audit: over product
// code that is NOT-EARNED (exit 1), never a clean PASS.
console.log(`Scope: ${contracts.size} tagged requirement(s)`);
if (contracts.size === 0) {
  if (productCode) {
    console.error(
      requirementsPresent
        ? `NOT-EARNED [requirements] ${REQUIREMENTS_PATH} exists but declares ZERO verification tags while product code exists — an untagged requirements file is not an acceptance contract (tag MVP rows with [${VOCAB.join(" | ")}])`
        : `NOT-EARNED [requirements] ${REQUIREMENTS_PATH} missing while product code exists — the acceptance contract was never authored`,
    );
    console.log("Result: NOT-EARNED");
    process.exit(1);
  }
  console.log(
    `SKIP-pending [requirements] ${requirementsPresent ? `${REQUIREMENTS_PATH} declares no verification tags yet` : `${REQUIREMENTS_PATH} not found`} and no product code yet — nothing to audit (pending, NOT a pass)`,
  );
  console.log("Result: SKIP-pending");
  process.exit(0);
}

// ---------- waivers (visible, never silent) ----------
// PD-7: key on the waiver's STATUS, not on mere id mention. A `Status:` /
// `State:` field with a CLOSED-class value (closed | resolved | expired |
// revoked | withdrawn) stops the waiver from suppressing — the failure
// resurfaces. Missing status = open (back-compat with unstatused waivers).
const CLOSED_STATUS = new Set(["closed", "resolved", "expired", "revoked", "withdrawn", "done"]);
const waiverStatusOf = (body) => {
  const m = body.match(/^\s*(?:>?\s*)?(?:\*\*|_)?\s*(?:status|state)\s*(?:\*\*|_)?\s*[:=]\s*`?\s*([A-Za-z-]+)/im);
  return m ? m[1].toLowerCase() : "open";
};
const waivedIds = new Map(); // id -> waiver file (OPEN waivers only)
const closedWaiverNotes = []; // visible "no longer suppresses" lines
walkAll("docs/qa/waivers", (rel) => {
  if (!rel.endsWith(".md")) return;
  const body = read(rel) ?? "";
  const status = waiverStatusOf(body);
  const open = !CLOSED_STATUS.has(status);
  for (const id of idsIn(body)) {
    if (open) {
      if (!waivedIds.has(id)) waivedIds.set(id, rel);
    } else {
      closedWaiverNotes.push({ id, rel, status });
    }
  }
});

// ---------- mechanism resolution ----------
let pkg = {};
try { pkg = JSON.parse(read("package.json") ?? "{}"); } catch { fail("package.json", "package.json is not valid JSON"); }
const pkgScripts = pkg.scripts ?? {};
const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const playwrightInstalled = Object.keys(allDeps).some((k) => k === "playwright" || k === "playwright-chromium" || k.startsWith("@playwright/"));

function resolveMechanism(spec) {
  let stub = null;
  for (const name of spec.npmScripts ?? []) {
    const cmd = pkgScripts[name];
    if (typeof cmd !== "string") continue;
    if (STUB_RE.test(cmd.trim())) { stub = stub ?? { name, cmd: cmd.trim() }; continue; }
    return { mechanism: `npm:${name}`, stub: null };
  }
  for (const g of spec.scriptGlobs ?? []) {
    for (const f of listMatches(g)) {
      const st = statSync(join(root, f));
      if (!st.isFile() || st.size === 0) continue;
      if (/not yet configured/i.test(readFileSync(join(root, f), "utf8"))) { stub = stub ?? { name: f, cmd: "(marked not yet configured)" }; continue; }
      return { mechanism: `file:${f}`, stub: null };
    }
  }
  return { mechanism: null, stub };
}

function thresholdFor(id, spec) {
  const c = contracts.get(id);
  const text = `${(c?.texts ?? []).join("\n")}\n${specFullTextById.get(id) ?? ""}`;
  return parseThreshold(text) ?? spec.threshold ?? 0.99;
}

// ---------- artifact validation ----------
function validateArtifact(rel, kind, threshold) {
  const raw = read(rel);
  if (raw === null || raw.length === 0) return { ok: false, msg: `${rel} is empty` };
  const isJson = rel.endsWith(".json");
  let data = null;
  if (isJson) {
    try { data = JSON.parse(raw); } catch { return { ok: false, msg: `${rel} is not valid JSON` }; }
  }
  if (kind === "score") {
    if (!data || typeof data.score !== "number") return { ok: false, msg: `${rel} has no numeric "score" field` };
    return data.score >= threshold
      ? { ok: true, msg: `score ${data.score} >= ${threshold}` }
      : { ok: false, msg: `${rel}: score ${data.score} is below threshold ${threshold}` };
  }
  if (kind === "vision-met") {
    const met = data ? data.met === true : /\bmet\b\s*[:=]\s*(true|yes)/i.test(raw);
    return met ? { ok: true, msg: "vision verdict met" } : { ok: false, msg: `${rel}: vision verdict is not met:true` };
  }
  if (kind === "recording-clips") {
    const clips = data?.results ?? data?.clips ?? [];
    return Array.isArray(clips) && clips.length >= 1
      ? { ok: true, msg: `${clips.length} clip(s)` }
      : { ok: false, msg: `${rel}: manifest lists 0 clips` };
  }
  // exists-passed
  if (data && typeof data.status === "string" && !["passed", "pass", "ok", "green"].includes(data.status.toLowerCase()))
    return { ok: false, msg: `${rel}: status is "${data.status}", not passed` };
  return { ok: true, msg: "artifact present" };
}

function findTraceTest(id) {
  const re = new RegExp(`@trace\\s+[^\\n]*\\b${id}\\b`);
  const isTestFile = (f) => /\.(test|spec|eval)\.(ts|tsx|js|mjs)$/.test(f);
  for (const dir of ["tests", "test", "lib", "app", "src", "components", "evals", "e2e"]) {
    let hit = null;
    walkAll(dir, (rel) => { if (!hit && isTestFile(rel) && re.test(read(rel) ?? "")) hit = rel; });
    if (hit) return hit;
  }
  return null;
}

function checkArtifact(id, method, spec) {
  if ((spec.artifactCheck ?? "exists-passed") === "trace-test") {
    const hit = findTraceTest(id);
    return hit
      ? { artifact: hit, status: "artifact-ok", msg: `test traced: ${hit}` }
      : { artifact: null, status: "missing-artifact", msg: `no test annotated "@trace ${id}" found — local-verifiable claim has no test` };
  }
  const globs = spec.artifactGlobs ?? [];
  const matches = globs.flatMap(listMatches);
  if (!matches.length)
    return { artifact: null, status: "missing-artifact", msg: `no ${method} artifact found (expected: ${globs.join(" | ") || "(no artifact globs configured)"}) — run the ${method} mechanism and commit its report` };
  const threshold = thresholdFor(id, spec);
  // Evaluate ALL matches — never first-ok-wins. A FRESH artifact that fails
  // validation (e.g. test-results/.last-run.json with status "failed") VETOES
  // the method even when a sibling mere-existence artifact (playwright-report/
  // index.html) is present: a failing run's report is evidence of the run,
  // not of a pass.
  let okFresh = null;
  let freshBad = null;
  let staleBad = null;
  let staleOnly = null;
  for (const f of matches) {
    const ageH = (Date.now() - statSync(join(root, f)).mtimeMs) / 3_600_000;
    const v = validateArtifact(f, spec.artifactCheck ?? "exists-passed", threshold);
    if (v.ok && ageH <= maxAgeHours) okFresh = okFresh ?? { f, msg: v.msg };
    else if (v.ok) staleOnly = staleOnly ?? { f, ageH };
    else if (ageH <= maxAgeHours) freshBad = freshBad ?? v;
    else staleBad = staleBad ?? v;
  }
  if (freshBad) return { artifact: null, status: "failing-artifact", msg: freshBad.msg };
  if (okFresh) return { artifact: okFresh.f, status: "artifact-ok", msg: okFresh.msg };
  if (staleBad) return { artifact: null, status: "failing-artifact", msg: staleBad.msg };
  return {
    artifact: null,
    status: "stale-artifact",
    msg: `${staleOnly.f} is stale (${Math.round(staleOnly.ageH)}h old > ${maxAgeHours}h) — fresh evidence required`,
  };
}

// ---------- run the audit ----------
const entries = []; // { id, method, mechanism, artifact, status, problem? }
for (const [id, c] of contracts) {
  for (const method of [...c.methods].sort()) {
    const spec = tokens[method];
    const entry = { id, method, mechanism: null, artifact: null, status: "ok" };
    const { mechanism, stub } = resolveMechanism(spec);
    entry.mechanism = mechanism;
    if (mode === "existence") {
      if (!mechanism) {
        entry.status = stub ? "stub-mechanism" : "missing-mechanism";
        entry.problem = stub
          ? `declares ${method} but its npm script "${stub.name}" is an echo stub ("${stub.cmd}") — a stub is NOT a mechanism`
          : `declares ${method} but no mechanism exists (looked for npm scripts [${(spec.npmScripts ?? []).join(", ")}] and files [${(spec.scriptGlobs ?? []).join(", ")}])`;
      } else if (spec.needsPlaywright && !playwrightInstalled) {
        entry.status = "missing-playwright";
        entry.problem = `${method} mechanism "${mechanism}" requires playwright in devDependencies — not installed (npm i -D @playwright/test)`;
      } else {
        entry.status = "mechanism-ok";
      }
    } else {
      const r = checkArtifact(id, method, spec);
      entry.artifact = r.artifact;
      entry.status = r.status;
      if (r.status !== "artifact-ok") entry.problem = r.msg;
    }
    entries.push(entry);
  }
}

// Partition problems into FAIL / WAIVED / SKIP-pending.
for (const e of entries) {
  if (!e.problem) continue;
  if (waivedIds.has(e.id)) {
    e.status = "waived";
    waivedLines.push(`WAIVED [${e.id}] ${e.method}: ${e.problem} — suppressed by ${waivedIds.get(e.id)} (visible, never silent)`);
    warn(e.id, `${e.method} failure waived by ${waivedIds.get(e.id)}`);
  } else if (mode === "artifact" && !productCode) {
    // Pre-phase emptiness: the method is declared but the build hasn't started.
    // Visible SKIP-pending, never PASS (qa-verify/gate-status render it SKIP).
    e.status = "skip-pending";
    skips.push(`SKIP-pending [${e.id}] ${e.method}: ${e.problem} (no product code yet — pending, NOT a pass)`);
  } else {
    fail(e.id, `${e.method}: ${e.problem}`);
  }
}

// Untagged MVP FR/NFR rows: at G3 (existence mode) this is a FAIL per the
// requirements-template rule ("undeclared/unknown tags fail
// check-acceptance-methods at G3") — waivable per requirement, never silent.
// In artifact mode it stays a counted WARN (the existence gate already
// enforced it; artifact mode audits the declared contract).
for (const id of untagged) {
  const msg = `untagged: ${id} (MVP) has no verification-class tag — declare one of [${VOCAB.join(" | ")}]`;
  if (mode === "existence") {
    if (waivedIds.has(id)) {
      waivedLines.push(`WAIVED [${id}] ${msg} — suppressed by ${waivedIds.get(id)} (visible, never silent)`);
      warn(id, `untagged-row failure waived by ${waivedIds.get(id)}`);
    } else {
      fail(id, msg);
    }
  } else {
    warn(id, msg);
  }
}

// Unconditional echo-stub scan over battery-conventional npm scripts
// (existence mode). The declared-method join above only sees stubs bound to a
// DECLARED verification class; the pixel run's echo-stub test:e2e sat in a
// battery whose requirements never tagged e2e per-row, so check 1 alone was
// blind to it. A stub named by the qa battery is laundering regardless of
// what the requirements declare.
if (mode === "existence") {
  const batteryNames = new Set(["test", "test:run", "test:unit", "test:integration", "test:e2e", "lint", "build"]);
  for (const cand of ["scripts/qa-verify.mjs", "scripts/qa-verify.reference.mjs"]) {
    const src = read(cand);
    if (src === null) continue;
    for (const m of src.matchAll(/["']run["']\s*,\s*["']([^"']+)["']/g)) batteryNames.add(m[1]);
  }
  for (const name of [...batteryNames].sort()) {
    const body = pkgScripts[name];
    if (typeof body === "string" && STUB_RE.test(body.trim())) {
      fail(`scripts.${name}`, `battery npm script "${name}" is an echo stub ("${body.trim()}") — a stub exiting 0 is laundering, not verification (implement it or remove it from the battery via an explicit waiver)`);
    }
  }
}

// ---------- auto-draft missing-gate-candidate specs (existence failures) ----------
const drafted = [];
if (mode === "existence" && failures.some((f) => f.id !== "config")) {
  const byMethod = new Map();
  for (const e of entries) {
    if (!e.problem || e.status === "waived") continue;
    if (!byMethod.has(e.method)) byMethod.set(e.method, []);
    byMethod.get(e.method).push(e.id);
  }
  mkdirSync(join(root, "trace", "missing-gate-candidates"), { recursive: true });
  for (const [method, ids] of byMethod) {
    const spec = tokens[method];
    const threshold = parseThreshold(ids.map((id) => `${(contracts.get(id)?.texts ?? []).join("\n")}\n${specFullTextById.get(id) ?? ""}`).join("\n"));
    const urls = [...new Set(ids.flatMap((id) => contracts.get(id)?.urls ?? []))];
    const out = `# Missing gate candidate: ${method}

> AUTO-DRAFTED by check-acceptance-methods --mode=existence. A requirement
> declares this acceptance method but no real mechanism exists. Implement the
> mechanism (or obtain a human waiver under docs/qa/waivers/) before Phase 4.

- Method: ${method}
- Declared by: ${ids.join(", ")}
- Threshold: ${threshold !== null ? `${threshold} (parsed from requirement/spec text)` : `${spec.threshold ?? "n/a"} (default — none parsed from text)`}
- Reference URL: ${urls.length ? urls.join(" , ") : "(none found in specs — fill in)"}
- Breakpoints: TODO (e.g. 1440x900, 390x844)
- Masks: TODO (dynamic regions to exclude)
- Expected mechanism: npm script one of [${(spec.npmScripts ?? []).join(", ") || "-"}] or file matching [${(spec.scriptGlobs ?? []).join(", ") || "-"}]
- Expected artifact: ${(spec.artifactGlobs ?? []).join(" | ") || "(define in quality/telemetry.config.json)"}
`;
    const rel = `trace/missing-gate-candidates/${method}.md`;
    writeFileSync(join(root, rel), out);
    drafted.push(rel);
  }
}

// ---------- emit the contract map ----------
mkdirSync(join(root, "trace"), { recursive: true });
const contractsOut = {};
for (const e of entries) {
  if (!contractsOut[e.id]) contractsOut[e.id] = [];
  contractsOut[e.id].push({ method: e.method, mechanism: e.mechanism, artifact: e.artifact, status: e.status });
}
writeFileSync(
  join(root, "trace", "acceptance-contracts.json"),
  `${JSON.stringify({ generatedBy: "scripts/check-acceptance-methods.mjs", mode, productCode, contracts: contractsOut }, null, 2)}\n`,
);

// ---------- report ----------
for (const s of skips) console.log(s);
for (const wline of waivedLines) console.log(wline);
for (const cw of closedWaiverNotes)
  console.log(`note: waiver ${cw.rel} for ${cw.id} is ${cw.status} — no longer suppresses (failure resurfaces if present)`);
for (const w of warnings) console.warn(`WARN  [${w.id}] ${w.msg}`);
for (const f of failures) console.error(`FAIL  [${f.id}] ${f.msg}`);
for (const d of drafted) console.log(`drafted ${d} — implement or waive before Phase 4`);
console.log(`acceptance (${mode}): ${entries.length} contract(s) across ${contracts.size} requirement(s) — ${failures.length} failure(s), ${warnings.length} warning(s), ${skips.length} pending`);

const result = failures.length ? "FAIL" : skips.length ? "SKIP-pending" : "PASS";
console.log(`Result: ${result}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
process.exit(failures.length ? 1 : 0);
