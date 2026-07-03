# Quality Gates G0–G8

Hard exit criteria per phase of `MASTER-PROMPT.md`. A gate passes only when
EVERY criterion holds. Record each gate's passage in `docs/current-state.md`
and a git commit.

**Gates are commands.** Each gate lists its deterministic command set —
every command must exit 0. Judgment criteria (reviews, sign-offs) sit ON TOP
of green commands, never instead of them. A red command is a STOP; fixing
the check is allowed, weakening or bypassing it is not.

**Gates are three-valued.** Checks print `PASS`, `FAIL`, `NOT-EARNED`, or
`SKIP-pending` — absence of evidence is never success. Pre-phase emptiness
renders as an explicit `SKIP-pending`; emptiness once product code exists
renders as `NOT-EARNED`, and no overall "Pass" may be printed over a
NOT-EARNED constituent.

**Ratchets are tighten-only.** Every baseline under `quality/`
(coverage, eval, process) moves only via its check's `--update` and only in
the tightening direction — a loosening `--update` is auto-rejected (exit 1,
baseline untouched). The ONLY way to loosen is a waiver artifact under
`docs/qa/waivers/` naming the check and metric(s), plus an owner-signed row
in `RULES-CHANGELOG.md`; a waived loosening still prints a loud WARN. Every
waiver is itself a correction event — it never disappears into silence.

## G0 — Scaffold & environment

```bash
npm run lint && npm run build
git config core.hooksPath           # must print .githooks
git commit --allow-empty -m "chore: verify hooks fire"   # hooks must run
```

- [ ] Project scaffolds; commands above green.
- [ ] **The loop is installed** (MASTER-PROMPT 5b): git hooks (pre-commit +
      commit-msg), Claude Code PostToolUse hook, CI workflow file,
      `scripts/check-traceability.mjs` + `scripts/check-coverage-ratchet.mjs`
      + `scripts/check-eval-ratchet.mjs` + `evals/` (cases dir + README)
      in place.
- [ ] `AGENTS.md` + `CLAUDE.md` in place; stack ADR(s) written in `docs/adr/`.
- [ ] OpenSpec initialized (`openspec/project.md`, empty `openspec/specs/`).
- [ ] All `package.json` scripts wired (placeholders allowed, documented).
- [ ] `.env.example` documents every variable incl. email-sandbox warning.
- [ ] Git initialized, initial commits made.

## G1 — Product framing

- [ ] `docs/product-brief.md` and `docs/requirements.md` exist.
- [ ] Every requirement numbered (FR/NFR/TC/BC) and phase-tagged (MVP/Future).
- [ ] All clarification questions answered or defaulted with user consent.
- [ ] **User signed off on scope** (checkpoint 1).

## G2 — Baseline specs

```bash
npx openspec validate --all --strict
node scripts/check-traceability.mjs        # spec-mention check: every MVP FR cited
```

- [ ] One spec per capability under `openspec/specs/`; commands green.
- [ ] spec-pipeline coverage check: every MVP FR in exactly one spec; no
      contradictions; error-path scenarios present.

## G3 — Capability plan

```bash
node scripts/check-acceptance-methods.mjs --mode=existence
```

- [ ] `docs/mvp-capability-plan.md` complete: slice table, dependency graph,
      per-slice scope/DoD/risks, FR coverage table proving no gaps/duplicates.
- [ ] Dependency graph is acyclic; critical path identified.
- [ ] **Acceptance-contract existence check green:** every Verification tag
      declared on an FR/NFR in `docs/requirements.md` (closed vocabulary:
      `local-verifiable | pixel-diff | vision-verify | recording | e2e | a11y
      | eval | deploy-gated`) resolves to a REAL, non-echo-stub mechanism in
      this repo. **Red means a declared acceptance method has no mechanism**
      — a phantom method the build would otherwise "pass" without ever
      running (the pixel-perfect failure). On red the check auto-drafts
      `trace/missing-gate-candidates/<method>.md` (name, threshold parsed
      from the requirement text, reference URL, breakpoints/masks
      placeholders): implement that check, or human-waive it via
      `docs/qa/waivers/`, BEFORE Phase 4 may start. The build cannot legally
      enter the autonomous loop with a phantom acceptance method.
- [ ] **User approved the plan** (checkpoint 2).

## G4 — Per slice (repeat for every slice)

```bash
npm run lint && npm run test:run && npm run build
npx openspec validate --all --strict
node scripts/check-traceability.mjs        # ticked tasks, FR chain, @trace coverage
node scripts/check-trajectory.mjs          # review evidence clean, Slice: trailer, scope
node scripts/check-acceptance-methods.mjs --mode=artifact   # declared methods -> fresh, threshold-passing evidence
node scripts/check-process-ratchet.mjs     # EXPERIMENTAL — run WITHOUT --strict until promoted (RULES-CHANGELOG.md)
node scripts/check-factory-integrity.mjs   # gate-bearing scripts unchanged, or changed via an approved Refs: PD-x commit
```

- [ ] Change folder validated strictly before implementation started.
- [ ] All tasks.md checkboxes ticked, truthfully (validator enforces after archive).
- [ ] Tests written FIRST from the spec and observed to FAIL (red), then made to
      pass (green) by implementation — authored before the implementer ran; no
      test weakened to go green.
- [ ] Unit tests added for all new pure domain logic (incl. locale/edge
      inputs), each annotated `@trace FR-x`.
- [ ] Eval case(s) authored for the slice's key error-surface / qualitative
      NFR behavior (`evals/cases/*.eval.ts`, rubric + `@trace`); graded in G6.
- [ ] Smoke flow executed and passed — real-DB if the stack has a DB, else a
      service/integration smoke of the slice's operations (stack-driven).
- [ ] `review-gate` workflow run; ALL confirmed (and contested) findings fixed;
      commands re-run green. Reviewer agents ≠ implementer agent.
- [ ] Review evidence persisted (`openspec/changes/<slice>/review-findings.json`,
      `clean:true`) and `check-trajectory` green (in-scope, `Slice:` trailer).
- [ ] No server action in the slice can 500 on user input; no silent external
      failures; forms keyed by server state.
- [ ] Change archived, `openspec list` shows no active changes,
      `docs/current-state.md` updated, slice committed with
      `Slice:`/`Refs:` trailers (commit-msg hook enforces).

## G5 — Cross-cutting hardening

```bash
npm run qa:verify                          # full battery, writes evidence report
npm run test:coverage && node scripts/check-coverage-ratchet.mjs --update
```

- [ ] Integration test(s) cover the cross-slice business flow (local dates!).
- [ ] E2E covers auth + RBAC negative cases, core flow, downloads
      (content-verified), responsive breakpoints if in scope.
- [ ] Seed helper is idempotent AND re-pins baseline state every run.
- [ ] Coverage baseline committed (`quality/coverage-baseline.json`) — the
      ratchet guards it from here on.

## G6 — QA proof pack

```bash
node scripts/check-acceptance-methods.mjs --mode=artifact
node scripts/check-process-ratchet.mjs     # experimental — no --strict yet
node scripts/check-factory-integrity.mjs
```

- [ ] **Every declared acceptance method has produced its artifact** —
      artifact mode joins each Verification tag to a fresh, threshold-passing
      evidence file (e.g. a pixel-fidelity NFR →
      `docs/qa/visual-diff/*/report.json` with score ≥ threshold via
      `node scripts/check-visual-fidelity.mjs`, AND a vision report with
      `met:true`). Spec text restating the requirement does not count.
- [ ] Traceability matrix: every MVP FR/NFR has implementation + test +
      evidence cells filled (or an explicit reason).
- [ ] Manual test plan executable by a non-developer; demo script written.
- [ ] Risk register and acceptance report drafted.
- [ ] **Eval suite run** (`eval-suite` workflow); `docs/qa/eval-report.md`
      reviewed; every eval case passes its rubric (failures fixed, never
      waived); judge-disagreement cases resolved.
- [ ] **Eval baseline committed** (`quality/eval-baseline.json` via
      `node scripts/check-eval-ratchet.mjs --update`) — the ratchet guards it
      from here on. Recordings illustrate representative eval cases; the eval
      decides pass/fail.
- [ ] Recordings are AUTOMATED + headless (`scripts/record-demos.mjs`, never the
      user's browser, no save dialog); each clip ASSERTS the FRs it proves. One
      clip per capability + security-negative; one clip per viewport (no mid-clip
      resize).
- [ ] `node scripts/check-recordings.mjs` green: every clip has a real video on
      disk (non-trivial size) + screenshot + `asserted:true` — not just an id in
      a manifest (`check-traceability --strict-recordings` is only a coverage map).
- [ ] **Vision-verified:** the `vision-verify` workflow passed — a fresh agent
      looked at every settled still and judged it met + readable; any miss was
      fixed → re-recorded → re-verified until met.
- [ ] **a11y gate** (UI projects): `node scripts/check-a11y.mjs` green in BOTH
      light and dark (WCAG-AA incl. contrast). axe is necessary but not
      sufficient — the vision pass above is its human-eye pair.
- [ ] Responsive E2E checks cover REPRESENTATIVE STATES (e.g. with the
      fullest data variant on screen), not just the default page.
- [ ] `npm run qa:verify` report regenerated and all-green.

## G7 — Global review & release

```bash
npm run qa:verify
node scripts/check-traceability.mjs --release --strict-tests --strict-recordings
node scripts/check-traceability.mjs --check-fresh
node scripts/check-trajectory.mjs --release --check-fresh
node scripts/check-acceptance-methods.mjs --mode=artifact
node scripts/check-process-ratchet.mjs --release   # experimental — no --strict yet; --release also reds open review findings
node scripts/check-factory-integrity.mjs
node scripts/correct.mjs --check           # zero undispositioned corrections
npm audit --audit-level=high
```

- [ ] Global `review-gate` run over the whole codebase; all confirmed
      findings fixed; commands green.
- [ ] **Process-defects reviewed:** `docs/qa/process-defects.json` exists
      (authored by the `process-auditor` retro, or the deterministic
      `ledger-report` fallback when no LLM is available) and every P0 defect
      is resolved or explicitly waived (`docs/qa/waivers/`). A missing
      defects file is a red — the release retro is part of the release.
- [ ] **No OPEN corrections:** every `retro/corrections/*.correction.json`
      carries a disposition (`resolved | waived | invalid`). An
      undispositioned correction renders as a red OPEN-CORRECTION line no
      gate may pass over.
- [ ] **Committed-evidence boundary:** every claim in
      `docs/current-state.md` and the release report points at evidence that
      is COMMITTED (reports, recordings, baselines, ledger, lock). Evidence
      that exists only in a working tree does not exist at G7 — CI re-running
      the committed checks is the out-of-repo anchor that makes local claims
      verifiable.
- [ ] Eval ratchet green (`check:eval`, part of `qa:verify`): no dimension
      dropped below the committed baseline.
- [ ] Trajectory: `check-trajectory --release` green; `trajectory-eval`
      workflow run and `docs/qa/trajectory-eval-report.md` reviewed (failing
      judgements addressed).
- [ ] Authz matrix verified per route × role; no secrets in repo/history;
      error-surface audit clean.
- [ ] NFRs resolved by class: `local-verifiable` NFRs actually verified (a11y,
      contrast, validation, budgets measurable locally); `deploy-gated` NFRs
      (Lighthouse, p95 TTFB, uptime) marked **pending live measurement** in the
      gate output — explicit, never silently skipped or used to block.
- [ ] `docs/technical/` complete; estimation + delivery report written.
- [ ] CI green on the release commit (the loop nobody can skip).
- [ ] Deployed; live URL smoke-checked (status, no localhost leakage, clean
      error logs); deployment recorded in current-state.
- [ ] Committed and pushed (push target approved by user).

## G8 — UAT round (repeat per bug report)

```bash
npm run qa:verify
node scripts/check-traceability.mjs        # every BUG-x fix has a @trace'd regression test
```

- [ ] Every reported bug has a verdict citing requirements
      (uat-triage workflow), low-confidence verdicts double-checked.
- [ ] Confirmed defects clustered by mechanism; each fix covers the class,
      including latent locations.
- [ ] Every fix has a regression test referencing the bug; quality defects
      (unclear errors, confusing empty/error states) also get a regression eval
      case (`@trace BUG-x`).
- [ ] Full battery green; original reproduction steps re-tested live.
- [ ] Bug-fix proof recordings: clip + screenshot + md explainer per fixed
      bug; README index; non-recordable bugs explained in README.
- [ ] Customer bug-fix report written (traceability, root causes, evidence,
      ops actions, effort log); handoff updated; deployed and production
      verified to serve the new build.
