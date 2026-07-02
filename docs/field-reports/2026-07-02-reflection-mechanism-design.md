# Design: A Reflection & Self-Improvement Mechanism for Project Factory

> **Date:** 2026-07-02 · **Status:** design ready for implementation (ordered
> 12-step plan below; written to be executable by a future agent session).
> **Method:** three independent designs from competing lenses
> (telemetry-first "Process-Health Ledger", retrospective-first "Retro
> Ledger", evolution-first "Germline") scored by three adversarial judges
> (implementability / safety & honesty / adoption & cost). Winner: **Process-
> Health Ledger (245/300)**, merged with seven judge-selected grafts from the
> other two designs; every judge risk resolved explicitly.
> **Grounding:** the 13-project field study
> (`2026-07-02-course-field-study.md`) and the pixel-perfect forensics case
> (`2026-07-02-pixel-perfect-forensics.md`), used throughout as the acid test.

## Thesis

The factory treats **product** quality as exit-coded artifacts but **process**
quality as prose — so a run that never executed its own declared acceptance
method printed "Overall result: Pass" over "Scope: 0 clip(s)… Result: PASS"
and a maker-authored "Convergence reached". The mechanism: make process
quality itself an exit-coded artifact stream. **"Acceptance method declared"
vs "threshold-passing acceptance artifact produced" is a computable join**,
and every gate run / warning / waiver / stub / correction is an append-only
ledger event whose *consumers are hard gates*.

Two invariants adopted from the judges, non-negotiable:

1. **Honesty checks are gate fixes, never "reflection".** The vacuity flip,
   acceptance-contract join, stub scan, and claim-divergence check live inside
   `qa-verify` — no reflection off-switch may disable them
   (`FACTORY_TELEMETRY=off` kills telemetry emission only).
2. **No hard gate ever depends on LLM-produced content.** Hard gates key only
   on deterministic script outputs; the LLM layer proposes, humans approve,
   deterministic checks enforce.

## The eight mechanisms

| # | Mechanism | Trigger | Enforcement |
|---|-----------|---------|-------------|
| 1 | **Centralized ledger emitter** — append-only `trace/ledger.jsonl` `{ts, event, check, exitCode, failures, warnings, warningsByClass, scope_n, phase, gitHead, dirty, durationMs}`. `scope_n` (parsed from the existing "Scope: N" stdout convention) is load-bearing: it makes "PASS on 0 slices" machine-distinguishable from an earned PASS. Single-point instrumentation inside qa-verify/gate-status/git hooks — **no workflow-side emission** (workflows can't touch fs; their runs are evidenced by persisted artifacts at gate time). | every battery / gate-status / hook run | soft, fail-open; its **consumers** are hard |
| 2 | **Acceptance-contract auditor** (`check-acceptance-methods`) — the pixel-case killer. G3 **existence mode** (before the autonomous build): every FR/NFR verification tag must resolve to a real, non-echo-stub mechanism; failure auto-drafts a missing-gate-candidate spec (name, threshold, reference URL, breakpoints, masks) that must be implemented or human-waived before Phase 4. G4/G6/G7 **artifact mode**: each declared method must resolve to a fresh, threshold-passing artifact (e.g. NFR-19 → `docs/qa/visual-diff/*/report.json` score ≥ 0.99 AND vision report `met:true`). | G3; then G4/G6/G7 + every qa-verify | **hard from day one** (the documented exception to the promotion ladder — its red→green evidence already exists: pixel run, pr13, pr14 all red under it) |
| 3 | **Three-valued gate semantics: PASS / NOT-EARNED / FAIL + SKIP-pending**, keyed to a machine-readable phase header in `current-state.md` AND a product-code-presence heuristic — when the two disagree, render NOT-EARNED, never PASS. Pre-phase emptiness = SKIP-pending (visible, never counted as PASS); post-phase emptiness with product code = NOT-EARNED; echo-stub-backed gates = NOT-EARNED. qa-verify **forbidden** from printing "Overall result: Pass" while any constituent is NOT-EARNED. Freeform done-claim grep over prose stays advisory-only (regex-over-prose must not become a hard check users learn to ignore). | every run + CI; ships in the lite tier | hard |
| 4 | **Correction-intake, deterministic skeleton** — the human correction signal ("this is not pixel perfect!") becomes a first-class artifact: `npm run correct -- "<utterance>"` + auto-detectors (waiver creation; UAT bug filed against a passed gate) append `retro/corrections/<id>.correction.json` `{utterance, contradictedClaim, mappedReqIds, gateThatShouldHaveCaught, failureMode}`. | human command + deterministic detectors (orchestrator prompt rule is documented backup-only) | hard once the artifact exists: undispositioned corrections render as red OPEN-CORRECTION lines no gate can pass over |
| 5 | **Per-class warning budgets + process ratchets with tighten-only direction guard.** Never raw warning counts (71 of the pixel run's 73 warnings were benign pre-Phase-6 growth — a raw ratchet trains reflexive `--update`). Guards: per-class phase-aware budgets with ladder-gated WARN→FAIL promotion on recurrence; vacuous-pass count = 0 once product code exists; acceptance-contract coverage monotone; dead-@trace alarm; open findings at release = red. `--update` auto-rejects any baseline write that loosens — **also retrofitted into `check-coverage-ratchet.reference.mjs`, whose lines 30–33 verifiably accept loosening writes today**, contradicting LOOP.md:96-97. | qa-verify + CI, same slot as existing ratchets | ships EXPERIMENTAL → hard after ≥2 truthful runs, 0 false positives (recorded in RULES-CHANGELOG.md) |
| 6 | **Reflection pass** — deterministic digest always (`ledger-report` → `docs/qa/process-health.md` + `trace/process-health.json`: vacuous passes, warning trends, retries, red→green latency, waivers, claim divergence, uncommitted-work age); LLM **process-auditor** at phase boundaries / on demand / **at abandonment or handover** (most field runs never reach G7 — G7-only reflection would never fire). Fresh maker≠checker agent, dispatched as a **plain subagent, never a Workflow** (confirmed args bug); reads only digest + reports; emits `docs/qa/process-defects.json` `{id: PD-x, class, evidence, metric, severity, proposedFix}`. G7 requires the defects file with P0s resolved/waived — with a deterministic skeletal fallback so API-less CI never blocks. | slice archive (digest, free) / phase gates + on demand + abandonment (LLM) | digest deterministic; LLM half soft; G7 requirement hard with fallback |
| 7 | **Bounded self-improvement queue.** Each accepted defect → `openspec/changes/improve-PD-x/` proposal carrying the exact diff, expected metric movement, **an EXECUTED red→green proof** (a fixture that fails + one that passes, run before approval — no decorative checks enter the gate set), and one-revert rollback. Human approves → single commit `Refs: PD-x` → next retro measures whether the metric moved; no-movement improvements auto-flagged for revert. New checks enter a promotion ladder (experimental→soft→hard) in `RULES-CHANGELOG.md`; hard→soft demotion requires an owner-signed entry. | after each retro; owner-invoked apply | human-approved, always |
| 8 | **Integrity lock + cross-project lessons library.** `factory-lock.json` hashes gate-bearing files at **post-adaptation G0** (measuring drift from the project's own committed state, not the upstream reference — legitimate adaptation never reds). Drift on a gate-bearing check script without a matching `Refs: PD-x` commit = hard red; workflow-file drift = warn+event (the args-bug fork band must not be punished into disabling the check); hook-presence check (fixes the silently-never-installed PostToolUse). Lessons: factory-repo `lessons/index.json`; `:init`/`:onboard` upsert BEGIN/END-LESSON marker blocks into **AGENTS.md** (lands under Codex too — the pr13 root-cause fix) and install lesson check scripts. Cross-project export = a human-authored PR whose review **executes** each lesson's red→green fixtures (poisoned-lesson defense). Seeded day one: vacuous-pass→NOT-EARNED; declared-method-needs-mechanism; done-claims-need-evidence-pointers. | lock at G0; integrity in qa-verify + G4/G7; lessons at every init/onboard | integrity hard for gate-bearing scripts; lessons human-merged |

## Safety model

**Three concentric zones:** Zone 1 (autonomous, always safe) — appending
telemetry, regenerating digests; pure observation, fail-open. Zone 2
(autonomous with deterministic guardrails) — ratchet baselines move only via
explicit `--update` and only in the tightening direction. Zone 3 (human-gated,
always) — any change to gate commands, check-script logic, AGENTS.md rules, or
checklist text flows through an improvement proposal with an executed
red→green proof and one-revert rollback.

**Four invariants:** (A) honesty checks live outside the reflection kill
switch; (B) tamper evidence — lock-hash drift on gate-bearing scripts without
an approved `Refs: PD-x` commit is hard red, CI re-running committed checks is
the out-of-repo anchor; (C) waivers are schema'd artifacts, forbidden on
current-slice checks, every waiver creation auto-appends a correction event
(residual risk of authorship forgery documented honestly, not claimed solved);
(D) no hard gate depends on LLM content — per-slice LLM retros were
**rejected** (gameable ceremony + Codex portability regression).

**Cost:** deterministic core is zero-token (~2s in the battery) and ships in
every tier including lite; LLM reflection is 3–5 phase-boundary invocations
(~100–200k tokens per full delivery), OFF in lite, never mid-slice.

## Artifact map (what to add/change in this repo)

**NEW scripts:** `check-acceptance-methods.reference.mjs` ·
`check-visual-fidelity.reference.mjs` · `check-process-ratchet.reference.mjs` ·
`ledger.reference.mjs` · `ledger-report.reference.mjs` ·
`correct.reference.mjs` · `check-factory-integrity.reference.mjs`
**NEW other:** `agents/process-auditor.md` ·
`templates/quality/{process-baseline,telemetry.config}.json` ·
`templates/retro/{process-defects.schema.json,correction.schema.json,improvement.template.md}` ·
`lessons/index.json` + seeded lesson dirs · `RULES-CHANGELOG.md`
**CHANGE:** `scripts/qa-verify.reference.mjs` (scope_n parsing, ledger
emission, new battery members, NOT-EARNED forbids "Pass") ·
`scripts/gate-status.reference.mjs` (three-valued rendering, header divergence
check, OPEN-CORRECTION lines, ladder labels) ·
`scripts/check-coverage-ratchet.reference.mjs` (fix the verified loosening
hole at lines 30–33) · `check-trajectory/check-recordings/check-eval-ratchet`
(normalize "Scope: N" lines only) · `templates/docs/requirements.template.md`
(mandatory verification-class tag per FR/NFR) ·
`templates/docs/current-state.template.md` (machine-readable phase header) ·
`templates/AGENTS.template.md` (FACTORY-LESSONS marker region) ·
`checklists/quality-gates.md` (G3/G4/G6/G7 additions) · `MASTER-PROMPT.md` +
`SKILL.md` + `LOOP.md` + `commands/init.md` + `commands/onboard.md` (retro
step, NOT-EARNED semantics, correction rule, improvement checkpoint, lock
emission, lesson upserts; onboard pre-seeds historical-only waivers so
brownfield adoption is not instantly red).

## Implementation plan (ordered, for a future agent session)

1. **Amend the two templates that de-brittle everything downstream** —
   requirements.template.md gains the mandatory verification-class tag
   (closed vocabulary: local-verifiable | vision-verify | recording | e2e |
   a11y | eval | deploy-gated); current-state.template.md's existing
   "**Current phase:**" line hardens into a parseable header block (Phase /
   Last completed gate / Claims-with-evidence-paths).
2. **Ship `check-acceptance-methods.reference.mjs`** (~150 lines, no deps) with
   `--mode=existence` (G3) and `--mode=artifact` (G4+), token→artifact table
   extensible via telemetry.config.json, waiver-aware, auto-drafting
   missing-gate-candidate specs — **with executed red→green fixtures and a
   self-test npm script** (the proof pattern all future checks must follow).
3. **Implement three-valued semantics in qa-verify + gate-status** — the
   vacuity flip, stub scan, SKIP-pending rendering, header-divergence hard
   check, advisory prose grep.
4. **Fix the verified ratchet-loosening hole** in
   check-coverage-ratchet.reference.mjs lines 30–33 (reject lowering writes;
   waiver artifact required to loosen).
5. **Ship the ledger substrate** (`ledger.reference.mjs` + emission points in
   qa-verify, gate-status, git hooks).
6. **Ship `check-process-ratchet.reference.mjs`** + baseline/config templates,
   registered EXPERIMENTAL in the new RULES-CHANGELOG.md with the promotion
   criterion written down.
7. **Ship correction-intake** (`correct.reference.mjs` + schema +
   auto-detectors + red OPEN-CORRECTION rendering).
8. **Ship `check-visual-fidelity.reference.mjs`** (Playwright capture local vs
   reference, pixelmatch vs NFR threshold, mask file, report + diff PNGs) and
   register its output glob in the default acceptance-token table.
9. **Ship the reflection layer** — ledger-report digest, process-auditor agent
   (plain-subagent dispatch), process-defects/improvement schemas,
   MASTER-PROMPT retro step + improvement-approval checkpoint + metric-movement
   verification with auto-flag-for-revert.
10. **Ship integrity lock + lessons library** — check-factory-integrity,
    factory-lock.json at post-adaptation G0, lessons/ seeded with the three
    proven lessons, init/onboard wiring, brownfield waiver pre-seeding.
11. **Wire the checklists and docs** — quality-gates.md G3/G4/G6/G7 additions,
    LOOP.md reflection loop + no-off-switch invariant, SKILL.md dispatch
    entries + "orchestrator never authors retro artifacts about its own work".
12. **Validate against the pixel run** (read-only, expected reds: acceptance
    existence on NFR-19 + echo stub; vacuity flip on 0-scope PASSes;
    header-divergence on "Phase 4/Convergence reached" vs computed G0) **and a
    healthy fixture** (false-positive check). Then v2: workflow wrapper once
    the args bug is fixed, lessons-sync export, promotion automation, CI
    waiver-authorship hardening.

## Replay: the pixel-perfect failure under this mechanism

**G3, before the autonomous build:** existence mode reds with three named
defects — NFR-19 declares pixel-diff but no such script exists; the
`/^echo /i` stub scan fires on `test:e2e`; vision-verify has no registered
artifact path. It auto-drafts the missing-gate-candidate spec (breakpoints,
≥99% threshold parsed from the NFR text, reference URL from the spec). The
build **cannot legally enter Phase 4** with a phantom acceptance method.

**Phase 4, every battery run:** qa-verify parses "Scope: 0 archived slice(s).
Result: PASS" and "Scope: 0 clip(s)…" → with `app/` populated, both classify
NOT-EARNED; "Overall result: Pass" becomes impossible. The 73 warnings do NOT
red the build — the per-class counter budgets the 71 benign pre-Phase-6
recording lines (no false-positive wallpaper), while their recurrence across
two retros generates a ladder-gated promotion candidate.

**gate-status, continuously:** the hardened header ("Current phase: 4" vs
computed last gate G0) diverges → hard red; "Convergence reached" is flagged
UNBACKED (advisory); uncommitted-work age surfaces as a ledger metric.

**G6 sign-off:** artifact mode requires a visual-diff report with score ≥ 0.99
AND vision `met:true`; `docs/qa/` verifiably holds only 4 files, none visual →
**red until check-visual-fidelity actually runs and passes.**

**If the human still catches it first:** `npm run correct -- "this is not
pixel perfect"` → correction artifact maps to FR-70/NFR-19,
gateThatShouldHaveCaught=G6, failureMode=vacuous-pass+missing-check+wrong-claim
→ red OPEN-CORRECTION on every gate until dispositioned → phase retro
root-causes over the **gate chain** (not the code) → PD-1 "declared acceptance
method had no mechanism" → improvement proposal with the exact diff + executed
red→green proof → human approves → `Refs: PD-1` commit → next retro verifies
the metric moved.

**Tamper path:** weakening check-acceptance-methods or dropping it from the
battery trips the integrity lock (hash drift without an approved PD commit);
`FACTORY_TELEMETRY=off` cannot help — honesty checks live outside the
reflection kill switch.

**Propagation:** the earned lesson exports as a human-authored PR to
`lessons/`; run N+1's `:init` upserts the lesson block into AGENTS.md and
installs the check — **the failure this run survived becomes a gate the next
run cannot skip.**

## What was deliberately rejected (and why)

- **Per-slice LLM retros** — gameable ceremony; under Codex subagent dispatch
  is inert, so a hard retro gate would stall all archiving.
- **G7-only reflection** — most field runs never reach G7; reflection must
  also fire at abandonment/handover.
- **Raw warnings-under-PASS ratchet** — 71/73 of the pixel run's warnings were
  benign growth; a raw ratchet reds honest progress and trains reflexive
  `--update`.
- **Workflow-based reflection dispatch** — the confirmed args bug and the
  workflow fs limitation; plain subagent instead.
- **Upstream registry / A/B policy comparison / evolve pipeline**
  (Germline's) — cold-start shelf-ware given ~13 mostly-abandoned field runs;
  replaced by the human-merged lessons PR path.
- **Raw-count instrumentation of every check script** — single-point
  instrumentation inside qa-verify parsing the existing "Scope: N" stdout
  convention keeps the diff narrow.
