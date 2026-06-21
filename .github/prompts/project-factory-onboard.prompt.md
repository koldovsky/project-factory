---
agent: 'agent'
description: Retrofit Project Factory onto an EXISTING codebase — detect the stack, install the loop non-destructively, reverse-engineer requirements + baseline specs, then govern new work through the gates.
---

Execute the **Project Factory `onboard`** procedure for this existing repository.

Canonical steps: `commands/onboard.md` (+
`skills/project-factory/references/existing-project.md`). Follow them:

1. **Detect the stack** (record ADR-0001; adopt what's there, don't migrate).
2. **Install the loop non-destructively** (merge `.config`/CI/hooks, skip files
   that exist; report added vs skipped).
3. **Reverse-engineer** `docs/requirements.md` + baseline OpenSpec specs from the
   code — every inferred item is an **ASSUMPTION**.
4. **CHECKPOINT — baseline sign-off:** present the inferred requirements/specs +
   coverage/gap report; STOP and wait for the user to confirm or correct.
5. **Govern new work** through the gated per-slice loop.

Onboarding only **documents and installs** — it never rewrites existing code. Run
multi-agent passes sequentially (Copilot has no parallel fan-out; keep maker ≠
checker by using fresh context for review/eval). See `docs/portability.md`.
