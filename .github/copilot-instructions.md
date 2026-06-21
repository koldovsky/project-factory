# Project Factory — Copilot instructions

This repository uses **Project Factory**, a spec-driven multi-agent delivery
framework. Follow it:

- Read **`AGENTS.md`** (repo root) for the operating rules and the lifecycle —
  it is the canonical, tool-agnostic entry.
- The full playbook is `MASTER-PROMPT.md`; the hard gates are
  `checklists/quality-gates.md`; the orchestrator is
  `skills/project-factory/SKILL.md`.
- To run it, use the prompt files (Copilot Chat `/`):
  - **`/project-factory-init`** — install the loop into this repo (new project).
  - **`/project-factory-onboard`** — retrofit an existing codebase (detect stack,
    install the loop non-destructively, reverse-engineer requirements + baseline
    specs).

The deterministic loop (`scripts/check-*`, OpenSpec specs, gates, evals,
trajectory checks, tests) is identical across tools. Copilot lacks Claude Code's
**parallel** subagent fan-out, so run the review-gate / eval / spec passes
**sequentially with fresh context** — the agent that wrote a slice never reviews
it (maker ≠ checker). Scripts, gates, specs, and evidence are unchanged. See
`docs/portability.md`.
