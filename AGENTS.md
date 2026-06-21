<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

Use `docs/requirements.md` to understand the requirements for the project.

## Project Handoff Protocol

Before planning or implementing any substantive change, read:

1. `docs/current-state.md` for the latest persistent handoff and next-step guidance.
2. `docs/mvp-capability-plan.md` for the MVP change sequence and capability scope.
3. `openspec/project.md` and the relevant files under `openspec/specs/` for current accepted behavior.
4. `docs/adr/` for accepted architecture decisions.

Keep `docs/current-state.md` current when a meaningful milestone happens, especially when:

- an OpenSpec change is created, implemented, validated, or archived;
- a capability moves from planned to implemented;
- setup instructions, validation expectations, or known blockers change;
- architectural decisions are accepted or replaced.

`docs/current-state.md` is a handoff aid, not the source of truth. If it conflicts with code, OpenSpec specs, ADRs, or tests, verify the repo state and update the handoff file.

Write last update date/time and the current phase of the project in the file (use Kyiv time zone).
Example:
```
- **Date and time:** 2026-04-29 16:40:00
```