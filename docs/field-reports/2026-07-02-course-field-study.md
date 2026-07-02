# Field Study: How Project Factory Behaved Across 13 Real Student Projects

> **Date:** 2026-07-02 · **Method:** 27-agent multi-agent analysis (1 factory deep-map,
> 13 per-submission analysts reading primary artifacts, 12 adversarial verifications,
> 1 synthesis). Subjects: all 13 submissions of the fwdays "Agentic Engineering:
> Greenfield" course homework (`koldovsky/2026-fwdays-agentic-greenfield-task` PRs
> #4–#15 + one off-fork submission). Verification: **11 of 12 load-bearing claims
> CONFIRMED, 1 PARTIAL, 0 refuted.**
>
> This document is written to be actionable by a future improvement session:
> every claim carries the submission it is grounded in.

## TL;DR

The factory **won the war of ideas and lost the war of distribution.** Its
conventions (FR/NFR/TC/BC numbering, `current-state.md` handoff, maker≠checker,
spec→tests→implement→archive) were reproduced **by hand** by 9 of 13 students
who never installed it — while only **one** submission installed it and drove
all three loops. Second, sharper finding: **the deterministic half of the
factory works exactly as designed, and the soft (prompt-convention) half
evaporates under real project pressure — precisely where the architecture
predicted it would.**

---

## 1. Adoption spectrum

| Band | Submissions | Key insight |
|---|---|---|
| **Full factory** — all three loops ran | pr10-polyvaiko | The only one. Delivered the unique promise: the Phase-7 global review caught a cross-slice bug (FR-REM-05 stale count) that 433 tests + E2E structurally could not see. But even the ceiling case forked workflows around the args bug, fixed the CI template, and shipped without the PostToolUse hook (self-modification guard blocked install — nothing flagged the gap). |
| **Deep partial** — slice loop real, heavy tails skipped | pr7-kolo360, pr14-finup | Ran the gated slice loop for real (8 & 10 slices with `review-findings.json`, trailers, red CI runs fixed without weakening gates), skipped recordings/vision/UAT, replaced the eval pipeline with pragmatic vitest harnesses. **This band finds the framework's bugs, because only they push it hard enough.** |
| **Installed ≠ run** | pr13-forgeflow | Full install, genuinely good Phases 0–3 artifacts (41 FRs, strict-validated specs) — then the slice loop, review gate, evals and CI never ran **and the dashboard stayed green**. Under Codex the `.claude` agents/workflows/hooks are inert, and `init` never merged factory rules into `AGENTS.md` — the one file Codex reads natively said nothing about slices, gates or trailers. |
| **Convention mimicry** — factory-shaped loops rebuilt by hand | pr4, pr5, pr6, pr8, pr9, pr15 | Largest band. Reproduced the conventions with high fidelity without installing. Their failures map 1:1 onto the missing mechanical layer: zero tests despite 7 disciplined spec cycles (pr4); review deviations logged but never closed (pr5); an all-green self-checked security checklist beside committed PII (pr15); FR statuses stuck at "proposed" after shipping (pr4, pr6). **Revealed preference: they want roughly the lite third of the factory.** |
| **Mature own-system builders** | pr11-chorddice, taras-gitwarden | Adopted the principles, declined the package, and **out-engineered the inner loop** (Stop hooks, PreToolUse guards with tested guardrails, tiered opus/sonnet teams). GitWarden had the plugin installed, evaluated `:onboard`, and deferred: *"adopt deliberately, on a new feature, not retroactively across 62 phases."* All-or-nothing onboarding is this band's blocker. |
| **Explicit principled rejection** | pr12-hryvnia | ADR-0003: *"a one-command install followed by gate runs demonstrates the ability to operate a framework — not to engineer an agentic workflow… most artifacts would carry no fingerprints of mine."* Then hand-authored a thin equivalent that outperformed most installs (global cold-start review overturned an "accepted trade-off" into a real cross-slice rounding defect). **In attribution-sensitive contexts, turnkey completeness is a liability.** |

## 2. Verified behavior patterns

### 2.1 Hard exit-coded gates, when they actually executed, caught real defects and were never argued with
*(pr10, pr14, pr7, pr12, pr9)* — pr14's coverage ratchet failed CI on a PR
(89.24%→88.16%) and the fix was **new tests, not a weakened ratchet**; pr10's
`--check-fresh` caught a genuinely stale trajectory report; hand-built
exit-coded gates behaved identically (pr12's axe pass found 3 WCAG defects
eight clean manual reviews missed). **The core design bet is validated across
factory and custom loops alike.** Investment should go into widening what is
deterministically checkable — not more prompt prose.

### 2.2 Install ≠ run: graceful pre-phase degradation became camouflage
*(pr13, pr7, pr14)* — pr13: 0 archived slices → `check-trajectory: PASS (1 warning)`;
sample-only evals → ratchet SKIP exit 0; 35 FRs "test-traced" via 29 **bare
`// @trace` comments** after the last test; "Last completed gate: G5" claimed
by narrative alone. pr7: the `@trace` regex cannot match categorized IDs, so all
51 FRs showed "no test annotated" while the gate reported PASS with a
102-warning wall users learn to ignore. pr14: recordings-report PASS with
"0 clip(s) across 0 manifest(s)". **Every "SKIP/warn before Phase N" check
needs a second mode: once product code exists, emptiness must FAIL or render
as a distinct NOT-EARNED state.**

### 2.3 The soft prompt-convention core got skipped exactly where the architecture predicted
*(pr4, pr5, pr7, pr13, pr15, pr6)* — Test-first with no enforcing gate produced
zero tests across 7 disciplined spec cycles (pr4 — every tasks.md "Verification"
accepted `tsc --noEmit` as sufficient). Review evidence not demanded as an
artifact evaporated (pr7 archived two slices without `review-findings.json`
despite commit messages claiming review ran — the checker only warned). Eval
authoring stalled at the sample placeholder (pr7, pr13). **Rule: any lifecycle
property the author cares about must be converted from prompt instruction into
an artifact-existence check with an exit code. Soft conventions survive roughly
one week of real project pressure.**

### 2.4 Students out-engineered the factory's inner loop
*(pr6, pr11, taras-gitwarden, pr10)* — pr6's **Stop hook** runs
tsc/eslint/prettier/vitest at every agent stop, exit 2 blocking completion and
feeding errors back. pr11's PreToolUse guards (R1–R5) hard-block hand-edits to
generated files and banned deps **before they happen**. GitWarden's four
invariant hooks each cite the AGENTS.md rule they enforce and ship with a
26-case red→green guardrail test suite. Meanwhile in the one full factory run,
the factory's own PostToolUse hook **never installed** (self-modification guard)
and nothing flagged it. **Enforcement should move to Stop and PreToolUse
boundaries; G0 must verify hooks actually exist.**

### 2.5 Cost/model tiering emerged spontaneously in every orchestrated submission
*(pr7, pr8, pr11, pr10)* — "Sonnet for the factory, Opus for review" (pr7),
Haiku sub-agent for mechanical extraction (pr8), opus planner/checker +
sonnet implement loop (pr11), "economical review mode" recorded only in the PR
body (pr10). **Model budget is a first-class dimension users decide anyway —
make it declarative and stamp purchased rigor into evidence headers.**

### 2.6 Process evidence died at the submission boundary
*(pr8, pr11, pr13, pr15, pr5, pr4, pr6, pr7)* — four submissions arrived as
single squash commits, erasing trailers and per-slice history; CodeRabbit — the
course's only automated external review — skipped ≥6 submissions on the
150-file cap, **partly inflated by the factory's own installed footprint**.
**The factory needs a portable, committed evidence export and a PR-footprint
budget, or its proof chain evaporates precisely at the moment of evaluation.**

### 2.7 Agent-agnostic in scripts only
*(pr13, pr7, pr10, pr12)* — under Codex the pure-Node checks ran but the 11
agents and 6 workflows produced **zero artifacts**; under Claude Code the
Workflow args bug forced both full runs to fork workflow files (CONFIRMED);
pr12 found project-local agents weren't dispatchable by name and inlined role
definitions into general-purpose subagent prompts. **`portability.md`'s "no
tool gets a watered-down loop" is currently false: the deterministic half
ports, the judgment half silently vanishes.**

### 2.8 Judgment beyond unit gates found the bug classes nothing else could
*(pr10, pr12, pr6, pr8)* — global cold-start review (pr10: FR-REM-05; pr12:
cross-slice rounding defect found by **refusing to trust the maker's
"accepted trade-off"**); real-browser verification (pr6: imperceptible
animation; pr8: hydration-dependent dead clicks in WebKit invisible to
unit/tsc/build). **Both belong in the battery, not the optional tail.**

## 3. Most adoptable student inventions

1. **Stop-hook "definition of done" gate** (pr6, pr11) — add
   `scripts/stop-gate.reference.mjs` + a Stop entry in
   `templates/hooks/claude-code-hooks.json`; document in LOOP.md's inner loop.
2. **PreToolUse invariant guards with a guardrail test harness** (pr11,
   gitwarden) — `templates/hooks/invariants/` + rule: *"a guardrail without a
   red→green proof is not done."*
3. **Finup evidence pack** (pr14) — durable `red-run.json`/`green-run.json`
   ordering evidence, claim-hygiene checker ("full/end-to-end" requires a
   "Scope NOT delivered" section), handoff freshness check, generated slice
   reports, **first-class waiver artifacts** (visible waiver column, never
   silent green).
4. **Tier-0 eval harness** (pr7, pr9, pr12, gitwarden convergence) —
   `*.eval.test.ts` on vitest, offline fixtures default / live opt-in,
   15-line ratchet, rubric hygiene (never grade user-controlled substrings;
   ≥1 adversarial case per rubric).
5. **Human-readable review ledger** (pr9 `review-trace.md`, pr5 deviations
   register, pr10 review-triage, pr7 security-backlog) — cumulative
   Sev/Finding/Resolution table + explicit "accepted as-is" + cross-slice
   deferred-findings sink.
6. **Global cold-start review with anti-rubber-stamp instruction** (pr12,
   pr10) — fresh checkers receive the maker's self-review *explicitly not to
   trust it*, re-run the full battery, re-adjudicate every "accepted"
   disposition.
7. **Mutation gate** (pr5) — "disable one branch — a named test must turn
   red; revert." A suite of assertion-free tests currently passes every
   factory gate.
8. **Marker-block context files + lockfile provenance** (pr4, pr11,
   gitwarden) — named BEGIN/END blocks in AGENTS.md upserted per-block;
   `factory-lock.json` with source ref + content hashes (drift detection AND
   authorship attribution).
9. **Dual-engine browser smoke** (pr8, pr6) — Chromium+WebKit, zero
   console/hydration errors, primary click paths.
10. **Archive distillation** (pr11) — per-feature `summary.md` +
    `decision-log.md` (alternatives considered) generated at archive time,
    alongside (never instead of) raw artifacts.

## 4. Improvement backlog

### P0 — structural
1. **Close the vacuous-pass loophole** *(pr13, pr7, pr14)* —
   `check-trajectory`: FAIL (not warn) when archive is empty but `app/`/`lib/`
   contain implementation; `check-eval-ratchet`: FAIL when only
   `sample.eval.ts` exists beside product code; `gate-status`: render vacuous
   gates as **NOT-EARNED** (never PASS) and cross-check `current-state.md`
   "Last completed gate" claims against computed status.
2. **Fix the `@trace` scanner** *(pr7, pr13 — CONFIRMED bug)* — match
   categorized IDs (`FR-CYCLE-01`), require lexical attachment to an
   `it()/test()` block, join against test-runner output in `--release`, FAIL
   `--check-fresh` when annotations exist but zero join the chain; add a
   self-test fixture.
3. **Fix Workflow args delivery** *(pr7, pr10 — CONFIRMED in both full runs)* —
   repair args propagation or ship an official run-config pattern
   (`RUN_SCOPE` env / `run-config.json`); make slice-diff scoping the default;
   document a thin `_invoke` template so parameterized runs never fork 8KB of
   workflow logic.
4. **Tiered install: `--profile lite|standard|full` + incremental onboard**
   *(9 of 13 submissions hand-built ≈the lite tier; ADR-0003 and gitwarden
   explain why in writing)* — lite = OpenSpec loop + templates + git hooks +
   check-traceability + one composite verify gate + tier-0 evals; onboard
   gains "govern only NEW slices" mode.
5. **CI template green-capable on day one** *(pr10, pr7, pr13, pr14 —
   CONFIRMED failures in every install)* — `fetch-depth: 0` (shallow clone
   hides trailers → false-stale), generate steps from detected package.json
   scripts (no echo-stub steps), detect non-root project dir, gate-status
   checks the repo has ≥1 successful CI run on HEAD.

### P1
6. **Review evidence as hard archive precondition** *(pr7, pr14, pr15, pr5)* —
   FAIL archiving without clean `review-findings.json`; append-only; "0
   findings" recorded explicitly; `security-backlog.md` template as the
   deferred sink; open findings without fix commit or waiver = red at release.
7. **Upstream the Finup evidence pack + waiver schema** *(pr14, pr7)*.
8. **Move the inner loop to turn/tool-call boundaries; fix the hook that
   never installs** *(pr10, pr6, pr11, gitwarden)*.
9. **Portable evidence export surviving squash merges and PR caps** *(8
   submissions affected)* — `export-audit` + known-good `.coderabbit.yaml`
   with path_filters + "never squash the delivery branch" in LOOP.md.
10. **Eval on-ramp: first real eval = one-file change; post-fix re-grading
    required** *(pr7, pr13, pr9, pr12, gitwarden, pr14)*.
11. **Make the non-Claude path real** *(pr13, pr12)* — merge factory rules
    into `AGENTS.md` as a marker block at init (G0 grep-check), exit-coded
    existence checks on judgment artifacts so sequential harnesses face the
    same bar, documented dispatch fallback.

### P2
12. **Declarative model/effort tiers per role, stamped into evidence**
    *(pr7, pr8, pr11, pr10)*.
13. **Real-browser smoke + stack-specific review lenses in the battery**
    *(pr8, pr6, pr7, pr10)*.
14. **Close doc/status drift deterministically** *(pr4, pr6, pr11, pr14,
    gitwarden)* — archived spec deltas referencing FRs still "proposed" = FAIL;
    `check-doc-refs` for dangling paths in prompts/docs.
15. **Authorship/attribution mode + archive distillation** *(pr12, pr4,
    pr11)* — `factory-lock.json`, ADR reuse-boundary template, documented
    thin/pedagogy mode installing mechanisms while the user authors judgment
    pieces.
16. **Split clean-dimension attestations from confirmed findings in
    review-gate** *(pr10 — 5 of 10 "confirmed findings" were N/A-by-design
    notes that each consumed two verifier agents)*.
17. **Mutation/coverage-authenticity step in the review gate** *(pr5, pr12)*.

---

## Appendix: method & verification

- Each submission was analyzed by a dedicated agent reading primary artifacts
  (PR body, repo tree, docs/qa reports, review-findings JSONs, eval cases,
  hook scripts, commit messages) — not file names.
- 131 load-bearing claims were extracted; the 12 highest-impact were
  adversarially verified by independent agents instructed to refute them:
  **11 CONFIRMED, 1 PARTIAL** (pr8's "3-day delivery thanks to DAG waves" —
  speed confirmed, causal attribution weakened), **0 REFUTED**.
- Notable confirmed single facts: the `@trace` regex bug (pr7: 51/51 FRs
  disconnected under a PASS gate); Workflow args forked in both full runs;
  CI template red-by-construction (shallow checkout + stub steps); pr13's
  Codex run produced zero judgment artifacts; pr12's ADR-0003 authorship
  critique quoted verbatim; pr6's Stop-hook mechanism.
