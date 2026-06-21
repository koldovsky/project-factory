# QA Proof Pack — Document Skeletons

> This single template defines all six documents the qa-documenter agent
> creates under `docs/qa/`. Split into separate files when instantiating.

---

## File 1: `docs/qa/README.md`

```markdown
# QA Proof Pack

Artifacts proving {{PROJECT_NAME}} MVP readiness:

| Artifact | Purpose |
|---|---|
| requirements-traceability-matrix.md | FR/NFR → implementation → tests → evidence |
| manual-test-plan.md | Non-developer-executable test cases |
| demo-script.md | Walkthrough used for demo recordings |
| risk-register.md | Known risks + mitigations |
| mvp-acceptance-report.md | Per-capability acceptance, signature-ready |
| automated-verification-latest.md | Output of `npm run qa:verify` |
| demo-recordings/ | Video + screenshot per capability |
| bugfix-recordings/<date>/ | UAT round proof (when applicable) |
```

---

## File 2: `docs/qa/requirements-traceability-matrix.md`

```markdown
# Requirements Traceability Matrix

| Req | Capability | Implementation | Automated tests | Manual test | Evidence |
|---|---|---|---|---|---|
| FR-1 | identity-and-access | lib/auth/*, app/(public)/login | lib/auth/policy.test.ts | MT-01 | demo-recordings/01-….webm |
| … | | | | | |

Rules: no empty cells — write the explicit reason if something is untested.
NFRs get rows too (where is the budget/policy enforced + measured?).
```

---

## File 3: `docs/qa/manual-test-plan.md`

```markdown
# Manual Test Plan

Environment: {{browser/OS per NFR}}. Test accounts: {{seeded users}}.

## MT-01 {{Title}}
**Covers:** FR-x, FR-y
**Steps:** 1. … 2. … 3. …
**Expected:** {{objectively checkable result}}
**Result:** ☐ Pass ☐ Fail — notes: ______
```

Include NEGATIVE cases: invalid input (oversized, locale decimals, blanks),
unauthorized access per role, deletion of referenced records.

---

## File 4: `docs/qa/demo-script.md`

```markdown
# Demo Script

One scene per capability + one security-negative scene. For each:
**Scene N — {{title}}** (proves FR-…): login as {{role}}, then {{steps}};
the recording must show {{the decisive moment}}.
```

---

## File 5: `docs/qa/risk-register.md`

```markdown
# Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| 1 | {{e.g. email sandbox domain blocks UAT}} | High | Med | {{ops action}} | Open |
```

---

## File 6: `docs/qa/mvp-acceptance-report.md`

```markdown
# MVP Acceptance Report

| Capability | Requirements | Acceptance criteria | Evidence | Accepted |
|---|---|---|---|---|
| {{name}} | FR-… | {{from plan's DoD}} | {{tests + recording links}} | ☐ |

Signature: ______________  Date: ______
```
