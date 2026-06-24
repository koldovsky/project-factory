<!-- GENERATED MIRROR of LOOP.md. Do not edit here — edit the canonical file and run `node scripts/sync-skill-refs.mjs`. Bundled so the skill is self-contained (standalone + plugin). -->

# The Loop — Why This Framework Is Built the Way It Is

> Informed by Addy Osmani's *"Loop Engineering"*
> (addyosmani.com/blog/loop-engineering): *"You shouldn't be prompting coding
> agents anymore. You should be designing loops that prompt your agents."*

The framework's quality does not come from clever prompts. It comes from the
**loops** wrapped around every agent: deterministic checks close the inner
loop on every edit, the validation battery and adversarial review close the
slice loop, and recordings plus UAT triage close the outer loop with the
customer. Prompts *ask* for quality; loops *guarantee* it.

Because those loops are **deterministic checks (Node + git) and committed
artifacts** — not features of any one tool — they run identically under Claude
Code, Cursor, Copilot, Codex, or any agent that reads `AGENTS.md`. Only the
*orchestration substrate* differs per tool (parallel fan-out vs sequential
passes); the gates, specs, evals, and trace chain are the same everywhere. See
[`docs/portability.md`](docs/portability.md).

## Three nested loops

```
┌─ OUTER LOOP — customer reality ──────────────────────────────────┐
│  demo recordings → UAT bug report → uat-triage → root-cause fix  │
│  → regression test → proof recording → customer report           │
│                                                                   │
│  ┌─ SLICE LOOP — per capability ────────────────────────────┐    │
│  │  spec → tasks → tests(red) → implement(green) → BATTERY  │    │
│  │  → review-gate (maker≠checker) → fix → archive → commit  │    │
│  │                                                           │    │
│  │  ┌─ INNER LOOP — per edit ─────────────────────────┐     │    │
│  │  │  agent edits file → Claude hook runs ESLint     │     │    │
│  │  │  agent commits → git hooks: lint, tsc, secrets, │     │    │
│  │  │  trace validator, trailer check                 │     │    │
│  │  └─────────────────────────────────────────────────┘     │    │
│  └───────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

## How the article's primitives map here

| Loop-engineering primitive | This framework |
|---|---|
| Automations | CI on every push; `qa:verify` battery as the gate runner; recorder scripts regenerate evidence on demand; **plus an optional scheduled-automations layer** (`automations/` — cost-tiered, propose-only, off by default: drift / CI-triage / audit watchers, local or cloud) |
| Worktrees | Parallel slice implementation policy (independent DAG branches, isolated worktrees) |
| Skills | `AGENTS.md` rules + `.agents/skills/` packs + the templates — codified once, never re-explained |
| Connectors | `gh`, deploy platform CLI, DB tooling — the loop ends with a verified deployment, not a claim; **automations also surface through connectors** (GitHub issues, a Slack-compatible webhook, or an MCP connector) so ongoing ops act, not just report |
| Sub-agents (maker ≠ checker) | The implementer of a slice NEVER reviews it. `review-gate` spawns fresh reviewer agents per dimension, and each finding is adversarially verified by further fresh agents. `uat-triage` gets a second independent opinion on low-confidence verdicts |
| State / memory | `docs/current-state.md` (handoff), `trace/trace.json` (machine-readable links), OpenSpec archives (decision history) — *"the agent forgets, the repo doesn't"* |
| Verifiable stop conditions | Gates G0–G8 are **commands with exit codes**, not prose. "Done" = the gate's command set exits 0 |

## Conductor vs orchestrator mode

This framework runs in **orchestrator mode** — asynchronous, goal-driven: hand
it a spec and it drives slices to done through the gates. That is the right mode
for building *to a known spec*. When the code or domain is *unknown* and you must
explore before specifying, drop into **conductor mode** first (real-time, in the
IDE, small reversible steps) to build understanding — then write the spec and let
the orchestrator take over. The modes compose; don't orchestrate over a codebase
you haven't yet understood.

## The two hard rules this adds

### 1. Everything is trackable (the trace chain)

Every artifact carries the requirement ids it serves, and a deterministic
validator (`scripts/check-traceability.mjs`) walks the whole chain:

```
FR-12 ──cited in──▶ openspec/specs/…/spec.md
      ──owned by──▶ docs/mvp-capability-plan.md (exactly one slice)
      ──@trace───▶ lib/…/*.test.ts            (test annotations)
      ──proof────▶ docs/qa/**/manifest.json    (recordings)
      ──Refs:────▶ git log                     (commit trailers)
```

- Specs cite FR ids in requirement text.
- Tests carry `// @trace FR-12` (regressions: `// @trace BUG-3`).
- Recording manifests list the FR/BUG ids each clip proves.
- Feature commits carry `Slice:` / `Refs:` trailers (enforced by the
  commit-msg hook) — `git log --grep "FR-24"` becomes a complete audit trail.
- The traceability matrix is **generated** by the validator, never
  hand-written (hand-written matrices drift; generated ones can't), and CI's
  `--check-fresh` fails if the committed report is stale.

### 2. Deterministic checks precede agent judgment ("loop first")

Phase 0 installs the loop **before the first feature**: git hooks
(lint + typecheck + secret scan + trace validator + trailer check), Claude
Code PostToolUse hooks (per-file ESLint inside the agent's edit loop), CI
(everything, plus coverage ratchet and `--release` hygiene). LLM review
(`review-gate`) runs only on top of green deterministic checks — agents
spend their judgment on what machines can't check, and machines never get
argued with.

The **coverage ratchet** embodies the loop's direction: quality constraints
may tighten over time, never silently loosen.

The **eval ratchet** extends that direction to *graded quality* (error
clarity, usability, copy tone): the `eval-suite` workflow scores behavior
against rubrics with a fresh `eval-judge` (maker≠checker), and
`check-eval-ratchet` guards the committed score in CI. The bar is the eval,
not the demo — recordings *illustrate* a case; the eval *decides* it.

**Trajectory evals** close the loop's other half. Output evals grade the
*result*; trajectory evals grade the *route* each slice took. `check-trajectory`
proves what git can (review evidence ran clean, `Slice:` trailers, module
scope); the `trajectory-eval` workflow judges what it can't (process order, no
test weakened, no scope drift) with a fresh judge — never claiming the
deterministic check can verify test-first ordering it cannot.

## Anti-patterns the framework explicitly counters

- **Self-grading** — *"the model that wrote the code is way too nice grading
  its own homework."* Countered structurally: maker/checker separation in
  review-gate, uat-triage, and the eval-suite's fresh `eval-judge`;
  deterministic gates (and ratchets) that cannot be sweet-talked.
- **Comprehension debt** — *"understanding rots if you don't read what the
  loops produce."* Countered with forced legibility: per-clip markdown
  explainers, generated traceability reports, design.md trade-off sections,
  customer reports with root-cause narratives — and two mandatory human
  checkpoints (scope, plan) where a person must actually read.
- **Cognitive surrender** — gates fail loudly with evidence. A red gate is a
  STOP, never something to narrate around. Honest-reporting rules forbid
  claiming unverified success.

## Validation of this design

The trace validator was run against a real production codebase that had already
passed lint, a full unit-test suite, integration, E2E, strict OpenSpec
validation, human review, AND an external QA round. It still found: zero FR
citations in any spec, zero test trace annotations, and **two archived changes
with unchecked tasks** that every review had missed.
That is the argument for deterministic loops in one sentence: every
judgment-based layer had already looked, and none of them saw it.
