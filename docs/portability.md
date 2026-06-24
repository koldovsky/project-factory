# Portability — Project Factory in any AI coding tool

Project Factory is **agent-agnostic**. The same spec-driven, gated lifecycle runs
under Claude Code, Cursor, GitHub Copilot, Codex, and any tool that reads
`AGENTS.md` — with **one canonical core** and **thin per-tool entry shims** that
all point back to it. Nothing is re-stated per tool.

## The canonical core (identical everywhere)

- **`AGENTS.md`** — the operating rules + lifecycle. The universal entry; read
  natively by Codex, Cursor, Copilot, Claude Code, and ~24 other tools.
- **`skills/project-factory/SKILL.md`** — the orchestrator. The `SKILL.md` format
  is honored by Claude Code, Cursor, and Copilot; for everything else it's plain
  markdown the agent reads. This is the **skill fallback**.
- **`MASTER-PROMPT.md` + `checklists/quality-gates.md` + `LOOP.md`** — the
  playbook, the gates, the rationale.
- **The deterministic loop** — `scripts/check-*` (traceability, coverage, eval,
  trajectory), git hooks, CI, OpenSpec specs, tests. **Pure Node + git**, so it
  behaves identically in every tool. This is where the framework's guarantees
  live, and it is not tool-specific at all.

## Per-tool entry shims (thin pointers)

| Tool | Entry / install | Rules | Skill | Subagents | Orchestration |
|---|---|---|---|---|---|
| **Claude Code** | `.claude-plugin/` plugin; `/project-factory:init`\|`:onboard` | `AGENTS.md` | native (`skills/`) | native (`.claude/agents/`) | **parallel** Workflow fan-out |
| **Cursor** | `.cursor-plugin/` plugin; `.cursor/rules/project-factory.mdc` | `AGENTS.md` + rule | native (`skills/`) | native (`agents/`) | native subagents (no Workflow fan-out) |
| **GitHub Copilot** | `.github/copilot-instructions.md` + `/project-factory-init`\|`-onboard` prompts | `AGENTS.md` + instructions | `SKILL.md` via `.github/skills` | sequential | sequential passes (fresh context) |
| **Codex** | `AGENTS.md` + `.codex/prompts/*` | `AGENTS.md` (native) | markdown | sequential | sequential passes (fresh context) |
| **Any other** | `AGENTS.md` (+ `SKILL.md`) | `AGENTS.md` | `SKILL.md` | sequential | follow the playbook |

## What's identical vs what degrades (be honest)

**Identical in every tool** — the parts that make it Project Factory:
the numbered requirements, the OpenSpec specs, the gates G0–G8, the `@trace`
chain, the `check-*` ratchets/validators, the evals + trajectory checks, the
test-first discipline, the recordings, and the git-trailer audit trail.

**Differs by tool** — only the *orchestration substrate*:
- **Claude Code** runs the 5 workflows (`spec-pipeline`, `review-gate`,
  `eval-suite`, `trajectory-eval`, `uat-triage`) with **parallel subagent
  fan-out** and adversarial multi-vote verification.
- **Cursor** has native subagents (no Workflow fan-out) — the orchestrator runs
  the dimensions as separate agent calls.
- **Copilot / Codex** have no parallel fan-out — the orchestrator runs review /
  eval / spec / triage as **sequential passes with fresh context**, preserving
  **maker ≠ checker** (the agent that wrote a slice never reviews it) even
  without parallelism.

So the *guarantees* (deterministic gates, specs, evals, trace) are the same
everywhere; only the *speed and concurrency* of the judgment layer vary. That is
the honest trade-off — no tool gets a watered-down loop, just a different
orchestration shape.

## Source access (where the framework files live)

- **Claude Code / Cursor:** the **plugin** provides the skill, commands, and
  agents globally — install once, use in any repo.
- **Copilot / Codex:** no global plugin, so `init` **vendors** the orchestration
  docs into `.project-factory/` in the target repo (playbook, gates, skill,
  commands) and the deterministic loop is copied in as normal project files. The
  repo becomes self-contained.

## Tools without callable slash commands (Codex, etc.)

Some tools (Codex, and any agent that reads `AGENTS.md` but can't invoke
`/project-factory:init`) won't expose the commands as tools. Then:

- **Execute the procedure inline.** Don't skip the loop or approximate it — follow
  `commands/init.md` / `commands/onboard.md` (or `.project-factory/commands/` if
  vendored) step by step. Fail fast: no feature code until the loop is installed.
- **Recordings = local headless Playwright, NEVER an in-app/IDE browser
  connector** (those need a sandbox surface Codex lacks):
  ```bash
  npm i -D @playwright/test @axe-core/playwright
  npx playwright install chromium
  node scripts/record-demos.mjs     # fixed-viewport, asserts FRs, settled stills
  node scripts/check-recordings.mjs  # real video + asserted (not "pending")
  node scripts/check-a11y.mjs        # axe, light + dark
  # then the vision-verify pass — a fresh agent looks at each still
  ```
- **The gates enforce evidence regardless of tool** — `check-trajectory` (clean
  `review-findings.json`), `check-recordings` (real video + `asserted`), the
  ratchets. Sequential maker≠checker is fine; faking artifacts is not.
  `node scripts/gate-status.mjs` summarizes which G0–G8 are truly green vs
  pending/retrofitted.

## Notes

- **Gemini CLI** reads `GEMINI.md`, not `AGENTS.md` — `cp AGENTS.md GEMINI.md`
  (or symlink) if you use it.
- A target repo carries **all** adapters in non-conflicting directories
  (`.claude-plugin/`-delivered, `.cursor/`, `.github/`, `.codex/`, `AGENTS.md`),
  so whichever tool a developer opens, the framework is already wired. Pick a
  subset with `init --tools=…`.
