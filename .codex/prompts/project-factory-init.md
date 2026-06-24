---
description: Install the Project Factory loop into this repo (new/greenfield) — idempotent, non-destructive.
argument-hint: "[--with-automations] [--force]"
---

Execute the Project Factory **init** procedure. Canonical steps: `commands/init.md`
(summarized in `AGENTS.md`, which Codex reads natively as the rules).

Install the per-project loop — the deterministic `scripts/check-*`, git hooks,
CI, OpenSpec, and filled templates — **idempotently and non-destructively**
(Gate G0). Then follow `MASTER-PROMPT.md` from Phase 1 under
`checklists/quality-gates.md`.

Codex subagents have no parallel Workflow fan-out, so run the review/eval/spec
passes **sequentially with fresh context** (maker ≠ checker) — but still produce
the real evidence artifacts; the gates check artifacts, not process. For Phase 6
recordings use LOCAL headless Playwright (`npm i -D @playwright/test && npx
playwright install chromium && node scripts/record-demos.mjs`), **never an in-app
browser connector**, then `check-recordings` + `check-a11y` + vision-verify. The
scripts, gates, specs, and evidence are identical to the Claude Code path. See
`docs/portability.md`.
