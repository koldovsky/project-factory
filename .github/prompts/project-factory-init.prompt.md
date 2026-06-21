---
agent: 'agent'
description: Install the Project Factory loop into this repository (new/greenfield) — scripts, hooks, CI, OpenSpec, templates, agents — idempotent and non-destructive.
---

Execute the **Project Factory `init`** procedure for this repository.

The canonical steps are defined once in `commands/init.md` (and summarized in
`AGENTS.md`) — follow them, do not re-invent them:

- Install the per-project loop: the deterministic `scripts/check-*`, git hooks,
  CI, OpenSpec, and filled templates — **idempotent and non-destructive**
  (skip/merge, never clobber). This is **Gate G0**: no feature work before it
  exists.
- Then follow `MASTER-PROMPT.md` from Phase 1, honoring
  `checklists/quality-gates.md` (G1–G8).

Copilot has no parallel Workflow fan-out: run the review-gate / eval / spec
steps as **sequential passes with fresh context** (the agent that wrote a slice
never reviews it). The scripts, gates, specs, and evidence are identical to the
Claude Code path. See `docs/portability.md`.
