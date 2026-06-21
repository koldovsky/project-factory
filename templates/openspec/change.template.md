# OpenSpec Change Folder — Skeletons

> One change folder per capability slice: `openspec/changes/add-<capability>/`.
> Split the three sections below into `proposal.md`, `design.md`, `tasks.md`.
> The spec delta goes to `specs/<capability>/spec.md` inside the change as
> `## ADDED Requirements` (Option B — archiving restores it to baseline).

---

## proposal.md

```markdown
# Add <Capability>

## Why
{{2-4 sentences: business need, FR refs.}}

## What Changes
- {{bullet list of user-visible behavior and system surface added}}

## Impact
- Affected specs: {{…}}
- Affected code: {{db/schema, lib modules, routes}}
- Dependencies: {{prior slices, new packages}}
```

---

## design.md

```markdown
# Design — add-<capability>

## Goals / Non-goals
## Key decisions
{{Each: decision, alternatives, trade-offs. Flag ADR-worthy ones.}}
## Data model
{{tables, columns, indexes, FKs}}
## Error handling
{{how every user-input error surfaces inline; how external failures degrade}}
## Risks & mitigations
```

---

## tasks.md

```markdown
## 1. Dependencies and database schema
- [ ] 1.1 {{package adds}}
- [ ] 1.2 Add `db/schema/<domain>.ts` …
- [ ] 1.3 Indexes/constraints/FKs …
- [ ] 1.4 Export from `db/schema/index.ts`; generate + commit migration.

## 2. Domain logic
- [ ] 2.1 `lib/<domain>/validation.ts` zod schemas + formData mappers.
- [ ] 2.2 {{pure helpers: calculations, state machine, parsers}}

## 3. Services and actions
- [ ] 3.1 `lib/<domain>/queries.ts` (guarded reads).
- [ ] 3.2 `lib/<domain>/service.ts` (business operations).
- [ ] 3.3 `lib/<domain>/actions.ts` (guard → validate → service →
        revalidate; errors surfaced inline, never raw 500).

## 4. UI and route handlers
- [ ] 4.1 {{pages/forms; filter+edit forms keyed by server state}}
- [ ] 4.2 Unauthorized → `/login?next=…`; forbidden → `/`.
- [ ] 4.3 Navigation entries in the shared shell.

## 5. Tests
- [ ] 5.1 Unit: validation incl. locale decimals, trailing zeros, oversized,
        blank inputs.
- [ ] 5.2 Unit: {{calculations / state machine / parsers}}.
- [ ] 5.3 DB smoke flow script for this slice.
- [ ] 5.4 Eval case(s) in `evals/cases/<domain>.eval.ts` for the slice's key
        error-surface / qualitative NFR behavior (rubric + `@trace` the NFR/FR).

## 6. Validation, docs, and archive prep
- [ ] 6.1 `npm run test:run`
- [ ] 6.2 `npm run lint`
- [ ] 6.3 `npm run build`
- [ ] 6.4 `npx openspec validate add-<capability> --strict`
- [ ] 6.5 `npx openspec validate --all --strict`
- [ ] 6.6 Run review-gate workflow; fix all confirmed findings; re-run 6.1–6.5.
- [ ] 6.7 Update README + `docs/current-state.md`.
- [ ] 6.8 Manual real-DB smoke test: {{spell out the exact flow}}.
- [ ] 6.9 Archive only after 6.1–6.8 pass:
        `npx openspec archive add-<capability> --yes`.
```
