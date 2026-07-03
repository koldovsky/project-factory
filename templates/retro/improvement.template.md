# Improvement Proposal: improve-PD-<x>

> TEMPLATE (mechanism 7 — bounded self-improvement queue). Copy to
> `openspec/changes/improve-PD-<x>/proposal.md`. One proposal per accepted
> process defect. The process-auditor (or a human) DRAFTS this; only a human
> APPROVES it; the change lands as a single commit carrying the trailer
> `Refs: PD-<x>`. Any change to gate commands, check-script logic, AGENTS.md
> rules, or checklist text is Zone 3: it flows through this template or it
> does not happen.

- **Defect:** PD-<x> (`docs/qa/process-defects.json`) — <one-line defect summary>
- **Class / severity:** <vacuous-pass | missing-check | skipped-convention | check-too-weak | wrong-claim | label-drift | process-bypass | stale-evidence> / <P0 | P1 | P2>
- **Status:** draft | approved | landed | reverted

## Scope

What this improvement changes and — just as important — what it deliberately
does NOT change. One defect, one fix, one commit. If fixing PD-<x> tempts you
to touch a second gate, that is a second proposal.

## Target file

`<exact repo-relative path of the ONE gate-bearing file being changed>`

(If more than one file truly must move together, list each and justify why
they cannot land separately. The integrity lock will expect exactly these
files to drift under the `Refs: PD-<x>` commit.)

## Exact diff

```diff
--- a/<target file>
+++ b/<target file>
@@ <hunk header> @@
-<removed line(s)>
+<added line(s)>
```

The diff here is the diff that lands — not a sketch. Reviewers approve THIS
text; drift between the proposal diff and the landed commit is itself a
process defect.

## Expected metric movement

- **Metric:** <process-health metric name, e.g. `vacuousPassCount`>
- **Current:** <value from trace/process-health.json at proposal time>
- **Expected after fix:** <value + direction, e.g. `3 -> 0`>
- **Verified by:** the NEXT retro reads the same metric. **No movement =
  auto-flag this improvement for revert** — decorative checks do not stay in
  the gate set.

## EXECUTED red→green proof

Every new or changed check ships with proof it can actually fail. This
section is filled with REAL, PASTED output — an empty or hand-written proof
section blocks approval.

- **Red fixture:** `tests/fixtures/<component>/red/` — a minimal fake project
  tree on which the changed check MUST exit non-zero.
- **Green fixture:** `tests/fixtures/<component>/green/` — the same tree with
  the defect absent; the check MUST exit 0.
- **Test:** `node tests/<component>.test.mjs` (plain Node, self-contained,
  exits non-zero on failure).

```text
<paste the actual test run output here — the run must have been EXECUTED
before approval, not promised for later>
```

## Rollback (one revert)

- **Single commit:** yes — the whole improvement is one commit; rollback is
  exactly `git revert <sha>`.
- **State to clean up on revert:** <none | list any baseline/report files the
  check writes that a revert leaves behind>
- **Ladder position:** experimental | soft | hard (new checks enter at
  experimental per RULES-CHANGELOG.md; promotion needs >=2 truthful runs with
  0 false positives; hard->soft demotion requires an owner-signed entry).

## Approval & trailer convention

- Human approver: <name> · Date: <YYYY-MM-DD>
- Commit message MUST end with the trailer line: `Refs: PD-<x>`
  (the integrity lock treats gate-bearing drift WITHOUT a matching
  `Refs: PD-x` commit as hard red — the trailer is what makes this change
  legal, so it goes on the commit that contains the diff, not a follow-up).
