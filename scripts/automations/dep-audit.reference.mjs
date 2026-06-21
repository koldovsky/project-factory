// Tier-0→1 automation: dependency & security audit. NO LLM itself — runs
// `npm audit` / `npm outdated` and emits findings; run.mjs adds a cheap summary
// only when red (registry: summarizeOnRed). Skips gracefully when there's no
// package.json/lockfile, so it never crashes.
//
// Copy to scripts/automations/dep-audit.mjs.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const findings = [];
const add = (level, check, detail) => findings.push({ level, check, detail });
function npmJson(args) {
  const r = spawnSync("npm", args, { cwd: root, encoding: "utf8", shell: process.platform === "win32", timeout: 120000 });
  const text = (r.stdout || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    return null; // npm prints non-JSON when there's no project — treat as "skip"
  }
}

if (!existsSync(join(root, "package.json"))) {
  add("info", "setup", "skipped: no package.json in this directory");
} else {
  // --- npm audit ---
  const audit = npmJson(["audit", "--json"]);
  const vulns = audit?.metadata?.vulnerabilities;
  if (!vulns) {
    add("info", "audit", "npm audit produced no parseable result (no lockfile yet?)");
  } else {
    const crit = vulns.critical ?? 0;
    const high = vulns.high ?? 0;
    const mod = vulns.moderate ?? 0;
    const low = (vulns.low ?? 0) + (vulns.info ?? 0);
    if (crit + high > 0) add("red", "audit", `${crit} critical, ${high} high vulnerabilit${crit + high === 1 ? "y" : "ies"} — run \`npm audit\` for detail`);
    if (mod > 0) add("warn", "audit", `${mod} moderate vulnerabilit${mod === 1 ? "y" : "ies"}`);
    if (low > 0) add("info", "audit", `${low} low/info advisories`);
    if (crit + high + mod + low === 0) add("info", "audit", "no known vulnerabilities");
  }

  // --- npm outdated (best-effort, non-gating) ---
  const outdated = npmJson(["outdated", "--json"]);
  if (outdated && typeof outdated === "object") {
    const names = Object.keys(outdated);
    const majors = names.filter((n) => {
      const cur = outdated[n].current?.split(".")[0];
      const latest = outdated[n].latest?.split(".")[0];
      return cur != null && latest != null && cur !== latest;
    });
    if (names.length) add(majors.length ? "warn" : "info", "outdated", `${names.length} package(s) outdated${majors.length ? `, ${majors.length} with a new major (${majors.slice(0, 8).join(", ")})` : ""}`);
  }
}

const red = findings.some((f) => f.level === "red");
process.stdout.write(JSON.stringify({ id: "dep-audit", title: "Dependency & security audit", ok: true, red, findings }));
process.exit(0);
