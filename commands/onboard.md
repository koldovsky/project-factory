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
   steps in merge mode: copy agents/workflows/scripts/hooks/CI/OpenSpec/templates
   — including the reflection layer (init steps 3, 3b, 8b, 9: acceptance/
   visual/process/integrity checks, ledger + digest, correction intake, retro
   schemas, `process-auditor` agent, lesson upsert into `AGENTS.md`) — wire
   `package.json` scripts, and install the **multi-tool adapters** (init
   step 10 — `--tools` honored), **SKIPPING anything that already exists** and
   **merging** `.claude/settings.json` / CI / hooks rather than replacing. Adapt
   `qa-verify`'s battery to the scripts the project has. Report **added vs skipped**.

2b. **Pre-seed historical-only waivers (so brownfield is not instantly red).**
   Legacy code has no red-first history, no acceptance artifacts, and no
   ledger — without waivers the honesty checks would render the whole
   baseline NOT-EARNED on day one and train the team to ignore red. For each
   BASELINE-ONLY gap (never for new work):
   - `docs/qa/waivers/<date>-baseline-<req-id>.md` naming the requirement id
     and stating `historical-only: pre-onboarding baseline; evidence cannot
     be reconstructed` (check-acceptance-methods renders these as visible
     WAIVED lines + counted warnings, not silent passes);
   - ratchet loosenings, if any legacy baseline must start below current
     state, as `docs/qa/waivers/*.json` `{check, metric(s), reason}`.
   Then run `node scripts/correct.mjs --detect` — waiver creation
   auto-appends correction events by design — and disposition each as
   `waived` with note `historical-only brownfield baseline`. The user
   confirms this waiver set at the baseline sign-off checkpoint (step 4);
   every waiver stays visible in gate output forever. New slices get ZERO
   pre-seeded waivers.

2c. **Integrity lock (post-adaptation G0).** After the merge + waiver
   pre-seed, run `node scripts/check-factory-integrity.mjs --init-lock
   --adaptation "<note per adaptation>"` and commit `factory-lock.json` —
   drift is measured against THIS repo's own adapted state, so onboarding
   adaptations never red.

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
