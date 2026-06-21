# Deterministic Hooks — Installation

Three hook layers close the inner loop. Install ALL of them in Phase 0,
before the first feature commit ("no code before the loop that catches its
bugs exists").

## 1. Git hooks (machine gate on every commit)

```bash
mkdir -p .githooks scripts quality
cp project-factory/templates/hooks/pre-commit.mjs scripts/hooks-pre-commit.mjs
cp project-factory/templates/hooks/commit-msg.mjs scripts/hooks-commit-msg.mjs
```

Create `.githooks/pre-commit` (LF line endings, executable):

```bash
#!/bin/sh
node scripts/hooks-pre-commit.mjs
```

Create `.githooks/commit-msg`:

```bash
#!/bin/sh
node scripts/hooks-commit-msg.mjs "$1"
```

Activate and verify:

```bash
git config core.hooksPath .githooks
git commit --allow-empty -m "chore: verify hooks fire"
```

Policy: hooks are never bypassed with `--no-verify`. If a hook blocks a
legitimate commit, fix the hook (and commit that fix), don't skip it.

## 2. Claude Code hooks (feedback inside the agent's edit loop)

Merge `claude-code-hooks.json` into the project's `.claude/settings.json`.
It runs ESLint on every file the agent writes/edits, so the agent sees
violations immediately instead of at the gate.

## 3. CI (the loop nobody can skip)

Copy `project-factory/templates/ci/github-actions.yml` to
`.github/workflows/ci.yml`. CI re-runs everything the local hooks ran PLUS
the slow battery, with `--check-fresh` so generated artifacts (traceability
report) cannot go stale, and `--release` on the main branch so no active
OpenSpec change can slip into production.
