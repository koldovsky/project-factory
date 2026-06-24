# New project (greenfield)

Empty directory, or no application code yet. Sequence:

## 1. Bootstrap the loop — `/project-factory:init`

It scaffolds the stack (default: **Next.js (App Router) · Postgres + Drizzle ·
Better Auth · Resend · Vitest · Playwright · OpenSpec · Vercel** — swap any piece
via an ADR if the requirements demand it), then installs the per-project loop:
workflows → `.claude/workflows/`, agents → `.claude/agents/`, `check-*` scripts,
git hooks (`core.hooksPath`), CI, OpenSpec init, filled templates (`AGENTS.md`,
`CLAUDE.md`, `docs/context-architecture.md` + ADR-0002), `evals/` scaffold,
`automations/registry.json` (OFF), and the `package.json` scripts. **Verify the
hooks fire** with a test commit. This is **Gate G0** — no feature work before it passes.

## 2. Run the playbook (Phases 1–8)

Follow [master-playbook.md](master-playbook.md) from Phase 1, honoring
[quality-gates.md](quality-gates.md) (G1–G8):

- **Phase 1** — `requirements-analyst` → numbered `FR/NFR/TC/BC` + product brief + a batched clarification list → **SCOPE SIGN-OFF** (G1).
- **Phase 2** — `spec-pipeline` workflow → baseline OpenSpec specs (every MVP FR owned once) (G2).
- **Phase 3** — capability plan: dependency-ordered slices, each marked `parallel-safe`/`serialize`, one owner per FR → **PLAN SIGN-OFF** (G3).
- **Phase 4** (per slice, parallelize the parallel-safe ones in worktrees): spec change → **tests(red)** (`test-engineer`) → **implement(green)** (`capability-implementer`) → battery → `review-gate` (persists `review-findings.json`) → `check-trajectory` → archive (G4).
- **Phase 5** — cross-cutting integration + E2E + seed helper (G5).
- **Phase 6** — `qa-documenter` QA pack + demo recordings + `eval-suite` (establish the eval baseline) (G6).
- **Phase 7** — global `review-gate` + `eval-suite` + `trajectory-eval` + `check-trajectory --release` + deploy + live smoke (G7).
- **Phase 8** — `uat-triage` whenever a bug report arrives (G8).

The orchestrator skill's operating rules (loop-first, maker≠checker, test-first,
gates-are-hard, honest reporting, model/effort tiers) apply throughout.
