# Self-Improvement — Operator Guide

How to run the factory's reflection cycle end-to-end, what each artifact is,
and what the off-switch does (and deliberately cannot do). Design rationale:
[the reflection mechanism design](field-reports/2026-07-02-reflection-mechanism-design.md);
motivating failure:
[the pixel-perfect forensics](field-reports/2026-07-02-pixel-perfect-forensics.md).

All commands below run in a **target project** where `init`/`onboard`
installed the layer (reference scripts copied to `scripts/*.mjs`, npm scripts
wired). In this repo itself, the same logic runs as `.reference.mjs` files
and is proven by `npm test` (tests/run-all.mjs → 7 red→green suites).

## The cycle at a glance

```
correct ──▶ digest ──▶ auditor ──▶ improvement ──▶ approval ──▶ lock
(intake)   (ledger-    (process-   (improve-PD-x   (human,      (factory-
           report)     auditor)    proposal +      Refs: PD-x   lock.json
                                   red→green       commit)      re-init)
                                   proof)
                 ▲                                              │
                 └── next retro verifies the metric moved ──────┘
                     (no movement = auto-flag for revert)
```

### 1. Correct — capture the contradiction

When reality contradicts a factory claim, make it an artifact immediately:

```bash
npm run correct -- "this is not pixel perfect" --req NFR-19 --gate G6 --failure-mode vacuous-pass
node scripts/correct.mjs --detect    # deterministic detectors: waiver created, UAT bug vs passed gate
node scripts/correct.mjs --check     # red while any correction is undispositioned
```

Corrections are append-only under `retro/corrections/`. The ONLY permitted
mutation is a human setting the `disposition` object
(`resolved | waived | invalid`) by editing the artifact. Until then, every
gate renders a red OPEN-CORRECTION line.

### 2. Digest — deterministic, free, always available

```bash
npm run retro:digest        # node scripts/ledger-report.mjs
```

Reads `trace/ledger.jsonl` (+ acceptance contracts + corrections) and writes
`docs/qa/process-health.md` + `trace/process-health.json`: vacuous passes,
NOT-EARNED counts, warning trends by class, retries per check, red→green
latency, waivers, claim divergence, uncommitted-work age, open corrections.
Empty ledger + product code present = NOT-EARNED (exit 1) — a silent
never-instrumented project cannot look healthy.

### 3. Auditor — LLM half, phase boundaries only

At phase gates, on demand, and **at abandonment/handover**, dispatch
`agents/process-auditor.md` (delivered to `.claude/agents/`) as a **plain
subagent — never a Workflow** (confirmed args bug). It reads only the digest
+ `docs/qa/` reports + corrections and writes `docs/qa/process-defects.json`
(`PD-x` entries with evidence, metric, severity, proposedFix). The
orchestrator never authors retro artifacts about its own work.

No LLM available (API-less CI)? `ledger-report` writes a deterministic
skeletal `process-defects.json` fallback, so G7 never blocks on an API key.
An auditor-authored file is never clobbered by the fallback.

### 4. Improvement — bounded queue, executed proof

Each accepted defect becomes `openspec/changes/improve-PD-x/` from
`templates/retro/improvement.template.md`: the exact diff, the expected
metric movement, an **EXECUTED red→green proof** (a fixture that fails + one
that passes, actually run before approval), and a one-revert rollback plan.

### 5. Approval — the named human checkpoint

A human approves; the change lands as a **single commit** carrying
`Refs: PD-x`. New checks enter `RULES-CHANGELOG.md` as `experimental` and
climb the ladder (`experimental → soft → hard`) only after ≥ 2 truthful runs
with 0 false positives. The **next retro** verifies the metric moved;
no-movement improvements are auto-flagged for revert.

### 6. Lock — make the improvement tamper-evident

If the improvement touched a gate-bearing file, the `Refs: PD-x` commit is
exactly what `check-factory-integrity` looks for — drift WITH such a commit
is approved; drift without one is a hard red. After intentional
re-adaptation, re-baseline: `node scripts/check-factory-integrity.mjs
--init-lock --adaptation "<note>"`.

## The artifacts

| Artifact | Written by | What it is |
|---|---|---|
| `trace/ledger.jsonl` | `ledger.mjs` (called from battery/gates/hooks) | append-only process event stream; `scope_n` distinguishes earned PASS from PASS-on-nothing |
| `docs/qa/process-health.md` + `trace/process-health.json` | `ledger-report.mjs` | the deterministic digest (human + machine forms) |
| `docs/qa/process-defects.json` | process-auditor (or deterministic fallback) | PD-x defects; G7 requires it with P0s resolved/waived |
| `retro/corrections/*.correction.json` | `correct.mjs` (human intake + detectors) | first-class contradiction records; red until dispositioned |
| `trace/acceptance-contracts.json` | `check-acceptance-methods.mjs` | the declared-method → mechanism/artifact join, per requirement |
| `trace/missing-gate-candidates/*.md` | `check-acceptance-methods.mjs` (on G3 red) | auto-drafted spec for each phantom acceptance method |
| `quality/telemetry.config.json` | template, project-tuned | per-class warning budgets + acceptance token→artifact table |
| `quality/process-baseline.json` | `check-process-ratchet.mjs --update` | tighten-only process baseline (`_template:true` = unarmed) |
| `docs/qa/waivers/*` | humans only | schema'd, loud exceptions; each creation auto-appends a correction |
| `factory-lock.json` | `check-factory-integrity.mjs --init-lock` | hashes of gate-bearing files at post-adaptation G0 |
| `RULES-CHANGELOG.md` | humans only | the promotion/demotion ledger for every check |
| `openspec/changes/improve-PD-x/` | retro flow | the human-gated improvement queue |
| `lessons/` (this repo) | human-reviewed PRs | cross-project lessons; init/onboard upserts them into `AGENTS.md` |

## Command quick reference (target project)

```bash
npm run correct -- "<utterance>"     # intake a contradiction
node scripts/correct.mjs --check     # any OPEN corrections? (red if yes)
npm run retro:digest                 # regenerate process-health
npm run check:acceptance             # G3 existence mode
npm run check:acceptance:artifact    # G4/G6/G7 artifact mode
npm run check:process                # process ratchet (no --strict while experimental)
npm run check:integrity              # factory lock verify
npm run check:visual                 # pixel parity vs reference (when configured)
```

Every check prints one `Scope: <n> <unit>` line and one final
`Result: PASS|FAIL|SKIP-pending|NOT-EARNED[, N warning(s)]` line — machine-
parseable by qa-verify and the ledger.

## Parity Playbook

For pixel-parity / visual-fidelity deliveries (reproduce a live reference at
≥ near-100% fidelity), the reflection layer upstreams a **multi-layer parity
acceptance** pattern and three earned lessons from the parity campaign
(motivating failure: [pixel forensics](field-reports/2026-07-02-pixel-perfect-forensics.md)).
The lessons install into the target project's `AGENTS.md` at init/onboard; the
NFR shape lives in `templates/docs/requirements.template.md` (the L1–L5 row).

### Block conquest, not page-average

Do **not** iterate toward a full-page pixel average — it launders per-block
debt and oscillates. Iterate **block by block to a per-block definition-of-done**
([block-conquest-doctrine](../lessons/block-conquest-doctrine/lesson.md)): a
block is done only when, independently, `unpaired = 0`, `geometry = 0`,
`paint = 0`, `asset = 0`, and `pixel ≥ floor`; the page is done only when every
block is. The full-page scalar is **demoted to telemetry** (trend it, don't gate
on it). Converge each block with the **overlay / onion-skin** feedback pattern:
a difference-blend overlay plus a 50% onion-skin composite of the block on both
sites, reviewed by eye/vision, localizes the residual so it drops to zero before
the next block is conquered.

### The sweep completes the matrix (and states its blindness)

A discrete matrix (five widths, a fixed element set, a single geometry channel)
is necessary but **never continuum coverage**
([sampling-blindness](../lessons/sampling-blindness/lesson.md)). Every sampled
check declares its **sampling dimension** and a **stricter-instrument escalation
path**, and the escalation actually runs before a DoD is claimed: a five-width
matrix escalates to a **fine-step continuum pixel sweep**; a geometry-only sweep
escalates to a **pixel channel** over the same sweep. Before any below-floor
sample is treated as a product defect, the capture is proven deterministic
against the [capture-determinism](../lessons/capture-determinism/lesson.md)
gotchas ledger (free-run carousel timers, sub-pixel clip origin,
`captureBeyondViewport` fixed-chrome bleed, unsettled lazy widgets, uncleared
persistence) — an unstable capture is a harness defect, filed, not a finding.

### How it integrates with the acceptance escrow

Block conquest and the sweep produce the evidence; the **acceptance-contract
auditor** (mechanism 2) holds the escrow. The multi-layer parity roll-up
(per-section overlay ≥ floor across the width matrix, L1 content / L2 element
style / L4 behavior all clean) is the fresh, threshold-passing **artifact** that
hard `check-acceptance-methods --mode=artifact` joins to each declared
`pixel-diff` / `vision-verify` / `e2e` tag on the NFR. Until that artifact
exists and passes, artifact mode reports `missing-artifact` honestly (NOT-EARNED
over product code, never a vacuous PASS). A `Status: open` waiver may escrow a
deferred sub-item **visibly**; once the waiver is closed the suppression stops
(PD-7) and the item resurfaces on the gate. Parity convergence is therefore
proven by an exit code joined to a declared method — not by a maker's narrative.

The parity checks themselves (`check-parity-suite`, `parity-block-loop`) enter
`RULES-CHANGELOG.md` as **experimental** and climb the ladder on ≥ 2 truthful
runs with 0 false positives; the single-scalar `check-visual-fidelity` is
superseded as the acceptance instrument but retained for telemetry.

## Off-switch semantics (read this twice)

- `FACTORY_TELEMETRY=off` disables **ledger emission only**. Nothing is
  written, nothing blocks, exit 0 — telemetry is fail-open by design and
  must never break a hook.
- There is **no off-switch for the honesty checks**: the vacuity flip, the
  acceptance-contract join, the echo-stub scan, and the claim-divergence
  check are gate fixes living inside the battery. Disabling them means
  editing gate-bearing scripts — which the integrity lock renders as a hard
  red unless it arrives via an approved `Refs: PD-x` commit.
- No hard gate keys on LLM output. The LLM layer proposes; humans approve;
  deterministic checks enforce.

## Safety zones (who may change what)

- **Zone 1 — autonomous, always safe:** appending telemetry, regenerating
  digests. Pure observation.
- **Zone 2 — autonomous with guardrails:** ratchet baselines move only via
  `--update`, only tightening. Loosening = waiver artifact + owner-signed
  `RULES-CHANGELOG.md` row, and it stays loudly WARNed.
- **Zone 3 — human-gated, always:** gate commands, check-script logic,
  `AGENTS.md` rules, checklist text — improvement proposal + executed
  red→green proof + one-revert rollback, or it does not happen.
