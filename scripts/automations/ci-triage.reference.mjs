// Tier-1 automation: CI-failure triage. Given a failed CI log, one capped
// Haiku call hypothesizes the cause and the most important next action.
// Degrades honestly: with no ANTHROPIC_API_KEY it still ships the failing log
// tail as the finding (no summary). The canonical Loop Engineering automation.
//
// Input (first available): `--log <file>` · env CI_LOG_PATH · `--stdin`.
// Copy to scripts/automations/ci-triage.mjs.
import { readFileSync, existsSync } from "node:fs";
import { summarize, hasApiKey } from "./lib/llm.mjs";

const argv = process.argv.slice(2);
const flagVal = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const lastLines = (s, n) =>
  s
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n)
    .join("\n");

let log = "";
const logPath = flagVal("--log") ?? process.env.CI_LOG_PATH;
if (logPath && existsSync(logPath)) log = readFileSync(logPath, "utf8");
else if (argv.includes("--stdin")) {
  try {
    log = readFileSync(0, "utf8");
  } catch {
    /* no stdin */
  }
}

const result = { id: "ci-triage", title: "CI failure triage", ok: true, red: false, findings: [] };

if (!log.trim()) {
  result.findings.push({ level: "info", check: "input", detail: "no CI log provided (pass --log <file>, CI_LOG_PATH, or --stdin)" });
} else {
  const tail = log.slice(-12000);
  result.red = true;
  if (hasApiKey()) {
    const prompt =
      `You are triaging a FAILED CI run for a TypeScript/Next.js project. From the log tail, give: (1) the single most likely root cause, (2) the most important next action. 3-5 sentences, concrete, no preamble.\n\nLog (tail):\n${tail}`;
    const summary = await summarize(prompt, { maxOutputTokens: 700, model: process.env.AUTOMATIONS_MODEL });
    if (summary) {
      result.llmSummary = summary;
      result.findings.push({ level: "red", check: "ci-failure", detail: "CI run failed — see triage summary below" });
    } else {
      result.findings.push({ level: "red", check: "ci-failure", detail: lastLines(tail, 6) });
      result.notes = ["no triage summary: model call failed or returned empty"];
    }
  } else {
    result.findings.push({ level: "red", check: "ci-failure", detail: lastLines(tail, 6) });
    result.notes = ["no triage summary: ANTHROPIC_API_KEY unset (failing log tail above)"];
  }
}

process.stdout.write(JSON.stringify(result));
process.exit(0);
