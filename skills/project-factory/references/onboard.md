<!-- GENERATED MIRROR of commands/onboard.md. Do not edit here — edit the canonical file and run `node scripts/sync-skill-refs.mjs`. Bundled so the skill is self-contained (standalone + plugin). -->

---
description: Retrofit Project Factory onto an EXISTING codebase — detect the stack, install the loop non-destructively, and reverse-engineer requirements + baseline OpenSpec specs from the current code, then govern new work through the gates.
argument-hint: "[--no-reverse]"
---

# /project-factory:onboard — adopt an existing repo

Bring an existing codebase under spec-driven control **without clobbering it**.
Onboarding only DOCUMENTS and INSTALLS — it never rewrites existing code. Full
detail: `${CLAUDE_PLUGIN_ROOT}/skills/project-factory/references/existing-project.md`.

## Steps

1. **Detect the stack** — read `package.json`, framework + version, dir layout,
   test runner, CI. Record as **ADR-0001** (adopt what's there; don't migrate).

2. **Install the loop (non-destructive merge)** — run the `/project-factory:init`
   steps in merge mode: copy agents/workflows/scripts/hooks/CI/OpenSpec/templates,
   wire `package.json` scripts, and install the **multi-tool adapters** (init
   step 10 — `--tools` honored), **SKIPPING anything that already exists** and
   **merging** `.claude/settings.json` / CI / hooks rather than replacing. Adapt
   `qa-verify`'s battery to the scripts the project has. Report **added vs skipped**.

3. **Reverse-engineer the baseline** (skip if `--no-reverse` ∈ `$ARGUMENTS`):
   - `requirements-analyst` (reverse-engineer mode) → `docs/requirements.md` +
     product brief; every row an ASSUMPTION describing current behavior.
   - `spec-writer` (baseline-from-code mode) → baseline OpenSpec specs for current
     behavior (already-implemented).
   - `node scripts/check-traceability.mjs` → baseline coverage + gap report.

4. **CHECKPOINT — baseline sign-off.** Present the inferred requirements + specs +
   coverage/gap report. The user **confirms or corrects** before any of it becomes
   the source of truth. STOP and wait for approval.

5. **Hand off to the orchestrator.** Capability plan for NEW work only; every new
   slice runs the full gated Phase 4 loop (tests-first → implement → review-gate →
   check-trajectory → archive). Legacy code is now in the spec/trace chain. Write
   `.project-factory/retrofit.json` (`{ "slices": [...] }`) listing the onboarded
   baseline slices so `gate-status.mjs` flags their evidence as **retrofitted,
   not earned red-first** — historical red-first history cannot be reconstructed.

With `--no-reverse`: do steps 1–2 + 5 only; govern new slices and leave legacy
code outside the spec chain (lighter — offer it for very large codebases).

**Safety:** read-only toward existing code. Any change to existing behavior is a
later gated slice the user approves — never silent during onboarding.
