// Output routing for automations: "propose, don't push".
// Always writes a committed markdown report; optionally opens a GitHub issue
// (degrades to an INBOX.md backlog when `gh` is unavailable). Never edits code.
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const OUT_DIR = "docs/automations";
const INBOX = join(OUT_DIR, "INBOX.md");

const LEVEL_RANK = { red: 2, warn: 1, info: 0 };
const actionable = (result) => (result.findings ?? []).some((f) => LEVEL_RANK[f.level] >= 1);

function hasGh() {
  const r = spawnSync("gh", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  return r.status === 0;
}

function renderReport(resolved, result, isoDate) {
  const findings = result.findings ?? [];
  const rows = findings.length
    ? findings.map((f) => `| ${f.level} | ${f.check} | ${String(f.detail).replace(/\n/g, " ").slice(0, 300)} |`).join("\n")
    : "| info | (none) | All clear. |";
  return (
    `# Automation: ${result.title ?? resolved.id} (\`${resolved.id}\`)\n\n` +
    `- Generated: ${isoDate}\n` +
    `- Tier: ${resolved.tier ?? "?"}  ·  Result: ${result.red ? "**RED — needs attention**" : result.ok === false ? "**ERROR (automation crashed)**" : "clear"}\n` +
    `- Mode: propose-only (this automation never edits code or merges)\n\n` +
    `## Findings\n\n| Level | Check | Detail |\n|---|---|---|\n${rows}\n` +
    (result.llmSummary ? `\n## Triage summary (cheap model)\n\n${result.llmSummary}\n` : "") +
    ((result.notes ?? []).length ? `\n## Notes\n\n${result.notes.map((n) => `- ${n}`).join("\n")}\n` : "")
  );
}

// resolved: the merged automation config (id, tier, output[]). result: findings payload.
export async function surface(root, resolved, result, opts = {}) {
  const isoDate = opts.date ?? new Date().toISOString();
  const day = isoDate.slice(0, 10);
  mkdirSync(join(root, OUT_DIR), { recursive: true });

  const reportRel = join(OUT_DIR, `${resolved.id}-${day}.md`).replaceAll("\\", "/");
  writeFileSync(join(root, reportRel), renderReport(resolved, result, isoDate));
  const out = { report: reportRel, issue: null, inbox: null, notified: null };

  const wantIssue = (resolved.output ?? []).includes("issue") && actionable(result);
  if (wantIssue) {
    const title = `[automation:${resolved.id}] ${result.title ?? "findings"} (${day})`;
    const body = `Automated finding from \`${resolved.id}\`. Report: \`${reportRel}\`.\n\n${(result.findings ?? [])
      .filter((f) => LEVEL_RANK[f.level] >= 1)
      .map((f) => `- **${f.level}** ${f.check}: ${f.detail}`)
      .join("\n")}\n\n_Propose-only: review and act manually._`;
    if (!opts.noGh && hasGh()) {
      const r = spawnSync("gh", ["issue", "create", "--title", title, "--body", body], {
        cwd: root,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      if (r.status === 0) out.issue = (r.stdout || "").trim();
      else out.inbox = appendInbox(root, day, resolved, reportRel, "gh issue create failed");
    } else {
      // Honest degradation: no gh (or suppressed) → durable local backlog.
      out.inbox = appendInbox(root, day, resolved, reportRel, opts.noGh ? "issue surfacing suppressed" : "gh not available");
    }
  }
  // Connector: post a one-line status to a Slack-compatible webhook when the
  // automation requests "notify" and AUTOMATIONS_WEBHOOK_URL is set. Best-effort
  // and opt-in — the loop-engineering "connectors" primitive for ongoing ops.
  if ((resolved.output ?? []).includes("notify") && actionable(result) && process.env.AUTOMATIONS_WEBHOOK_URL && !opts.noNotify) {
    out.notified = await postWebhook(process.env.AUTOMATIONS_WEBHOOK_URL, resolved, result, reportRel);
  }
  return out;
}

async function postWebhook(url, resolved, result, reportRel) {
  const top = (result.findings ?? [])
    .filter((f) => LEVEL_RANK[f.level] >= 1)
    .slice(0, 5)
    .map((f) => `• ${f.level} ${f.check}`)
    .join("\n");
  const text = `*[automation:${resolved.id}]* ${result.red ? "RED" : "findings"} — ${reportRel}\n${top}`;
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    return res.ok ? "sent" : `failed (${res.status})`;
  } catch {
    return "failed (network)";
  }
}

function appendInbox(root, day, resolved, reportRel, why) {
  const p = join(root, INBOX);
  if (!existsSync(p)) writeFileSync(p, `# Automations inbox\n\nActionable findings awaiting review (${why}).\n\n`);
  appendFileSync(p, `- ${day} **${resolved.id}** → [report](${resolved.id}-${day}.md)\n`);
  return INBOX.replaceAll("\\", "/");
}
