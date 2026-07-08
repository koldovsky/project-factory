# RULES-CHANGELOG — the check promotion/deprecation ledger

Every deterministic check in `scripts/` is registered here with its rung on
the promotion ladder. This ledger is the single place where the gate set is
allowed to change strictness. It implements mechanisms 5 and 7 of
[the reflection design](docs/field-reports/2026-07-02-reflection-mechanism-design.md).

## Ladder rules

1. **Rungs:** `experimental` → `soft` → `hard` → (`deprecated`).
   - `experimental` — runs in the battery, prints its verdict, exit 0 in
     default mode even on NOT-EARNED (never on FAIL of an evaluated guard);
     never prints a PASS it has not earned. CI runs it without `--strict`.
   - `soft` — verdict counted and rendered by gate-status/qa-verify; failures
     warn but do not block merge. (Fail-open emitters live here permanently by
     design — see the ledger row notes.)
   - `hard` — exit code blocks the gate it backs. qa-verify may not print an
     overall Pass while a hard member is FAIL or NOT-EARNED.
2. **Promotion (experimental→soft, soft→hard)** requires, recorded as a new
   row in the history table below: **≥ 2 truthful runs** where the check's
   verdicts were confirmed correct, **0 false positives**, and a link to the
   evidence (run artifacts, field report, or fixture output). No check enters
   `hard` without an **executed red→green proof** (a failing fixture and a
   passing fixture actually run, per mechanism 7 — no decorative checks enter
   the gate set).
3. **Hard-from-day-one is the documented exception**, allowed only when the
   red→green evidence already exists from the field *before* the check ships
   (the check must cite it in its row). Everything else starts `experimental`.
4. **Demotion (`hard` → anything looser) or deprecation of a hard check
   requires an owner-signed entry**: a row in the history table carrying the
   owner's name/handle, the reason, and a link to the waiver artifact under
   `docs/qa/waivers/`. An unsigned demotion is tampering — the integrity lock
   (mechanism 8) treats gate-bearing script drift without a matching
   `Refs: PD-x` commit as a hard red.
5. **Grandfathering:** checks that predate this ledger enter as `hard`
   (grandfathered) because the field study already exercised them red and
   green in real deliveries; their evidence link points at the field reports.
6. Ratchet baselines (`quality/*-baseline.json`) move only via each check's
   `--update` and only in the tightening direction (Zone 2 of the safety
   model). Loosening requires a waiver artifact **and** an owner-signed row
   here.

## Current rung per check

| Check | Status | Since | Evidence | Promotion criterion |
|---|---|---|---|---|
| `check-traceability.reference.mjs` | hard (grandfathered) | 2026-07-03 | [field study](docs/field-reports/2026-07-02-course-field-study.md) | n/a — grandfathered; demotion needs owner-signed row |
| `check-trajectory.reference.mjs` | hard (grandfathered) | 2026-07-03 | [field study](docs/field-reports/2026-07-02-course-field-study.md) | n/a — grandfathered |
| `check-recordings.reference.mjs` | hard (grandfathered) | 2026-07-03 | [field study](docs/field-reports/2026-07-02-course-field-study.md) | n/a — grandfathered |
| `check-coverage-ratchet.reference.mjs` | hard (grandfathered) | 2026-07-03 | [field study](docs/field-reports/2026-07-02-course-field-study.md); loosening hole at former lines 30–33 fixed per design step 4 | n/a — grandfathered |
| `check-eval-ratchet.reference.mjs` | hard (grandfathered) | 2026-07-03 | [field study](docs/field-reports/2026-07-02-course-field-study.md) | n/a — grandfathered |
| `check-a11y.reference.mjs` | hard (grandfathered) | 2026-07-03 | [field study](docs/field-reports/2026-07-02-course-field-study.md) — axe necessary but not sufficient; pairs with vision-verify | n/a — grandfathered |
| `qa-verify.reference.mjs` (battery runner) | hard (grandfathered) | 2026-07-03 | [pixel forensics](docs/field-reports/2026-07-02-pixel-perfect-forensics.md) — gains scope_n parsing, NOT-EARNED forbids "Pass" | n/a — grandfathered |
| `gate-status.reference.mjs` (aggregator) | hard (grandfathered) | 2026-07-03 | [field study](docs/field-reports/2026-07-02-course-field-study.md) — gains three-valued rendering | n/a — grandfathered |
| `check-acceptance-methods.reference.mjs` | **hard from day one** | 2026-07-03 | Documented exception per ladder rule 3: its red→green evidence pre-exists the check — the pixel run, pr13 and pr14 are all red under it ([design, mechanism 2](docs/field-reports/2026-07-02-reflection-mechanism-design.md); [pixel forensics](docs/field-reports/2026-07-02-pixel-perfect-forensics.md)) | n/a — ships hard; demotion needs owner-signed row |
| `check-process-ratchet.reference.mjs` | **experimental** | 2026-07-03 | executed red→green proof: `tests/ratchet.test.mjs` + `tests/fixtures/ratchet/` ([design, mechanism 5](docs/field-reports/2026-07-02-reflection-mechanism-design.md)) | ≥ 2 truthful full-delivery runs with 0 false positives, recorded here; then CI flips `--strict` on |
| `check-visual-fidelity.reference.mjs` | experimental | 2026-07-03 | [design, step 8](docs/field-reports/2026-07-02-reflection-mechanism-design.md); motivated by NFR-19 in the [pixel forensics](docs/field-reports/2026-07-02-pixel-perfect-forensics.md) | ≥ 2 truthful runs, 0 false positives; its report is already consumed by hard `check-acceptance-methods` artifact mode |
| `check-parity-suite.reference.mjs` (multi-layer L1–L5 suite) | **experimental** | 2026-07-08 | multi-layer parity campaign (abstract): [pixel forensics](docs/field-reports/2026-07-02-pixel-perfect-forensics.md) + follow-on; lessons [sampling-blindness](lessons/sampling-blindness/lesson.md) (L2 element / L5 width matrices declare sampling dimension + escalation) and [block-conquest-doctrine](lessons/block-conquest-doctrine/lesson.md) (per-block DoD; full-page scalar demoted to telemetry) | ≥ 2 truthful full-parity runs, 0 false positives; supersedes single-scalar `check-visual-fidelity` as the acceptance instrument |
| `parity-block-loop.reference.mjs` (per-block conquest loop) | **experimental** | 2026-07-08 | [block-conquest-doctrine](lessons/block-conquest-doctrine/lesson.md): per-block definition-of-done (unpaired 0 / geometry 0 / paint 0 / asset 0 / pixel floor) with overlay/onion-skin feedback; [capture-determinism](lessons/capture-determinism/lesson.md) gates each capture first | ≥ 2 truthful runs, 0 false positives; its per-block roll-up feeds `check-parity-suite` |
| `ledger.reference.mjs` (emitter) | soft — **permanently, by design** | 2026-07-03 | [design, mechanism 1](docs/field-reports/2026-07-02-reflection-mechanism-design.md): fail-open telemetry; its CONSUMERS are the hard checks | not on the hard ladder (fail-open by design) |
| `ledger-report.reference.mjs` (digest) | soft | 2026-07-03 | [design, mechanism 6](docs/field-reports/2026-07-02-reflection-mechanism-design.md); the G7 requirement on its *output* is hard with a deterministic fallback | digest stays soft; G7 consumption governed by gate checklist |
| `correct.reference.mjs` (correction-intake) | hard once a correction artifact exists | 2026-07-03 | [design, mechanism 4](docs/field-reports/2026-07-02-reflection-mechanism-design.md): inert with zero corrections; undispositioned corrections render red OPEN-CORRECTION on every gate | n/a — conditional-hard per design |
| `check-factory-integrity.reference.mjs` | hard for gate-bearing script drift; warn-only for workflow files | 2026-07-03 | [design, mechanism 8](docs/field-reports/2026-07-02-reflection-mechanism-design.md): drift without a `Refs: PD-x` commit = tampering; workflow drift stays warn (args-bug fork band must not be punished into disabling the check) | n/a — ships per design; demotion needs owner-signed row |
| `record-demos.reference.mjs` | n/a — artifact producer, not a gate check | 2026-07-03 | produces the manifests that `check-recordings` (hard) validates | not on the ladder |
| `sync-skill-refs.mjs` | n/a — repo-dev tooling, not installed into projects | 2026-07-03 | — | not on the ladder |
| `automations/*` (ci-triage, dep-audit, drift-watch, run) | n/a — automations, not gate checks | 2026-07-03 | — | not on the ladder |

## History (append-only — newest first)

| Date | Check | Change | Evidence | Signed |
|---|---|---|---|---|
| 2026-07-08 | `check-parity-suite` + `parity-block-loop` | registered **experimental** (multi-layer L1–L5 parity + per-block conquest), ported from the parity campaign; promotion criterion recorded | lessons [sampling-blindness](lessons/sampling-blindness/run-fixtures.mjs), [block-conquest-doctrine](lessons/block-conquest-doctrine/run-fixtures.mjs), [capture-determinism](lessons/capture-determinism/run-fixtures.mjs) red→green fixtures; [pixel forensics](docs/field-reports/2026-07-02-pixel-perfect-forensics.md) | — |
| 2026-07-08 | `check-acceptance-methods` (**hard**) | **PD-7**: waiver matcher now keys on waiver STATUS (open vs closed), not mere requirement-id mention — a closed/resolved/expired/revoked waiver stops suppressing and the failure resurfaces with a visible note; missing status stays open (back-compat). Stale closed waivers can no longer launder a live failure. | executed red→green: `tests/pd-fixes.test.mjs` (open suppresses / closed resurfaces / no-status back-compat); grounds in the correction-intake & waiver design ([reflection design, mechanism 4](docs/field-reports/2026-07-02-reflection-mechanism-design.md)) | — |
| 2026-07-08 | `check-recordings` (**hard**) | **PD-4**: renders its OWN three-valued verdict on an empty evidence base — Scope 0 while product code exists (or under `--strict`) is **NOT-EARNED** (exit 1), never a bare PASS; genuine pre-Phase-6 emptiness prints SKIP-pending (exit 0). Closes the vacuous-pass hole in the recordings gate itself. | executed red→green: `tests/pd-fixes.test.mjs`; grounds in [vacuous-pass-not-earned](lessons/vacuous-pass-not-earned/lesson.md) + [pixel forensics RC2](docs/field-reports/2026-07-02-pixel-perfect-forensics.md); `tests/guards.test.mjs` empty-tree assertion updated to SKIP-pending | — |
| 2026-07-03 | `check-process-ratchet` | registered **experimental**; promotion criterion recorded (≥ 2 truthful runs, 0 false positives) | `tests/ratchet.test.mjs` red→green output | — |
| 2026-07-03 | `check-acceptance-methods` | registered **hard from day one** (documented ladder exception) | pixel run + pr13 + pr14 all red under it | — |
| 2026-07-03 | all pre-ledger checks | grandfathered **hard** | field reports of 2026-07-02 | — |
