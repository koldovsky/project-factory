---
description: Retrofit Project Factory onto an EXISTING codebase — detect stack, install the loop non-destructively, reverse-engineer requirements + baseline specs, govern new work.
argument-hint: "[--no-reverse]"
---

Execute the Project Factory **onboard** procedure. Canonical steps:
`commands/onboard.md` (+ `skills/project-factory/references/existing-project.md`).

1. Detect the stack (ADR-0001).
2. Install the loop non-destructively (merge, don't clobber; report added vs skipped).
3. Reverse-engineer `docs/requirements.md` + baseline OpenSpec specs from the code
   — each item an **ASSUMPTION**.
4. **CHECKPOINT — baseline sign-off:** present, STOP, wait for confirmation.
5. Govern new work through the gated per-slice loop.

Onboarding **documents and installs** only — never rewrites existing code. Run
multi-agent passes sequentially (no parallel fan-out; fresh context for review/
eval keeps maker ≠ checker). See `docs/portability.md`.
