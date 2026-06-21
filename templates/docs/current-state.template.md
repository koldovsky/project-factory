# Current State

> Persistent handoff file for future agent windows. A quick map, not a
> replacement for source-of-truth artifacts. Always verify with OpenSpec,
> tests, and the repo.

## Last Updated

- **Date and time:** {{YYYY-MM-DD HH:MM:SS}} ({{TIMEZONE}})
- **Current phase:** {{e.g. Phase 4 — implementing slice 3 of 7}}
- **Active change:** {{openspec change name or "none"}}
- **Progress:** {{2-6 sentences: what is done, validated, archived}}
- **Next task:** {{the exact next action a fresh session should take}}

## Source Of Truth

1. `AGENTS.md` — project agent rules.
2. `docs/current-state.md` — this handoff.
3. `docs/requirements.md` — canonical FR/NFR/TC/BC requirements.
4. `docs/product-brief.md` — product narrative.
5. `docs/mvp-capability-plan.md` — change sequence and scope.
6. `openspec/project.md` + `openspec/specs/` — accepted behavior.
7. `docs/adr/` — architecture decisions.
8. `docs/qa/` — QA proof pack and recordings.

## OpenSpec Status

```bash
npx openspec validate --all --strict   # expected: all pass
npx openspec list                      # expected: No active changes (between slices)
```

Archived changes: {{list as they accumulate}}

## Completed Changes

### {{n}}. `add-<capability>`

Status: {{planned / in progress / implemented / validated / archived}}.
Implemented: {{bullets}}.
Smoke test: {{what was exercised on a real DB}}.
Latest checks: {{battery results}}.

## Validation Commands

```bash
npm run lint
npm run test:run
npm run test:integration
npm run test:e2e
npm run build
npx openspec validate --all --strict
```

Current test expectation: {{N files / M tests passing per layer}}

## Environment / Deployment

- {{DB project, email provider, deploy platform, URLs}}
- {{Secrets live in .env.local — never print or commit}}

## Agent Rules / Gotchas

- {{framework-version gotchas discovered during the build}}
- {{OS/shell quirks}}
- Do not archive OpenSpec changes before implementation and smoke test.
