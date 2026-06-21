# Project Factory — Evaluation Against the 2026 Agentic SDLC

**Date:** 2026-06-21 (Kyiv)
**Scope:** Evaluate the approach encoded in this `project-factory/` framework against the most recent thinking on AI-assisted software development.
**Update 2026-06-21:** Upgrade in progress — step 1 (evals, §4.2) and step 2 (scheduled automations, §4.1) are landing. See [`evals/README.md`](../evals/README.md) and [`automations/README.md`](../automations/README.md).
**Reference corpus:**

- Kaggle / Google whitepaper — *The New SDLC With Vibe Coding* (Addy Osmani, Shubham Saboo, Dr. Sokratis Kartakis)
- Addy Osmani — *The New Software Lifecycle* ([new-sdlc-vibe-coding](https://addyosmani.com/blog/new-sdlc-vibe-coding/))
- Addy Osmani — *Loop Engineering* ([loop-engineering](https://addyosmani.com/blog/loop-engineering/))
- Addy Osmani — *The Factory Model* ([factory-model](https://addyosmani.com/blog/factory-model/))

---

## 1. Verdict

**Project Factory is strongly aligned with the 2026 state of the art — and in its two strongest dimensions (designed feedback loops and adversarial verification) it implements these ideas more concretely than the source articles describe them.** The framework reads like a faithful, opinionated *productionization* of Osmani's "factory" and "loop engineering" essays, fused with spec-driven development (OpenSpec) and a hard, deterministic trace chain.

The gaps are not in fidelity but in **breadth of vision**. The references describe a *perpetual factory* that keeps running (scheduled automations, evals-as-benchmarks, dynamic context economics). Project Factory implements a *bounded delivery pipeline* (empty directory → deployed, QA-proven product + a UAT round) extremely well, then stops. Most of its gaps are the difference between "ship one project rigorously" and "operate a continuous agent fleet."

**Alignment score: ~8.5 / 10** against the combined rubric below. The four material gaps are concentrated in: (1) scheduled/autonomous automations, (2) evals as first-class vs. demo recordings, (3) explicit context engineering (static vs. dynamic), and (4) test-first ordering.

---

## 2. The combined rubric (what "recent" actually demands)

Synthesizing the four sources into one set of principles, then scoring this framework against each:

| # | Principle (from the references) | Source | Project Factory | Rating |
|---|---|---|---|---|
| 1 | **Build the factory, not the feature** — orchestrate fleets of agents; "from writing code to orchestrating systems that write code" | Factory | `MASTER-PROMPT.md` orchestrator + 9 subagents + 3 deterministic workflows. The repo *is* a factory. | ✅ Strong |
| 2 | **Spec as leverage** — output quality tracks spec precision; vague specs compound across parallel runs | Factory, SDLC | OpenSpec baseline specs + per-slice change folders, numbered `FR/NFR/TC/BC`, `openspec validate --strict` as a gate | ✅ Exceeds |
| 3 | **Verification > generation** — "Generation is solved. Verification, judgment, and direction are the new craft" | SDLC, Factory | Adversarial `review-gate`, deterministic gates G0–G8, two enforcement pillars | ✅ Exceeds |
| 4 | **Design loops, don't prompt** — "you should be designing loops that prompt your agents" | Loop | `LOOP.md`: three nested loops (edit → slice → customer), each closed by commands | ✅ Exceeds |
| 5 | **Maker ≠ checker** — separate writers from verifiers to kill confirmation bias | Loop, Factory | Implementer never reviews; `review-gate` spawns fresh reviewers **and adversarially refutes each finding** (2-lens, refute-by-default, majority vote) | ✅ Exceeds |
| 6 | **Persistent external state** — "the agent forgets, the repo doesn't" | Loop | `docs/current-state.md`, `trace/trace.json`, OpenSpec archives | ✅ Strong |
| 7 | **Harness is 90%** — agent = model (10%) + harness (instructions, tools, guardrails, observability) | SDLC | `AGENTS.md` + agents + workflows + hooks + CI + reference scripts = the harness | ✅ Strong |
| 8 | **Review is the safety system** — human review is not optional overhead; guard comprehension debt & cognitive surrender | Factory, Loop | Two mandatory human checkpoints; forced legibility (per-clip explainers, generated matrices, design.md trade-offs). `LOOP.md` names and counters both risks explicitly | ✅ Strong |
| 9 | **Last-mile discipline** — agents nail 80%; the last 20% (edge cases, seams) needs context models lack | SDLC | Error-surface principle, root-cause clustering, locale/edge-input unit tests, the whole "paid for in bugs" ethos, the UAT loop | ✅ Exceeds |
| 10 | **Tests teach "correct"; TDD becomes mandatory** — write tests *before* implementation so agents optimize toward behavior, not toward passing | Factory, SDLC | Tests are mandatory, `@trace`'d, gated, real-DB smoke — but authored **after** implementation (Phase 4: implement → then test) | 🟡 Partial |
| 11 | **Set the bar at the eval, not the demo** — output eval *and* trajectory eval; reliability over single success; LLM judges | SDLC | **Output-eval suite added** (step 1): `eval-suite` workflow (fresh `eval-judge`, maker≠checker, double-judged at the borderline) + `check-eval-ratchet` guarding `quality/eval-baseline.json`; recordings reframed as illustration. Trajectory eval still partial. | 🟡→✅ Closing |
| 12 | **Context engineering** — static vs. dynamic context; progressive disclosure via Skills; treat the boundary as a versioned, cost-bearing decision | SDLC | Leans on **static** context (large always-loaded `AGENTS.md`). `.agents/skills/` referenced but the static/dynamic split & TCO framing are absent | 🟡 Gap |
| 13 | **Automations** — scheduled, *unprompted* discovery/triage loops (daily CI-failure analysis, bug hunting, issue triage) | Loop | **Scheduled-automations layer added** (step 2): `automations/` registry + dispatcher; cost-tiered (Tier-0 deterministic ~free, Tier-1 cheap, Tier-2 opt-in), propose-only, OFF by default; local + cloud adapters. | 🟡→✅ Closing |
| 14 | **Worktrees** — isolated parallel environments as a core primitive for agent fleets | Loop | Supported but gated behind "only if the user asked for max speed; default sequential — DB migrations conflict" | 🟡 Partial |
| 15 | **Connectors/Plugins** — MCP integrations so the loop ends in real-world action, not a claim | Loop | `gh`, deploy CLI, DB tooling; loop ends in a *verified* deployment. No issue-tracker/Slack MCP wiring for ongoing ops | 🟡 Partial |

Legend: ✅ Exceeds / Strong = meets or surpasses the reference. 🟡 = partial or genuine gap.

---

## 3. Where the framework matches or beats the state of the art

**It out-implements the articles on verification.** The references *argue* that verification is the new craft and that maker≠checker matters. Project Factory goes further than the prose: `review-gate.js` doesn't just use a separate reviewer — it spawns fresh reviewers per dimension (correctness/security/spec-compliance), then **adversarially refutes every finding** through two independent lenses ("is the mechanism actually wrong?" / "can this actually occur for a real user/attacker?"), defaults to `refuted=true` when a verifier can't positively confirm, and resolves by majority vote (`refutes >= 2 → rejected`, `=== 1 → contested`, `0 → confirmed`). That is a more disciplined verification harness than any of the four essays describes.

**Its trace chain is the concrete form of "the repo remembers."** `check-traceability.reference.mjs` is a real deterministic, exit-coded validator: it walks `FR → spec → plan → @trace test → recording manifest → commit trailer`, generates (never hand-writes) the matrix, and enforces freshness in CI (`--check-fresh`). It is phase-aware (warnings before a phase exists, hard failures after), handles OpenSpec "Option B" deltas, and is even Windows-path-safe. The `LOOP.md` anecdote — the validator catching *two archived changes with unchecked tasks that every judgment-based review had missed* — is exactly the "deterministic checks before agent judgment" thesis, demonstrated.

**It directly counters the references' named failure modes.** Comprehension debt and cognitive surrender are called out by name in `LOOP.md` and countered structurally (forced legibility + two human checkpoints + loud, evidence-bearing gates). Self-grading ("the model grading its own homework") is countered by maker/checker separation and gates that "cannot be sweet-talked." This is unusually self-aware framework design.

**"Loops over prompts" is the literal foundation, not a slogan.** `LOOP.md` cites the loop-engineering essay and maps each of its primitives (automations, worktrees, skills, connectors, sub-agents, state, verifiable stop conditions) to a concrete mechanism. The three-nested-loop diagram (per-edit → per-slice → customer) is a clean realization of the source idea.

---

## 4. Material gaps (relative to the most expansive reading of the references)

### 4.1 No perpetual / scheduled automations — *the clearest divergence from Loop Engineering*
Loop Engineering's **first** primitive is *Automations*: scheduled, self-triggering discovery — daily CI-failure triage, autonomous bug-hunting, issue summarization — running with no human in the prompt. Project Factory is **delivery-shaped**: the orchestrator runs when invoked; even the UAT loop fires only "whenever a bug report arrives." CI exists but is reactive-on-push, not a discovery loop. The framework builds a product and then halts; the essay envisions a factory that keeps running. This is partly out-of-scope-by-design (it's a *project delivery* kit), but it is the single feature most associated with "loop engineering" that the framework lacks. **Now readily implementable** via Claude Code scheduled tasks / cron agents.

> **Status — being closed (upgrade step 2).** A scheduled-automations layer now exists: `automations/registry.json` (master switch + per-automation toggles) + `scripts/automations/` dispatcher. It is **pragmatic by construction**: cost tiers (Tier-0 deterministic watchers ~$0, Tier-1 cheap Haiku triage only-on-red, Tier-2 workflow re-runs opt-in & budgeted), **propose-don't-push** (`writeCode:false`), four independent off-switches, OFF by default, and **both** local (Task Scheduler/cron/`/loop`) and cloud (GitHub Actions `on: schedule`) adapters. See [`automations/README.md`](../automations/README.md).

### 4.2 Evals are demos, not benchmarks — *the clearest divergence from the Whitepaper*
The whitepaper's sharpest line is *"set the bar at the eval, not the demo"* and its vibe-coding→agentic-engineering spectrum is anchored on **automated evals + LLM judges** with both **output evaluation** and **trajectory evaluation**. Project Factory's "proof = recordings" is closer to the *demo* end: a recording proves one successful run, not statistical reliability. There is no persistent, versioned eval dataset scoring agent output over time, and **trajectory evaluation (was the agent's reasoning/tool-path sound?) is entirely absent.** The adversarial review-gate is LLM-judge-*like*, but it judges a diff once, not a graded suite that ratchets quality the way the coverage ratchet ratchets coverage.

> **Status — being closed (upgrade step 1).** An output-eval layer now exists: `evals/` cases (`cases/*.eval.ts`, rubric + `@trace`), the `eval-suite` workflow (fresh `eval-judge`, maker≠checker, second judge at the borderline), generated `docs/qa/eval-report.md`, and a deterministic `check-eval-ratchet` guarding `quality/eval-baseline.json` in CI (no API key). Recordings are kept as illustration; the eval is the bar. **Still open:** trajectory evaluation (scoring the *path* the agents took), tracked as a later step. See [`evals/README.md`](../evals/README.md).

### 4.3 Context engineering is implicit and static-leaning
The whitepaper treats the **static vs. dynamic context** boundary as a versioned architectural decision with direct TCO impact, and pushes **progressive disclosure via Skills** to keep per-interaction cost down. Project Factory leans on **static** context: a large, always-loaded `AGENTS.md` plus rule packs. There's no explicit guidance on what should be dynamically/progressively loaded, no token/cost budgeting, and no "context architecture" artifact. As projects scale, the always-on context becomes the expensive default the whitepaper warns against.

### 4.4 Test-after, not test-first
Both the Factory and SDLC pieces make **red/green TDD mandatory** — tests *before* implementation so the agent optimizes toward correct behavior rather than toward passing tests it can see. Phase 4's order is **implement (b) → then tests (c)**. Tests are rigorous and gated, but writing them after the code forgoes the specific benefit the references cite (and is more vulnerable to "tests that ratify whatever the code happened to do").

### 4.5 Under-exploited parallelism & model/cost strategy (secondary)
- **Worktrees / parallel fleets** are gated to an opt-in fast path (defensible — DB migrations conflict — but it under-uses the "fleets of agents in parallel" model both Factory and Loop emphasize). Non-DB slices (UI, docs, pure-domain modules) could parallelize safely by default.
- **Model-tier / effort strategy** is absent. "Model is 10%, harness 90%" implies deliberate model selection; the workflow infra supports per-agent `model`/`effort` overrides, but the playbook never assigns cheap models to mechanical stages and expensive ones to hard verification. No token/cost budgeting per phase.
- **Conductor vs. Orchestrator modes:** the framework is purely orchestrator-mode (async, goal-driven). No conductor-mode (real-time IDE exploration of unknown code) guidance — minor, but it's a named concept in the whitepaper.

---

## 5. Recommendations (prioritized)

| Priority | Recommendation | Closes gap | Effort |
|---|---|---|---|
| **P1** | **Add a scheduled-automation layer.** A `automations/` directory + Claude Code cron/scheduled-task definitions: nightly CI-failure triage, dependency-audit sweep, trace-freshness watch, and an autonomous bug-hunt that files findings as `spawn_task`/issues. Turns the bounded pipeline into a standing factory. *(Step 2 done: registry + dispatcher + drift-watch/CI-triage/dep-audit + Tier-2 scaffolding + local & cloud adapters, off by default.)* | 4.1 | M |
| **P1** | **Promote evals to first-class.** Add an `evals/` suite with a versioned dataset and an **LLM-judge graded** harness (output eval), plus at least lightweight **trajectory checks** (did the slice loop run spec→test→review in order; did the agent touch only in-scope modules). Add an *eval ratchet* mirroring the coverage ratchet. Reframe recordings as *demos that supplement* evals, not as the bar. *(Step 1 underway: output-eval suite + eval ratchet implemented; trajectory checks pending.)* | 4.2 | M–L |
| **P2** | **Flip to test-first within the slice loop.** Reorder Phase 4 so `test-engineer` writes failing `@trace`'d tests from the spec scenarios *before* `capability-implementer` runs (red → green). Keeps every existing gate; changes only ordering. | 4.4 | S |
| **P2** | **Add a context-architecture decision.** A short `docs/context-architecture.md` (or ADR) declaring what is static (`AGENTS.md` core rules) vs. dynamically/progressively loaded (skills, per-domain rule packs), with a token budget. Treat it as versioned, per the whitepaper. | 4.3 | S |
| **P3** | **Parallelize non-DB slices by default**; reserve sequential-only for migration-touching slices. Document the safe-parallel vs. must-serialize partition in the capability plan. | 4.5 | S |
| **P3** | **Add a model/effort tier table** to `MASTER-PROMPT.md`: cheap/low-effort for mechanical agents (scaffolding, doc generation), high-effort for verification/triage. Wire the workflow `model`/`effort` overrides accordingly. | 4.5 | S |
| **P3** | **Wire ongoing connectors** (issue tracker / Slack MCP) so UAT triage and automations can open tickets and post status autonomously — the loop-engineering "connectors" primitive applied to operations, not just deployment. | 15 | M |

---

## 6. Bottom line

Project Factory is **not** behind the curve — it is a rigorous, code-backed implementation of exactly the principles these 2026 references advocate, and on verification and loop design it is **ahead of the prose**. Its limitations are the boundaries of its chosen mission: it is a *one-shot, high-assurance delivery pipeline*, not yet a *continuously running agent fleet*. The four references increasingly describe the latter. Adopting the P1 items — **scheduled automations** and **evals-as-benchmarks** — would move it from "best-practice project delivery" to "standing factory," which is where all four sources are pointing.

---

### Sources

- [The New SDLC With Vibe Coding — Kaggle/Google whitepaper](https://www.kaggle.com/whitepaper-the-new-SDLC-with-vibe-coding) (Osmani, Saboo, Kartakis)
- [The New Software Lifecycle — addyosmani.com](https://addyosmani.com/blog/new-sdlc-vibe-coding/)
- [Loop Engineering — addyosmani.com](https://addyosmani.com/blog/loop-engineering/)
- [The Factory Model — addyosmani.com](https://addyosmani.com/blog/factory-model/)

*Framework artifacts evaluated:* `README.md`, `MASTER-PROMPT.md`, `LOOP.md`, `checklists/quality-gates.md`, `.claude/workflows/review-gate.js`, `scripts/check-traceability.reference.mjs`, and the agent/template inventory.
