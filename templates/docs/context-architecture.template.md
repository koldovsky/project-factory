# Context Architecture — {{PROJECT_NAME}}

> A **versioned, cost-bearing** decision (whitepaper: *"treat the static/dynamic
> context boundary as an architectural decision with direct TCO impact"*).
> Static context is paid for on **every** agent turn; dynamic context is loaded
> only when a task needs it. Keep the static layer lean on purpose.

## Static layer — loaded every interaction (keep small)

The minimum the agent must know on every turn. Budget: **≤ {{STATIC_TOKEN_BUDGET, e.g. 4k}} tokens.**

- `CLAUDE.md` → `@AGENTS.md` (durable cross-cutting rules only: module conventions,
  correctness rules learned from bugs, validation cadence, test-first, the handoff
  protocol). NOT per-domain detail.
- The active handoff pointer (`docs/current-state.md` is read at session start, not
  embedded).

When `AGENTS.md` grows past the budget, that is a signal to **move detail out** to
the dynamic layer (a skill or a domain doc), not to raise the budget silently.

## Dynamic layer — loaded on demand (progressive disclosure)

Loaded only when the task touches it, so its tokens are not paid on unrelated turns:

| Loaded when… | Source |
|---|---|
| working in a domain | `lib/<domain>/` code + that domain's spec under `openspec/specs/<domain>/` |
| a reusable procedure applies | a `SKILL.md` skill (vendored under `.agents/skills/`, listed in `skills-lock.json`) |
| using a framework API | the installed package's bundled docs (`node_modules/<pkg>/dist/docs/`) — never memory |
| doing QA / release | the QA pack under `docs/qa/`, the trajectory/traceability reports |
| resuming work | `docs/current-state.md` (read, not embedded) |

## Rules

1. **Default to dynamic.** A rule goes in the static layer only if it's needed on
   *most* turns and can't be discovered from the code/spec in front of the agent.
2. **Progressive disclosure.** Prefer a one-line pointer in static context to an
   on-demand skill/doc over inlining the detail.
3. **Budget is enforced, not aspirational.** Review the static layer's size on a
   cadence; when it exceeds the budget, demote content to a skill.
4. **Versioned.** Any change to this boundary (promote/demote a layer, change the
   budget) is recorded as an ADR in `docs/adr/`.

## Current decision

- **Static budget:** {{STATIC_TOKEN_BUDGET}}. **Today:** {{measured size}}.
- **Recently demoted to dynamic:** {{e.g. "domain-specific calculation rules → lib/<domain> + spec"}}.
- **Owning ADR:** {{ADR-0002-context-architecture}}.
