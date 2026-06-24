# Evals — the quality bar

> *"Set the bar at the eval, not the demo."* — the new-SDLC whitepaper.
> Generation is solved; **verification, judgment, and direction are the craft.**

This folder is the framework's **eval layer**: graded quality scenarios that
score the product's behavior and guard that score over time. It does **not**
replace demo recordings — recordings stay as human-facing *illustration*; evals
are the *bar* that decides pass/fail.

## Why evals — three tools, three questions

| Tool | Answers | Good at | Blind to |
|---|---|---|---|
| **Tests** (unit/integration/E2E) | "Is the output *exactly* correct?" | Deterministic logic: totals, redirects, state machines | *Quality* — "is this error message clear?" has no `assertEquals`; pass/fail only, no "82% good" |
| **Demo recordings** | "Did *one* watched run look right?" | Persuading a human; a durable artifact of the happy path | Reliability — one take, not graded, not re-scored; "it looked fine in the demo" is the trap |
| **Evals** | "Across *many* cases, how good is it — and is it staying good?" | Grading *quality* with a rubric; a score you can ratchet | Being the literal source of truth (still needs human-authored rubrics) |

What evals add that we did not have before:

1. **They grade quality, not just correctness.** A judge can score *"is this
   validation message specific, blame-free, and actionable?"* against a rubric.
   A unit test can't. Today the only thing checking our **"errors must surface,
   clearly"** principle and our usability/clarity NFRs is a human watching a
   demo once.
2. **They measure reliability, repeatably.** 30 cases → 28/30 today, 25/30 after
   a refactor = a regression a single happy-path demo never reveals.
3. **They produce a score you can ratchet.** Exactly like the coverage ratchet
   (quality may tighten, never silently loosen), a per-dimension eval score
   becomes a guarded baseline: *"error-clarity was 92; this change dropped it to
   84 → build fails."* Impossible with a demo.

## Output evals vs trajectory evals

- **Output eval** — grade the *result* (the built app's behavior vs a rubric).
  **This is what this folder implements.**
- **Trajectory eval** — grade the *path* (was the route sound?). The framework
  already enforces much of this deterministically: `check-traceability.mjs` +
  the hard gates require *spec → test → review → archive, in order*. Named here;
  extended in a later step.

## How it works here

```
evals/cases/*.eval.ts   the cases (scenario + produce() + rubric + @trace ids)
        │
        ▼  eval-suite workflow  (.claude/workflows/eval-suite.js)
  Collect ─▶ Judge ─────────────▶ Aggregate
            eval-judge agent       per-dimension averages
            (fresh = maker≠checker) │
            borderline → 2nd judge  ▼
                          docs/qa/eval-report.md        (human-readable)
                          evals/results/latest.json     (scores, read by ratchet)
                          evals/results/manifest.json   (ids proven)
        │
        ▼  check-eval-ratchet.mjs   (deterministic, CI-safe, NO API key)
  compares latest.json → quality/eval-baseline.json   (FAIL on a drop)
```

The LLM judging lives in the **workflow** (a fresh `eval-judge` agent — the
maker never grades its own homework). CI runs only the **ratchet**, a plain
exit-coded command against the *committed* score — so "gates are commands with
exit codes" still holds and CI needs no model access. Same shape as recordings:
generated in a phase, committed as evidence, then validated.

## Authoring a case

A case grades quality, so write an **objective rubric**, not an assertion. See
[`cases/sample.eval.ts`](cases/sample.eval.ts) for two worked examples.

```ts
{
  id: 'eval-error-clarity-invalid-input',
  trace: ['NFR-3', 'FR-9'],          // ← also list these in the @trace footer
  dimension: 'error-clarity',         // ← cases sharing a dimension are averaged + ratcheted together
  capability: 'sample',
  scenario: 'Submit the create form with an out-of-range value (e.g. quantity "-1").',
  produce: async () => /* drive the running app / call the service; return the user-visible output */,
  rubric: [
    'CRITICAL: error shown inline, never a generic 500',   // CRITICAL: gates the case
    'message says what is wrong AND what value is acceptable',
  ],
}
```

Guidelines:
- **Pick dimensions deliberately** — one per quality concern (`error-clarity`,
  `usability-clarity`, …). The ratchet guards each separately, so a drop in one
  can't hide behind a high score in another.
- **Mark gating criteria `CRITICAL:`** — any unmet critical fails the case
  outright (score ≤ 49), regardless of the rest.
- **Trace every case** — keep `trace:` and the bottom `// @trace ...` comment in
  sync. That footer is what joins evals to the requirement chain
  (`check-traceability.mjs` scans `*.eval.ts`), finally giving NFRs first-class
  evidence.

## Running

```bash
# 1. Grade (orchestrated; uses the eval-judge agent). Writes the 3 artifacts.
#    Invoke the `eval-suite` workflow (Phase 6, or per-slice in Phase 4).

# 2. Establish or ratchet the baseline, then commit it:
node scripts/check-eval-ratchet.mjs --update

# 3. CI / gate check (no API key): fails if any dimension dropped:
node scripts/check-eval-ratchet.mjs
```

Wire as `eval:run` (the workflow) and `check:eval` (the ratchet). The ratchet
is part of the `qa:verify` battery and the G5/G7 gates.

## Relationship to recordings

**Recordings are kept, unchanged.** An eval and a recording can cover the same
scenario: the eval *scores* it (the bar), the recording *shows* it (the proof a
human watches). The acceptance flow is: eval green → record the representative
case → both linked from the QA pack.
