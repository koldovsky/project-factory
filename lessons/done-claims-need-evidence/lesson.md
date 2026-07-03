# Lesson: done-claims-need-evidence (v1)

**Done-claims in prose must carry resolvable evidence pointers.**

## What happened (grounded)

In the pixel-perfect field run, the maker's own narrative supplied the
verdict the gates never computed. From the forensics report
(`docs/field-reports/2026-07-02-pixel-perfect-forensics.md`):

> RC6: "**DONE was declared by unaudited maker narrative.**
> `current-state.md:85` 'Convergence reached — all surfaces now match the
> live site… further passes are verification-only', based on ~6 self-sampled
> computed-style metrics, while line 91 of the SAME file admits the formal
> acceptance was never run. No mechanism cross-checks narrative claims
> against computed gate status."

> "Into that enforcement vacuum, the maker's own narrative supplied the
> verdict: *'Convergence reached… verification-only'*"

The field study distilled the general rule
(`docs/field-reports/2026-07-02-course-field-study.md`, §2.3):

> "**Rule: any lifecycle property the author cares about must be converted
> from prompt instruction into an artifact-existence check with an exit
> code. Soft conventions survive roughly one week of real project
> pressure.**"

## The rule

- Strong completion language in handoff docs ("Convergence reached",
  "verification-only", "all gates pass", "Overall result: Pass", "ready for
  release/sign-off") must sit on the same line as a resolvable evidence
  pointer — a path (e.g. `docs/qa/...`) that exists on disk — or an explicit
  "Scope NOT delivered" qualifier.
- A claim with no pointer is UNBACKED. In gate scripts this stays
  advisory-per-claim but red when the claimed phase exceeds the computed gate
  frontier; in review it is an automatic finding.

## Install

Upsert `payload/agents-block.md` into the target project's AGENTS.md.
Prove the pattern with `run-fixtures.mjs` (red: naked "Convergence reached"
claim must fail; green: claim + existing evidence file passes).
