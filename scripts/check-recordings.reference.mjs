// REFERENCE IMPLEMENTATION — recordings gate (artifacts must be REAL).
//
// The recording manifests under docs/qa/**/manifest.json claim that a clip
// proves some FRs. This validator makes those claims falsifiable: for every
// clip it checks the VIDEO FILE EXISTS, is non-trivial in size, the screenshot
// exists, the flow assertions PASSED, and (when present) the vision verdict is
// met + readable. A manifest that lists clips with no files on disk FAILS here.
//
// This is the real gate. `check-traceability --strict-recordings` is only a
// weak "coverage map" (does an FR id appear in some manifest) — keep both.
//
// Manifest contract (written by scripts/record-demos.mjs):
//   { "kind": "demo"|"bugfix", "results": [ {
//       "id", "title", "proof": "FR-1, FR-2",
//       "video": "docs/qa/.../clip.webm",        // required, must exist + >= minBytes
//       "screenshot": "docs/qa/.../clip.png",     // required, must exist
//       "asserted": true,                          // the recorded flow's assertions passed
//       "vision": { "met": true, "readable": true, "notes": "" }  // optional (check-vision)
//   } ] }
//
// Usage:
//   node scripts/check-recordings.mjs                 # report + exit code
//   node scripts/check-recordings.mjs --min-bytes 20000
//   node scripts/check-recordings.mjs --require-vision   # vision verdict mandatory
//   node scripts/check-recordings.mjs --check-fresh      # committed report must match
//   node scripts/check-recordings.mjs --strict           # Scope 0 => NOT-EARNED even with no product code
//
// PRIME DIRECTIVE (PD-4): this gate renders its OWN verdict on an empty
// evidence base — it never prints a bare PASS over "Scope: 0 clip(s)". When
// product code exists (or under --strict), zero recorded clips is NOT-EARNED
// (exit 1), mirroring the vacuous-pass-not-earned lesson: absence of evidence
// is never rendered as success. Only a genuinely pre-Phase-6 tree (no product
// code, no --strict) prints SKIP-pending (exit 0, visible, still never PASS).
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const argv = process.argv.slice(2);
const flags = new Set(argv);
const flagVal = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const MIN_BYTES = Number(flagVal("--min-bytes", 10000));
const STRICT = flags.has("--strict");
const PATHS = { qaDir: "docs/qa", reportOut: "docs/qa/recordings-report.md" };

// Product-code heuristic (mirrors the vacuity rule): if any of these dirs
// carries source, the build is past Phase 6 and an empty recordings base is
// NOT-EARNED, not "expected before Phase 6".
const CODE_DIRS = ["app", "src", "lib", "server", "packages", "pages", "components"];
const CODE_EXT = /\.(m?[jt]sx?|cjs|py|go|rb|java|cs|php|svelte|vue)$/i;

const failures = [];
const warnings = [];
const rows = [];
const fail = (id, msg) => failures.push({ id, msg });
const warn = (id, msg) => warnings.push({ id, msg });

function* walk(dir, match) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const e of readdirSync(abs)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(join(root, p)).isDirectory()) yield* walk(p, match);
    else if (match(e)) yield p;
  }
}
const sizeOf = (rel) => (existsSync(join(root, rel)) ? statSync(join(root, rel)).size : -1);
function hasProductCode() {
  for (const d of CODE_DIRS) {
    for (const _ of walk(d, (e) => CODE_EXT.test(e))) return true;
  }
  return false;
}

let manifestCount = 0;
let clipCount = 0;
for (const mf of walk(PATHS.qaDir, (f) => f === "manifest.json")) {
  manifestCount += 1;
  let data;
  try {
    data = JSON.parse(readFileSync(join(root, mf), "utf8"));
  } catch {
    fail(mf, "manifest.json is not valid JSON");
    continue;
  }
  for (const r of data.results ?? []) {
    clipCount += 1;
    const id = r.id ?? "(unnamed clip)";
    const video = r.video ?? null;
    const vsize = video ? sizeOf(video) : -1;
    const videoOk = vsize >= MIN_BYTES;
    const shotOk = r.screenshot ? existsSync(join(root, r.screenshot)) : false;
    const asserted = r.asserted === true;
    const vision = r.vision ?? null;
    const visionOk = vision ? vision.met === true && vision.readable === true : null;

    if (!video) fail(id, `${mf}: clip has no "video" path`);
    else if (vsize < 0) fail(id, `video missing on disk: ${video}`);
    else if (!videoOk) fail(id, `video too small (${vsize}B < ${MIN_BYTES}B) — did it actually record? ${video}`);
    if (!shotOk) warn(id, `screenshot missing: ${r.screenshot ?? "(none listed)"}`);
    if (r.status === "pending" || r.pending === true) fail(id, `${id}: status is "pending" — recordings-pending / smoke placeholders are NOT evidence for G6/G7`);
    if (!asserted) fail(id, `${id}: clip is not marked "asserted: true" — the recorded flow did not validate its FRs`);
    if (vision === null && flags.has("--require-vision")) fail(id, `${id}: no vision verdict (run check-vision / the vision-verify workflow)`);
    if (visionOk === false) fail(id, `${id}: vision verdict is not met+readable (${JSON.stringify(vision)})`);

    rows.push({ id, proof: r.proof ?? "", videoBytes: vsize, shotOk, asserted, vision: visionOk });
  }
}

// PD-4 verdict: an empty evidence base is NEVER a bare PASS. Compute the
// three-valued verdict BEFORE rendering so both the report file and stdout
// agree.
const productCode = hasProductCode();
let verdict;
let exitCode;
let notEarnedMsg = null;
if (failures.length) {
  verdict = "FAIL";
  exitCode = 1;
} else if (clipCount === 0) {
  if (STRICT || productCode) {
    verdict = "NOT-EARNED";
    exitCode = 1;
    notEarnedMsg = productCode
      ? `Scope 0: no recorded clips while product code exists (${CODE_DIRS.join("/")}) — recordings NOT-EARNED, never a bare PASS over an empty evidence base`
      : `Scope 0 under --strict: no recorded clips — recordings NOT-EARNED`;
  } else {
    // Genuinely pre-Phase-6: no product code, not --strict. Visible, not PASS.
    verdict = "SKIP-pending";
    exitCode = 0;
  }
} else {
  verdict = "PASS";
  exitCode = 0;
}

if (manifestCount === 0 && verdict !== "NOT-EARNED")
  warn("recordings", `no manifest.json under ${PATHS.qaDir}/ (expected before Phase 6)`);

const report = `# Recordings Report (generated - do not hand-edit)

Generated by \`node scripts/check-recordings.mjs\`. Verifies each recorded clip
is a REAL artifact (video exists + >= ${MIN_BYTES}B, screenshot exists, flow
asserted, vision met) — not just an id mentioned in a manifest.

Scope: ${clipCount} clip(s) across ${manifestCount} manifest(s).
Result: ${verdict}${failures.length ? ` (${failures.length})` : ""}${warnings.length ? `, ${warnings.length} warning(s)` : ""}

| Clip | Proves | Video bytes | Shot | Asserted | Vision |
|---|---|---|---|---|---|
${rows.map((r) => `| ${r.id} | ${r.proof || "-"} | ${r.videoBytes < 0 ? "**MISSING**" : r.videoBytes} | ${r.shotOk ? "yes" : "**no**"} | ${r.asserted ? "yes" : "**no**"} | ${r.vision === null ? "-" : r.vision ? "met" : "**FAIL**"} |`).join("\n")}

## Failures

${failures.length ? failures.map((f) => `- **${f.id}**: ${f.msg}`).join("\n") : "None."}

## Warnings

${warnings.length ? warnings.map((w) => `- **${w.id}**: ${w.msg}`).join("\n") : "None."}
`;

if (flags.has("--check-fresh")) {
  const committed = existsSync(join(root, PATHS.reportOut)) ? readFileSync(join(root, PATHS.reportOut), "utf8") : null;
  if (committed === null) fail("freshness", `${PATHS.reportOut} does not exist — run the validator and commit it`);
  else if (committed.replace(/\r\n/g, "\n") !== report.replace(/\r\n/g, "\n")) fail("freshness", `${PATHS.reportOut} is stale — regenerate and commit`);
} else {
  mkdirSync(join(root, "docs", "qa"), { recursive: true });
  writeFileSync(join(root, PATHS.reportOut), report);
}

for (const w of warnings) console.warn(`WARN  [${w.id}] ${w.msg}`);
for (const f of failures) console.error(`FAIL  [${f.id}] ${f.msg}`);
if (notEarnedMsg) console.error(`NOT-EARNED  [recordings] ${notEarnedMsg}`);
console.log(`\nScope: ${clipCount} clip(s) across ${manifestCount} manifest(s)`);
console.log(`Result: ${verdict}${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
process.exit(exitCode);
