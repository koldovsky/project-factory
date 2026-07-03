// REFERENCE IMPLEMENTATION — correction intake + auto-correction detectors.
//
// Mechanism 4 of the reflection design (docs/field-reports/
// 2026-07-02-reflection-mechanism-design.md): the human correction signal
// ("this is not pixel perfect!") becomes a first-class, APPEND-ONLY artifact
// under retro/corrections/ that no gate can pass over until dispositioned.
// Also exports detectAutoCorrections(root) — deterministic detectors for
// (a) waiver files created under docs/qa/waivers/ and (b) UAT bug files under
// docs/qa/uat/ that mention a gate id — consumed by gate-status to render
// red OPEN-CORRECTION lines.
//
// Copy to scripts/correct.mjs in the new project and wire as:
//   "correct": "node scripts/correct.mjs"
//
// Usage:
//   node scripts/correct.mjs "<utterance>" [--claim <file:line>]
//        [--req FR-1,NFR-2] [--gate G6] [--failure-mode <mode>]
//   node scripts/correct.mjs --detect   # append corrections for new detector events
//   node scripts/correct.mjs --check    # report-only: exit 1 on OPEN-CORRECTION
//                                       # or unrecorded detector events
//
// Honesty note (the prime directive): --check exiting 0 on an empty tree is
// NOT a vacuous pass — the subject of this check is correction signals, and
// "zero open corrections after a real scan" is the earned good state. The
// scan itself is the evidence, and the output says explicitly what was
// scanned and found.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FAILURE_MODES = ["vacuous-pass", "missing-check", "skipped-convention", "check-too-weak", "wrong-claim"];
export const GATE_IDS = ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"];
const CORRECTIONS_DIR = join("retro", "corrections");

// Embedded mirror of templates/retro/correction.schema.json — used only when
// the authored schema file cannot be found next to this script or in-project.
export const EMBEDDED_SCHEMA = {
  type: "object",
  required: ["id", "ts", "utterance", "contradictedClaim", "mappedReqIds", "gateThatShouldHaveCaught", "failureMode", "source", "autoKey", "disposition"],
  properties: {
    id: { type: "string", pattern: "^COR-\\d+$" },
    ts: { type: "string" },
    utterance: { type: "string" },
    contradictedClaim: { type: ["string", "null"] },
    mappedReqIds: { type: "array", items: { type: "string", pattern: "^(FR|NFR|BC)-\\d+$" } },
    gateThatShouldHaveCaught: { type: ["string", "null"], enum: [...GATE_IDS, null] },
    failureMode: { type: "string", enum: FAILURE_MODES },
    failureModeSource: { type: "string", enum: ["heuristic", "explicit", "detector"] },
    source: { type: "string", enum: ["human", "auto-waiver", "auto-uat-bug"] },
    autoKey: { type: ["string", "null"] },
    disposition: {
      type: ["object", "null"],
      required: ["status", "by", "ts"],
      properties: {
        status: { type: "string", enum: ["resolved", "waived", "invalid"] },
        by: { type: "string" },
        ts: { type: "string" },
        note: { type: "string" },
      },
    },
  },
};

export function loadSchema(root) {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(root, "retro", "correction.schema.json"),
    join(root, "templates", "retro", "correction.schema.json"),
    join(here, "..", "templates", "retro", "correction.schema.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        return JSON.parse(readFileSync(c, "utf8"));
      } catch {
        /* fall through to embedded */
      }
    }
  }
  return EMBEDDED_SCHEMA;
}

// --- Tiny stdlib JSON-schema-subset validator: required + type + enum + pattern.
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function validateNode(value, schema, path, errors) {
  if (!schema || typeof schema !== "object") return;
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null;
  const t = typeOf(value);
  if (types && !types.includes(t) && !(t === "number" && types.includes("integer") && Number.isInteger(value))) {
    errors.push(`${path}: expected type ${types.join("|")}, got ${t}`);
    return;
  }
  if (value === null) return; // nullable and null — nothing further to check
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum [${schema.enum.filter((e) => e !== null).join(", ")}]`);
  }
  if (schema.pattern && t === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (t === "array" && schema.items) {
    value.forEach((item, i) => validateNode(item, schema.items, `${path}[${i}]`, errors));
  }
  if (t === "object") {
    for (const req of schema.required ?? []) {
      if (value[req] === undefined) errors.push(`${path}: missing required field "${req}"`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (value[k] !== undefined) validateNode(value[k], sub, `${path}.${k}`, errors);
    }
  }
}

export function validateAgainstSchema(obj, schema) {
  const errors = [];
  validateNode(obj, schema, "$", errors);
  return errors;
}

// --- Deterministic auto-correction detectors (consumed by gate-status too).
// Event = { type, path, autoKey, gateIds, suggestedFailureMode, suggestedUtterance }
export function detectAutoCorrections(root = process.cwd()) {
  const events = [];
  const waiverDir = join(root, "docs", "qa", "waivers");
  if (existsSync(waiverDir)) {
    for (const f of readdirSync(waiverDir).sort()) {
      const abs = join(waiverDir, f);
      if (!statSync(abs).isFile() || f.startsWith(".")) continue;
      const rel = `docs/qa/waivers/${f}`;
      events.push({
        type: "waiver-created",
        path: rel,
        autoKey: `waiver-created:${rel}`,
        gateIds: [],
        suggestedFailureMode: "skipped-convention",
        suggestedUtterance: `AUTO: waiver created (${rel}) — an evidence requirement was waived; record why and disposition this correction.`,
      });
    }
  }
  const uatDir = join(root, "docs", "qa", "uat");
  if (existsSync(uatDir)) {
    for (const f of readdirSync(uatDir).sort()) {
      const abs = join(uatDir, f);
      if (!statSync(abs).isFile() || !f.endsWith(".md")) continue;
      let content = "";
      try {
        content = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const gates = [...new Set(content.match(/\bG[0-8]\b/g) ?? [])].sort();
      if (gates.length === 0) continue; // a UAT note that names no gate is not a correction event
      const rel = `docs/qa/uat/${f}`;
      events.push({
        type: "uat-bug-vs-gate",
        path: rel,
        autoKey: `uat-bug-vs-gate:${rel}`,
        gateIds: gates,
        suggestedFailureMode: "check-too-weak",
        suggestedUtterance: `AUTO: UAT bug ${rel} filed against gate(s) ${gates.join(", ")} that had rendered PASS — the gate let a defect through.`,
      });
    }
  }
  return events;
}

// --- Correction store (append-only).
export function readCorrections(root = process.cwd()) {
  const dir = join(root, CORRECTIONS_DIR);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".correction.json")) continue;
    const rel = `retro/corrections/${f}`;
    try {
      out.push({ file: rel, data: JSON.parse(readFileSync(join(dir, f), "utf8")) });
    } catch (e) {
      out.push({ file: rel, data: null, parseError: String(e.message ?? e) });
    }
  }
  return out;
}

function nextSeq(root) {
  const dir = join(root, CORRECTIONS_DIR);
  let max = 0;
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const m = /^(\d+)-/.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "correction";

export function heuristicFailureMode(utterance) {
  const u = utterance.toLowerCase();
  if (/vacuous|pass(ed)?\s+(on|over|with)\s+(nothing|empty|no |zero|0 )/.test(u)) return "vacuous-pass";
  if (/(no|missing|never)\s+\w*\s*(check|test|tool|script|mechanism)|(check|test|tool|script)\s+(is |was )?(missing|never ran|doesn'?t exist)/.test(u)) return "missing-check";
  if (/skipp?ed|bypass|outside the (loop|process|slice)|didn'?t follow|without review/.test(u)) return "skipped-convention";
  if (/too (weak|lenient|low|loose)|threshold|barely caught|should have failed/.test(u)) return "check-too-weak";
  return "wrong-claim";
}

// Append a new correction artifact. Never overwrites: if the computed path
// exists (concurrent writer), the sequence advances until a free slot.
export function writeCorrection(root, record) {
  const dir = join(root, CORRECTIONS_DIR);
  mkdirSync(dir, { recursive: true });
  let seq = Number(/^COR-(\d+)$/.exec(record.id)?.[1] ?? nextSeq(root));
  let file;
  for (;;) {
    file = `${String(seq).padStart(3, "0")}-${slugify(record.utterance)}.correction.json`;
    if (!existsSync(join(dir, file))) break;
    seq += 1;
  }
  const final = { ...record, id: `COR-${seq}` };
  writeFileSync(join(dir, file), JSON.stringify(final, null, 2) + "\n");
  return { file: `retro/corrections/${file}`, record: final };
}

// --- CLI ---------------------------------------------------------------
const USAGE = `Usage:
  node scripts/correct.mjs "<utterance>" [--claim <file:line>] [--req FR-1,NFR-2] [--gate G6] [--failure-mode <${FAILURE_MODES.join("|")}>]
  node scripts/correct.mjs --detect
  node scripts/correct.mjs --check`;

function die(msg) {
  console.error(`FAIL  ${msg}`);
  console.error(USAGE);
  console.log("Scope: 0 correction(s)");
  console.log("Result: FAIL");
  process.exit(1);
}

function runIntake(root, opts, schema) {
  const utterance = (opts.utterance ?? "").trim();
  if (!utterance) die("an utterance is required (quote the human correction verbatim)");
  let claim = null;
  if (opts.claim != null) {
    if (!/:\d+$/.test(opts.claim)) die(`--claim must be <file>:<line>, got "${opts.claim}"`);
    claim = opts.claim;
  }
  let reqIds = [];
  if (opts.reqRaw != null) {
    reqIds = opts.reqRaw.split(",").map((s) => s.trim()).filter(Boolean);
    for (const r of reqIds) if (!/^(FR|NFR|BC)-\d+$/i.test(r)) die(`--req ids must look like FR-1/NFR-2/BC-3, got "${r}"`);
    reqIds = reqIds.map((r) => r.toUpperCase());
  }
  let gate = null;
  if (opts.gate != null) {
    if (!GATE_IDS.includes(opts.gate.toUpperCase())) die(`--gate must be one of ${GATE_IDS.join(", ")}, got "${opts.gate}"`);
    gate = opts.gate.toUpperCase();
  }
  let failureMode = null;
  if (opts.failureMode != null) {
    if (!FAILURE_MODES.includes(opts.failureMode)) die(`--failure-mode must be one of ${FAILURE_MODES.join(", ")}, got "${opts.failureMode}"`);
    failureMode = opts.failureMode;
  }
  const record = {
    id: `COR-${nextSeq(root)}`,
    ts: new Date().toISOString(),
    utterance,
    contradictedClaim: claim,
    mappedReqIds: reqIds,
    gateThatShouldHaveCaught: gate,
    failureMode: failureMode ?? heuristicFailureMode(utterance),
    failureModeSource: failureMode ? "explicit" : "heuristic",
    source: "human",
    autoKey: null,
    disposition: null,
  };
  const errors = validateAgainstSchema(record, schema);
  if (errors.length) die(`intake record failed schema validation:\n  ${errors.join("\n  ")}`);
  const { file, record: final } = writeCorrection(root, record);
  console.log("Scope: 1 utterance(s)");
  console.log(`Recorded ${file} (id ${final.id}, failureMode ${final.failureMode}${final.failureModeSource === "heuristic" ? " [heuristic — override with --failure-mode]" : ""})`);
  console.log(`OPEN-CORRECTION ${final.id}: undispositioned — gates render red over it until a human sets disposition.`);
  console.log("Result: PASS");
  process.exit(0);
}

function runDetect(root, schema) {
  const events = detectAutoCorrections(root);
  const corrections = readCorrections(root);
  const recorded = new Set(corrections.map((c) => c.data?.autoKey).filter(Boolean));
  console.log(`Scope: ${events.length} detector event(s)`);
  let appended = 0;
  const failures = [];
  for (const ev of events) {
    if (recorded.has(ev.autoKey)) {
      console.log(`already recorded: ${ev.autoKey}`);
      continue;
    }
    const record = {
      id: `COR-${nextSeq(root)}`,
      ts: new Date().toISOString(),
      utterance: ev.suggestedUtterance,
      contradictedClaim: null,
      mappedReqIds: [],
      gateThatShouldHaveCaught: ev.gateIds[0] ?? null,
      failureMode: ev.suggestedFailureMode,
      failureModeSource: "detector",
      source: ev.type === "waiver-created" ? "auto-waiver" : "auto-uat-bug",
      autoKey: ev.autoKey,
      disposition: null,
    };
    const errors = validateAgainstSchema(record, schema);
    if (errors.length) {
      failures.push(`detector record for ${ev.path} failed schema validation: ${errors.join("; ")}`);
      continue;
    }
    const { file, record: final } = writeCorrection(root, record);
    appended += 1;
    console.log(`Recorded ${file} (id ${final.id}, source ${final.source})`);
  }
  for (const f of failures) console.error(`FAIL  ${f}`);
  if (appended > 0) console.log(`${appended} new correction(s) appended — they are OPEN until a human dispositions them.`);
  else if (events.length === 0) console.log("no waiver or UAT-vs-gate events found under docs/qa/.");
  console.log(`Result: ${failures.length ? "FAIL" : "PASS"}`);
  process.exit(failures.length ? 1 : 0);
}

function runCheck(root, schema) {
  const events = detectAutoCorrections(root);
  const corrections = readCorrections(root);
  const failures = [];
  const recorded = new Set(corrections.map((c) => c.data?.autoKey).filter(Boolean));
  for (const ev of events) {
    if (!recorded.has(ev.autoKey)) {
      failures.push(`[${ev.type}] ${ev.path}: auto-correction event has no correction artifact — run: node scripts/correct.mjs --detect`);
    }
  }
  for (const c of corrections) {
    if (c.data === null) {
      failures.push(`[${c.file}] not valid JSON (${c.parseError}) — a correction artifact must never be hand-mangled`);
      continue;
    }
    const errors = validateAgainstSchema(c.data, schema);
    if (errors.length) failures.push(`[${c.file}] schema violation: ${errors.join("; ")}`);
    else if (c.data.disposition === null) {
      const short = c.data.utterance.length > 70 ? `${c.data.utterance.slice(0, 67)}...` : c.data.utterance;
      failures.push(`OPEN-CORRECTION ${c.data.id}: "${short}" (${c.file}) — undispositioned; no gate may pass over it`);
    }
  }
  console.log(`Scope: ${events.length + corrections.length} correction signal(s)`);
  if (events.length + corrections.length === 0) {
    console.log("scanned retro/corrections/, docs/qa/waivers/, docs/qa/uat/ — no corrections recorded and no auto-correction events detected.");
  }
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.log(`Result: ${failures.length ? `FAIL (${failures.length})` : "PASS"}`);
  process.exit(failures.length ? 1 : 0);
}

function main() {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const opts = { detect: false, check: false, claim: null, reqRaw: null, gate: null, failureMode: null, utterance: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--detect") opts.detect = true;
    else if (a === "--check") opts.check = true;
    else if (a === "--claim") opts.claim = argv[++i];
    else if (a === "--req") opts.reqRaw = argv[++i];
    else if (a === "--gate") opts.gate = argv[++i];
    else if (a === "--failure-mode") opts.failureMode = argv[++i];
    else if (a.startsWith("--")) die(`unknown flag "${a}"`);
    else if (opts.utterance === null) opts.utterance = a;
    else die(`unexpected extra argument "${a}" — quote the utterance as ONE string`);
  }
  const schema = loadSchema(root);
  if (opts.check) return runCheck(root, schema);
  if (opts.detect) return runDetect(root, schema);
  return runIntake(root, opts, schema);
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main();
