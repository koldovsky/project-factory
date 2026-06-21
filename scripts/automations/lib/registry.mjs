// Automations registry: load, validate, and resolve effective config.
// Imported by run.mjs. Pure (no LLM, no network). See automations/README.md.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const REGISTRY_PATH = "automations/registry.json";

export function loadRegistry(root = process.cwd()) {
  const p = join(root, REGISTRY_PATH);
  if (!existsSync(p)) throw new Error(`${REGISTRY_PATH} not found — automations are not installed`);
  let reg;
  try {
    reg = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`${REGISTRY_PATH} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(reg.automations)) throw new Error(`${REGISTRY_PATH} must have an "automations" array`);
  const ids = new Set();
  for (const a of reg.automations) {
    if (!a.id) throw new Error("every automation needs an id");
    if (ids.has(a.id)) throw new Error(`duplicate automation id: ${a.id}`);
    ids.add(a.id);
    if (!a.run && !a.workflow) throw new Error(`automation "${a.id}" needs either "run" or "workflow"`);
  }
  reg.defaults ??= {};
  return reg;
}

// An automation's effective settings = defaults merged with its own overrides
// (budget overrides the matching default keys).
export function resolve(reg, automation) {
  const d = reg.defaults ?? {};
  const b = automation.budget ?? {};
  return {
    ...automation,
    model: b.model ?? d.model ?? "claude-haiku-4-5-20251001",
    maxTokens: b.maxTokens ?? d.maxTokens ?? 20000,
    timeoutSec: b.timeoutSec ?? d.timeoutSec ?? 180,
    writeCode: false, // hard rule: automations never write code, registry cannot override it
    output: automation.output ?? d.output ?? ["report"],
  };
}

// The off gates. Returns { on, reason } so callers can explain a skip.
// Master switch precedence: env AUTOMATIONS_ENABLED=0 hard-kills; =1 forces the
// master ON (so cloud needs only one repo variable); otherwise the registry's
// `enabled` decides. Per-automation `enabled` always still applies.
export function masterOn(reg, env = process.env) {
  if (env.AUTOMATIONS_ENABLED === "0") return false;
  return reg.enabled === true || env.AUTOMATIONS_ENABLED === "1";
}

export function gate(reg, automation, env = process.env) {
  if (env.AUTOMATIONS_ENABLED === "0") return { on: false, reason: "env AUTOMATIONS_ENABLED=0 (hard kill)" };
  if (!masterOn(reg, env)) return { on: false, reason: "registry master switch is off (enabled:false)" };
  if (automation.enabled !== true) return { on: false, reason: `automation "${automation.id}" is disabled` };
  return { on: true, reason: "" };
}

export function find(reg, id) {
  const a = reg.automations.find((x) => x.id === id);
  if (!a) throw new Error(`no automation with id "${id}" (have: ${reg.automations.map((x) => x.id).join(", ")})`);
  return a;
}

// Enabled automations matching a cadence — used by `--all-due --schedule <s>`.
// Cadence comes from the scheduler trigger, so this is stateless.
export function due(reg, schedule, env = process.env) {
  return reg.automations.filter((a) => a.schedule === schedule && gate(reg, a, env).on);
}
