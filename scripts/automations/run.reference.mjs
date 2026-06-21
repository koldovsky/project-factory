// Automations dispatcher. The ONE entry point both adapters call (local OS
// scheduler / `/loop`, and the cloud GitHub Action). Reads the registry,
// enforces the off-switches + budget, runs the job, and routes findings to a
// committed report (+ issue). It NEVER edits code. See automations/README.md.
//
// Usage:
//   node scripts/automations/run.mjs <id>                 # run one now
//   node scripts/automations/run.mjs --all-due --schedule nightly
//   node scripts/automations/run.mjs --list               # status of all
//   node scripts/automations/run.mjs --dry-run <id>       # show, don't run
// Flags: --force (bypass the two registry switches, NOT the env kill-switch),
//        --no-gh (surface to INBOX.md instead of a GitHub issue),
//        --fail-on-red (exit 1 if any red finding — for CI gating).
//
// Copy to scripts/automations/run.mjs.
import { spawnSync } from "node:child_process";
import { loadRegistry, resolve, gate, find, due, masterOn } from "./lib/registry.mjs";
import { surface } from "./lib/surface.mjs";
import { summarize, hasApiKey } from "./lib/llm.mjs";

const root = process.cwd();
const argv = process.argv.slice(2);
const env = process.env;
const hasFlag = (f) => argv.includes(f);
const flagVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

main().catch((e) => {
  console.error(`automations: ${e.message}`);
  process.exit(1);
});

async function main() {
  const reg = loadRegistry(root);
  if (hasFlag("--list")) return list(reg);

  if (hasFlag("--all-due")) {
    const schedule = flagVal("--schedule");
    if (!schedule) return die("--all-due needs --schedule <nightly|weekly|...>");
    const items = due(reg, schedule, env);
    if (!items.length) return console.log(`no enabled automations for schedule "${schedule}"`);
    let anyRed = false;
    for (const a of items) anyRed = (await runOne(reg, a)) || anyRed;
    process.exit(hasFlag("--fail-on-red") && anyRed ? 1 : 0);
  }

  const id = argv.find((a) => !a.startsWith("-") && a !== flagVal("--schedule"));
  if (!id) return die("usage: run.mjs <id> | --all-due --schedule <s> | --list | --dry-run <id>");
  const a = find(reg, id);
  if (hasFlag("--dry-run")) return dryRun(reg, a);
  const red = await runOne(reg, a);
  process.exit(hasFlag("--fail-on-red") && red ? 1 : 0);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function list(reg) {
  const hint = env.AUTOMATIONS_ENABLED === "0" ? "  (env AUTOMATIONS_ENABLED=0 — hard kill)" : env.AUTOMATIONS_ENABLED === "1" ? "  (forced on by env)" : "";
  console.log(`master switch: ${masterOn(reg, env) ? "ON" : "OFF"}${hint}\n`);
  console.log("id".padEnd(14) + "on".padEnd(5) + "tier".padEnd(6) + "schedule".padEnd(16) + "job");
  for (const a of reg.automations) {
    const on = gate(reg, a, env).on ? "yes" : "no";
    const job = a.run ?? `workflow:${a.workflow}`;
    console.log(a.id.padEnd(14) + on.padEnd(5) + String(a.tier ?? "?").padEnd(6) + String(a.schedule ?? "").padEnd(16) + job);
  }
}

function dryRun(reg, a) {
  const r = resolve(reg, a);
  const g = gate(reg, a, env);
  console.log(`dry-run: ${a.id}`);
  console.log(`  would run: ${a.run ?? `workflow ${a.workflow} (${JSON.stringify(a.args ?? {})})`}`);
  console.log(`  gate: ${g.on ? "would run" : `would SKIP — ${g.reason}`}`);
  console.log(`  budget: model=${r.model} maxTokens=${r.maxTokens} timeoutSec=${r.timeoutSec} writeCode=${r.writeCode}`);
  console.log(`  output: ${(r.output ?? []).join(", ")}`);
}

async function runOne(reg, a) {
  // Hard kill via env beats everything, including --force.
  if (env.AUTOMATIONS_ENABLED === "0") {
    console.log(`skip ${a.id}: env AUTOMATIONS_ENABLED=0 (hard kill)`);
    return false;
  }
  if (!hasFlag("--force")) {
    const g = gate(reg, a, env);
    if (!g.on) {
      console.log(`skip ${a.id}: ${g.reason} (use --force to override)`);
      return false;
    }
  }
  const r = resolve(reg, a);
  console.log(`run ${a.id} (tier ${a.tier ?? "?"})…`);

  let result;
  if (a.run) {
    result = await runCommand(a, r);
  } else if (a.workflow) {
    result = invokeWorkflow(a, r);
  } else {
    result = { id: a.id, ok: false, red: true, findings: [{ level: "red", check: "config", detail: "no run or workflow" }] };
  }

  const out = await surface(root, r, result, { noGh: hasFlag("--no-gh") });
  console.log(`  → report ${out.report}${out.issue ? `  issue ${out.issue}` : out.inbox ? `  inbox ${out.inbox}` : ""}`);
  return Boolean(result.red);
}

async function runCommand(a, r) {
  const [cmd, ...args] = a.run.split(/\s+/);
  const res = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: r.timeoutSec * 1000,
  });
  const out = ((res.stdout || "") + (res.stderr || "")).trim();
  if ((res.status ?? 1) !== 0) {
    return { id: a.id, title: a.id, ok: false, red: true, findings: [{ level: "red", check: "execution", detail: out.slice(0, 1000) || "non-zero exit" }] };
  }
  let result;
  try {
    result = JSON.parse((res.stdout || "").trim());
  } catch {
    result = { id: a.id, title: a.id, ok: true, red: false, findings: [{ level: "info", check: "output", detail: out.slice(0, 500) }], notes: ["automation did not emit structured JSON findings"] };
  }
  // Tier-0 escalation: add a cheap summary ONLY when red AND configured AND a key exists.
  if (result.red && a.summarizeOnRed) {
    if (hasApiKey(env)) {
      const prompt = `These automated checks went red. In 2-3 sentences, give the most likely cause and the single most important next action. Findings:\n${JSON.stringify(result.findings, null, 2)}`;
      const summary = await summarize(prompt, { model: r.model, maxOutputTokens: 800, env });
      if (summary) result.llmSummary = summary;
      else (result.notes ??= []).push("no triage summary: model call failed or returned empty");
    } else {
      (result.notes ??= []).push("no triage summary: ANTHROPIC_API_KEY unset (deterministic findings above are complete)");
    }
  }
  return result;
}

// Tier-2: invoking a workflow spends real money and needs the Claude Code
// runtime, so it is GATED behind an extra explicit env flag and is OFF by
// default even when the automation is enabled. Honest scaffolding: logs the
// exact command it would run.
function invokeWorkflow(a, r) {
  const cmd = `claude -p "/${a.workflow} ${JSON.stringify(a.args ?? {}).replace(/"/g, '\\"')}"`;
  if (env.AUTOMATIONS_RUN_WORKFLOWS !== "1") {
    return {
      id: a.id,
      title: `${a.id} (Tier-2, not executed)`,
      ok: true,
      red: false,
      findings: [{ level: "info", check: "tier2-gated", detail: `Tier-2 workflow not run. Set AUTOMATIONS_RUN_WORKFLOWS=1 to enable.` }],
      notes: [`Would run: ${cmd}`, `Budget: maxTokens=${r.maxTokens} timeoutSec=${r.timeoutSec}`],
    };
  }
  const [c, ...args] = cmd.split(/\s+/);
  const res = spawnSync(c, args, { cwd: root, encoding: "utf8", shell: true, timeout: r.timeoutSec * 1000 });
  const out = ((res.stdout || "") + (res.stderr || "")).trim();
  return {
    id: a.id,
    title: `${a.id} (Tier-2 workflow ${a.workflow})`,
    ok: (res.status ?? 1) === 0,
    red: (res.status ?? 1) !== 0,
    findings: [{ level: (res.status ?? 1) === 0 ? "info" : "red", check: "workflow", detail: out.slice(0, 1500) || "(no output)" }],
  };
}
