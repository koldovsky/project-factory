# {{PROJECT_NAME}} — Agent Rules

> Fill the {{placeholders}}, delete this line, and keep this file at the repo
> root. `CLAUDE.md` should contain a single line: `@AGENTS.md`.

# This may NOT be the {{FRAMEWORK}} you know

The installed version ({{FRAMEWORK_VERSION}}) may differ from training data.
Read the relevant guide in `node_modules/{{FRAMEWORK_PKG}}/dist/docs/` (or the
package's bundled docs) before writing any code. Heed deprecation notices.

Use `docs/requirements.md` to understand the requirements for the project.

## Project Handoff Protocol

Before planning or implementing any substantive change, read:

1. `docs/current-state.md` for the latest persistent handoff and next-step guidance.
2. `docs/mvp-capability-plan.md` for the change sequence and capability scope.
3. `openspec/project.md` and the relevant files under `openspec/specs/`.
4. `docs/adr/` for accepted architecture decisions.

Keep `docs/current-state.md` current when a meaningful milestone happens:
an OpenSpec change is created/implemented/validated/archived; a capability
moves from planned to implemented; setup or validation expectations change;
an ADR is accepted. Write last update date/time (timezone: {{TIMEZONE}}) and
the current phase. `docs/current-state.md` is a handoff aid, not the source
of truth — if it conflicts with code/specs/tests, verify and update it.

## Module conventions

- `db/schema/<domain>.ts` per domain, re-exported from `db/schema/index.ts`;
  migrations committed (SQL + snapshots).
- `lib/<domain>/`: `validation.ts` (zod + formData mappers), `queries.ts`,
  `service.ts`, `actions.ts` (guard → validate → service → revalidate),
  pure helpers in own files, colocated `*.test.ts`.
- Pages are thin server components; client components only when needed.
- ONE shared authenticated shell + ONE role-based navigation source.

## Correctness rules (learned from production bugs)

- Server actions never throw raw on user input — catch and surface inline
  (`?formError=` + shared banner). Translate FK/unique violations to human
  messages; hide driver internals.
- Numeric parsers accept trailing zeros and decimal commas.
- Uncontrolled filter/edit forms are keyed by the server state they display.
- Status/state selects offer only reachable transitions; server re-validates.
- External calls (email, exports, APIs) never fail silently: surface to the
  user or log with cause; degrade honestly (e.g. show fallback link).
- Auth library cookie propagation from server actions must be wired
  (Better Auth: `nextCookies()` plugin, last in plugins list).
- Seed/test helpers re-pin baseline state; day-bound test assertions use
  LOCAL calendar dates.

## Validation cadence

Run before and after substantial changes:

```bash
npm run lint
npm run test:run
npm run test:integration   # once the layer exists
npm run test:e2e           # once the layer exists
npm run build
npx openspec validate --all --strict
```

Do not archive OpenSpec changes before implementation AND a real-DB smoke
test pass. Keep `.env.local` private; never commit or print it.

## Environment notes

- {{OS_AND_SHELL_NOTES}}
- Database: {{DB_NOTES}}
- Email: sandbox senders (e.g. `resend.dev`) deliver only to the provider
  account owner — verify a real domain before UAT.
