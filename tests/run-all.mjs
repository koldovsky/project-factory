#!/usr/bin/env node
// run-all.mjs — aggregate test runner for this repo's executed red→green proofs.
//
// Discovers every tests/*.test.mjs, runs each as a child Node process, and
// exits non-zero if ANY test file fails. Each test file is itself a plain,
// self-contained Node script that exits non-zero on assertion failure (the
// proof pattern mandated by the reflection design: every new/changed check
// ships with fixtures that were actually executed red and green).
//
// Usage:  node tests/run-all.mjs      (or: npm test)
// Output: per-file PASS/FAIL lines + a summary; exit 0 only when all pass.
//
// No dependencies — Node >= 18 stdlib only.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

console.log(`Scope: ${files.length} test file(s)`);

// Repo hard rule: every script ships with LF line endings. CRLF crept back
// into edited reference scripts once; keep the invariant executable.
const crlf = [];
const scriptsDir = path.join(path.dirname(testsDir), "scripts");
for (const f of readdirSync(scriptsDir)) {
  if (!f.endsWith(".mjs")) continue;
  if (readFileSync(path.join(scriptsDir, f), "utf8").includes("\r")) crlf.push(`scripts/${f}`);
}
if (crlf.length) {
  console.error(`FAIL  LF-check: CRLF line endings in ${crlf.join(", ")} — normalize to LF (repo hard rule)`);
  console.log("Result: FAIL");
  process.exit(1);
}
console.log("LF-check: scripts/*.mjs are CRLF-free");

const results = [];
for (const file of files) {
  const abs = path.join(testsDir, file);
  const started = Date.now();
  const res = spawnSync(process.execPath, [abs], {
    cwd: path.dirname(testsDir),
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
  });
  const ms = Date.now() - started;
  const code = res.status === null ? 1 : res.status;
  const pass = code === 0;
  results.push({ file, pass, code, ms });
  console.log(`${pass ? "PASS" : "FAIL"}  ${file}  (exit ${code}, ${ms}ms)`);
  if (!pass) {
    // Surface the failing file's full output so the red is diagnosable.
    if (res.stdout) process.stdout.write(indent(res.stdout));
    if (res.stderr) process.stderr.write(indent(res.stderr));
  }
}

const failed = results.filter((r) => !r.pass);
console.log("---");
for (const r of results) {
  console.log(`  ${r.pass ? "ok  " : "FAIL"}  ${r.file}`);
}
console.log(
  `${results.length - failed.length}/${results.length} test file(s) passed`
);
console.log(`Result: ${failed.length === 0 ? "PASS" : "FAIL"}`);
process.exit(failed.length === 0 ? 0 : 1);

function indent(s) {
  return s
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}
