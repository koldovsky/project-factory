<!-- GENERATED MIRROR of commands/init.md. Do not edit here — edit the canonical file and run `node scripts/sync-skill-refs.mjs`. Bundled so the skill is self-contained (standalone + plugin). -->

---
description: Install the Project Factory loop (workflows, agents, check-* scripts, git hooks, CI, OpenSpec, templates) into the current repo — idempotent and non-destructive. Run once before any feature work.
argument-hint: "[--tools=claude,cursor,codex,copilot] [--with-automations] [--force]"
---

# /project-factory:init — install the loop

Install the framework's per-project loop into the **current repository** by
copying bundled files from the plugin (`${CLAUDE_PLUGIN_ROOT}`) and wiring them
up. This is **Gate G0**: no feature work before the loop that guards it exists.
The app stack itself (e.g. `create-next-app`) is NOT installed here — that is a
later orchestrator step after the stack decision; `init` is stack-agnostic.

Flags in `$ARGUMENTS`: `--tools=` selects which tool adapters to install
(default all — see step 10); `--with-automations` also installs the cloud
automations workflow; `--force` overwrites framework-owned files instead of skipping.

## Hard rules
- **Idempotent + non-destructive.** For every target: if it exists, SKIP and
  report it (unless `--force`); never clobber the user's code or config.
- **Merge, don't overwrite, structured config:** for `package.json` and
  `.claude/settings.json`, ADD missing keys only; keep everything already there.
- **Report at the end:** a table of what was *added* vs *skipped*.

## Steps

1. **Repo + dirs.** `git init` if not a repo. Create (if absent) `.claude/`,
   `scripts/`, `scripts/automations/lib/`, `docs/`, `docs/adr/`, `evals/cases/`,
   `evals/results/`, `.githooks/`, `.github/workflows/`, `openspec/`.
   **`.gitignore` must NOT ignore `docs/qa/**`** — QA evidence (videos,
   screenshots, reports) is committed PROOF. Ignore only temp: `node_modules/`,
   `coverage/`, and recording `**/raw/` scratch dirs. If a broader `docs/qa`
   ignore exists, fix it.

2. **Agents & workflows** (copy verbatim, skip-if-exists):
   - `${CLAUDE_PLUGIN_ROOT}/agents/*.md` → `.claude/agents/` (the plugin already
     provides these natively, but deliver project-local copies so the workflows
     resolve them by bare `agentType` name)
   - `${CLAUDE_PLUGIN_ROOT}/.claude/workflows/*.js` → `.claude/workflows/`

3. **Deterministic scripts** (copy + drop the `.reference` segment):
   - `scripts/check-traceability.reference.mjs` → `scripts/check-traceability.mjs`
     (same for `check-coverage-ratchet`, `check-eval-ratchet`, `check-trajectory`,
     `check-a11y`, `gate-status`, `qa-verify`).
   - `scripts/record-demos.reference.mjs` → `scripts/record-demos.mjs` (the
     headless recording+validation harness — demo and bugfix proof via `OUT_DIR`);
     `scripts/check-recordings.reference.mjs` → `scripts/check-recordings.mjs`.
   - `scripts/automations/{run,drift-watch,dep-audit,ci-triage}.reference.mjs`
     → `scripts/automations/*.mjs`; `scripts/automations/lib/*.mjs` verbatim;
     `automations/registry.json` → `automations/registry.json` (ships OFF).

4. **Git hooks.** Copy `templates/hooks/pre-commit.mjs` → `scripts/hooks-pre-commit.mjs`
   and `commit-msg.mjs` → `scripts/hooks-commit-msg.mjs`. Create `.githooks/pre-commit`
   and `.githooks/commit-msg` shell wrappers that `exec node scripts/hooks-*.mjs "$@"`.
   `git config core.hooksPath .githooks`. Then VERIFY they fire:
   `git commit --allow-empty -m "chore: verify hooks"` (expect the hooks to run).

5. **Claude Code hooks.** Merge `templates/hooks/claude-code-hooks.json` into
   `.claude/settings.json` (PostToolUse ESLint on agent edits) — additively.

6. **CI.** Copy `templates/ci/github-actions.yml` → `.github/workflows/ci.yml`
   (skip if a `ci.yml` already exists — report it so the user can merge by hand).
   With `--with-automations`, also copy `templates/ci/automations.yml`.

7. **OpenSpec.** `npx openspec init` if available; else create `openspec/project.md`
   + empty `openspec/specs/` matching the OpenSpec layout.

8. **Templates → docs** (fill placeholders from the detected/declared stack;
   skip-if-exists): `AGENTS.template.md` → `AGENTS.md`; create `CLAUDE.md`
   containing `@AGENTS.md`; `docs/context-architecture.template.md` →
   `docs/context-architecture.md` (+ ADR-0002); `evals/README.md` copied;
   `evals/results/.gitkeep` created.

9. **package.json scripts** (merge, add-missing-only): `lint`, `build`,
   `test:run`, `test:integration`, `test:e2e`, `test:coverage`, `qa:verify`,
   `qa:record-demos`, `qa:record-proof`, `check:trace`, `check:coverage`,
   `check:eval`, `check:trajectory`, `check:recordings`, `check:a11y`,
   `gate:status`. Point each at the copied `scripts/*.mjs`.
   Leave existing scripts untouched; adapt `qa-verify`'s battery to the scripts
   that actually exist.

10. **Multi-tool adapters** (so the repo runs in any AI tool). For each tool in
    `--tools` (default `claude,cursor,codex,copilot`), copy the matching entry
    files from the plugin root into the target, skip-if-exists:
    - **claude:** the agents/workflows above; the plugin provides the skill +
      commands globally — nothing extra to copy.
    - **cursor:** `.cursor/rules/project-factory.mdc`.
    - **copilot:** `.github/copilot-instructions.md` + `.github/prompts/project-factory-*.prompt.md`.
    - **codex:** `.codex/prompts/project-factory-*.md`.
    `AGENTS.md` (step 8) is the shared rules entry every tool reads. Copilot and
    Codex have no global plugin, so when either is selected also **vendor** the
    orchestration docs into `.project-factory/` (`MASTER-PROMPT.md`, `LOOP.md`,
    `checklists/quality-gates.md`, `skills/project-factory/`, `commands/`,
    `docs/portability.md`) and rewrite the copied adapters' references from the
    repo root to `.project-factory/` so they resolve there.

11. **Smoke + report.** Run `node scripts/check-traceability.mjs` (it should run,
    reporting warnings on a fresh repo — that's expected before Phase 1). Print
    the **added vs skipped** table (incl. which tool adapters were installed) and
    the exact next step (greenfield → start the orchestrator at Phase 1; existing
    → you arrived here via `/project-factory:onboard`, continue with
    reverse-engineering).
