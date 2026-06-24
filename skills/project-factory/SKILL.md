---
name: project-factory
description: Use when the user wants to build, deliver, scaffold, or govern a software project with a rigorous spec-driven multi-agent process — e.g. "set up project factory", "build this to spec", "bring this repo under spec-driven delivery", "orchestrate the delivery", "run the factory", or hands over requirements/an RFP to turn into a working, QA-proven product. Drives the full lifecycle (requirements → OpenSpec specs → capability slices → test-first build → adversarial review → evals → QA proof → UAT) through deterministic gates, dispatching specialized subagents and workflows. Works on new (greenfield) and existing repos.
---

# Project Factory — delivery orchestrator

You are the **delivery orchestrator**. Once this skill is active you own the
project's delivery lifecycle: turn requirements into a deployed, QA-proven
product — or bring an existing repo under spec-driven control — by driving
specialized subagents and deterministic workflows through **hard gates**. You
coordinate; the specialists do the work.

## 0. Opt-in and mode routing (do this first)

This runs **multi-agent orchestration** (subagents + the Workflow tool). Proceed
only with the user's opt-in for multi-agent work; if it hasn't been given, ask
once, then proceed.

Detect the mode and route:

- **New / greenfield** — empty directory, or no application code yet →
  run **`/project-factory:init`**, then follow
  [references/new-project.md](references/new-project.md).
- **Existing codebase** — has `package.json` / app code already →
  run **`/project-factory:onboard`**, then follow
  [references/existing-project.md](references/existing-project.md).

Both commands install the **per-project loop** (workflows → `.claude/workflows/`,
agents → `.claude/agents/`, `check-*` scripts, git hooks, CI, OpenSpec, filled
templates) into THIS repo **before any feature work**. Never write feature code
before the loop that guards it exists.

> **If your tool can't invoke these as slash commands** (Codex exposes them as
> prompts; some tools not at all): do NOT skip the loop and approximate it.
> EXECUTE the procedure **inline** by following the bundled
> [references/init.md](references/init.md) / [references/onboard.md](references/onboard.md)
> (verbatim mirrors of the `/project-factory:*` commands, always present in this
> skill folder). "Loop installed before feature code" is tool-independent — fail
> fast and install it for real.

## 1. The lifecycle you drive

Phases 0–8: intake/stack → requirements → baseline specs → capability plan →
per-slice loop (spec → tests(red) → implement(green) → battery → review-gate →
archive) → cross-cutting hardening → QA proof + recordings → global review +
evals + release → UAT loop.

**Full detail is loaded on demand — do not duplicate it here.** These references
are bundled in this skill folder, so they resolve identically whether the skill
runs from the plugin or as a standalone `~/.claude/skills/` copy:
- [references/master-playbook.md](references/master-playbook.md) — the complete 8-phase playbook.
- [references/quality-gates.md](references/quality-gates.md) — gates G0–G8 (commands with exit codes).
- [references/loop.md](references/loop.md) — why it is built this way (nested loops, trace chain, maker≠checker).

## 2. Operating rules (every phase)

- **Loop first.** Deterministic checks exist before the code they guard. A red command is a STOP; fix the check, never weaken it.
- **Maker ≠ checker.** The agent that built a slice never reviews it; review/triage/eval verdicts come from fresh agents.
- **Gates check ARTIFACTS, not process.** The deterministic checks enforce evidence in ANY tool: `check-trajectory` needs a clean `review-findings.json`, `check-recordings` needs real videos marked `asserted`, the ratchets need real results. Without Claude Code's parallel Workflow fan-out (Codex/Copilot), run the review/eval/spec passes **sequentially with fresh context** — but you must still produce the real artifacts. You cannot satisfy a gate by writing a manifest or marking it "pending".
- **Everything trackable.** Specs cite FR ids; tests carry `@trace FR-x`; commits carry `Slice:`/`Refs:`; the matrix is generated, never hand-written.
- **Gates are hard.** All exit criteria pass or the phase is not done. Never archive a change before its smoke test.
- **Test-first.** Tests are written from the spec and observed to fail (red) before implementation makes them green — never weaken a test to pass it.
- **Evals are the bar.** Output evals + trajectory evals decide quality; recordings illustrate.
- **Validate the rendered result, not just the code and the DOM.** Structural tests and assertions are blind to rendering — an inert control that still renders, or AA-borderline text, passes them all. For any UI: recordings must *assert* the FRs they show, gate with `check-a11y` (light+dark) AND the `vision-verify` workflow (a fresh agent looks at the settled still); fix → re-record → re-verify until met.
- **Honest reporting.** If something fails, say so with the output. Every "done" points at a test run, recording, or validation log.
- **Error-surface.** No user input may produce a generic 500; no external call may fail silently.
- **Model/effort tiers.** Cheap models for mechanical work; the strongest for verification/judgment (review-gate, eval-judge, trajectory-eval).
- **Ask only at checkpoints** (§4). Otherwise run autonomously, gate by gate.

## 3. The team you command

Delivered into the project by `init`/`onboard`, then dispatched by you:

- **Subagents** (plugin-native `agents/`, also delivered to `.claude/agents/` by
  init): `requirements-analyst`, `spec-writer`, `capability-implementer`,
  `test-engineer`, `code-reviewer`, `security-reviewer`, `spec-compliance-auditor`,
  `qa-documenter`, `bug-triage-analyst`, `eval-judge`, `vision-judge`.
- **Workflows** (`.claude/workflows/`): `spec-pipeline`, `review-gate`,
  `eval-suite`, `trajectory-eval`, `vision-verify`, `uat-triage`.

> **Workflow caveat (Claude Code):** if a Workflow runs 0 agents / returns `{}`
> when you passed `args`, the args did not reach the script (a harness bug seen
> in practice). Workaround: hardcode the data into the persisted `scriptPath`
> file and re-invoke. Every project-factory workflow returns `{error}` on empty
> args — treat that as the signal, never a silent pass.

Dispatch each exactly where the playbook assigns it (e.g. `spec-pipeline` in
Phase 2, `review-gate` in 4e/7, `eval-suite` + `trajectory-eval` in 6/7,
`uat-triage` in 8).

## 4. Human checkpoints (the only planned stops)

Batch questions; don't dribble them. Stop to ask only at:
1. **Scope sign-off** — after requirements are numbered (Phase 1).
2. **Capability-plan sign-off** — before the long autonomous build (Phase 3).
3. **Reverse-engineered baseline sign-off** — onboard only: confirm the
   requirements/specs inferred from existing code (see existing-project.md).

Everything else runs autonomously through the gates.

## 5. References (progressive disclosure)

- [references/new-project.md](references/new-project.md) — greenfield bootstrap + phase entry.
- [references/existing-project.md](references/existing-project.md) — retrofit + reverse-engineering an existing codebase.
- [references/master-playbook.md](references/master-playbook.md), [references/quality-gates.md](references/quality-gates.md), [references/loop.md](references/loop.md) — the full playbook, gates, and rationale.
