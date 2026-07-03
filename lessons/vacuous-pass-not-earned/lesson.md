# Lesson: vacuous-pass-not-earned (v1)

**A PASS over zero evidence is NOT-EARNED, never PASS.**

## What happened (grounded)

In the pixel-perfect field run, every deterministic check hit an empty
evidence base and — by design — treated emptiness as "expected before
Phase 6". From the forensics report
(`docs/field-reports/2026-07-02-pixel-perfect-forensics.md`):

> "When gates were consulted, every deterministic check hit this empty
> evidence base and — by design — treated emptiness as 'expected before
> Phase 6': warns and SKIPs, all exit 0. `gate-status.mjs`'s `worst()` folds
> SKIP into PASS, so **G4–G8 rendered green over literally nothing**."

> "a run that never executed its own declared acceptance method printed
> 'Overall result: Pass' over 'Scope: 0 clip(s)… Result: PASS'"
> (reflection-mechanism design, Thesis)

The field study names this the #1 structural fix
(`docs/field-reports/2026-07-02-course-field-study.md`, P0-1):

> "Close the vacuous-pass loophole … `gate-status`: render vacuous gates as
> **NOT-EARNED** (never PASS) and cross-check `current-state.md` 'Last
> completed gate' claims against computed status."

## The rule

A check must never render absence of evidence as success:

- **Pre-phase emptiness** (no product code yet) = `SKIP-pending`, printed
  explicitly and visibly — never counted as PASS.
- **Post-phase emptiness** (product code exists, evidence scope is 0) =
  `NOT-EARNED` / FAIL, exit non-zero.
- Aggregators (`gate-status`, `qa-verify`) are forbidden from folding SKIP or
  0-scope results into an overall "Pass".

## Install

Upsert `payload/agents-block.md` between its BEGIN/END markers into the
target project's AGENTS.md. Prove the pattern with `run-fixtures.mjs`
(red: product code + zero evidence must fail; green: real evidence passes).
