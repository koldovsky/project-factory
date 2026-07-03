# Lesson: declared-method-needs-mechanism (v1)

**Every declared acceptance method must resolve to an executable mechanism.**

## What happened (grounded)

The pixel-perfect run declared "≥ 99% pixel match" as its acceptance method
and shipped without any tool that could compute it. From the forensics report
(`docs/field-reports/2026-07-02-pixel-perfect-forensics.md`):

> "The failure begins at the **spec-to-verification boundary**: that
> acceptance method was never translated into anything executable — **no
> pixel-diff tool exists in the test run *or in the factory framework
> itself***, Playwright was never installed, `test:e2e` is an echo stub,
> evals are empty, and zero tests trace FR-70/71."

> RC1: "`test:e2e` = `echo … not yet configured` (exit 0 = green) …
> **a spec restating the requirement counted as chain satisfaction.**"

The reflection design makes the fix hard from day one
(`docs/field-reports/2026-07-02-reflection-mechanism-design.md`, mechanism 2):

> "G3 **existence mode** (before the autonomous build): every FR/NFR
> verification tag must resolve to a real, non-echo-stub mechanism …
> The build **cannot legally enter Phase 4** with a phantom acceptance
> method."

## The rule

- Each FR/NFR carries a verification tag (pixel-diff, e2e, recording, ...).
- Before the build starts, every declared tag must resolve to a real,
  non-echo-stub mechanism: an installed check script or a package.json script
  whose body is not `/^echo |^true$|not yet configured/i`.
- A spec file textually mentioning the requirement is NOT a mechanism.

## Install

Upsert `payload/agents-block.md` into the target project's AGENTS.md.
Prove the pattern with `run-fixtures.mjs` (red: pixel-diff declared with no
tool + echo-stub e2e must fail; green: real mechanisms pass). The runner also
executes the sibling `scripts/check-factory-integrity.reference.mjs` stub
scan against both fixtures.
