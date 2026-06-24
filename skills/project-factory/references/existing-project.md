# Existing project (retrofit + reverse-engineer)

The repo already has code. Bring it under spec-driven control **without clobbering
what exists**, then govern all new work through the gates. Onboarding only
**documents and installs** — it never rewrites existing code.

## 1. Detect & decide the stack
Read `package.json`, the framework + version, dir layout, test setup, and CI.
Record findings as **ADR-0001** (adopt the existing stack; do not migrate unless
the user asks). Adapt the loop to what's there (e.g. the package manager, the
test runner) instead of imposing the default stack.

## 2. Install the loop — `/project-factory:onboard` (runs `init` in merge mode)
Add workflows + agents + `check-*` scripts + git hooks + CI + OpenSpec + filled
templates + `package.json` scripts **WITHOUT overwriting existing config**: merge
`.claude/settings.json`, CI, and hooks; skip files that already exist; adapt
`qa-verify`'s battery to the scripts the project actually has. **Report what was
added vs skipped.** (If the repo already has hooks/CI, integrate, don't replace.)

## 3. Reverse-engineer the baseline (the retrofit core)
- **`requirements-analyst` (from-existing-code mode):** read the codebase (routes,
  schema, services, UI, tests) and infer `docs/requirements.md` — `FR/NFR`
  describing what the system **already does** — plus a product brief. Mark every
  inferred item as an **ASSUMPTION**.
- **`spec-writer` (from-existing-code mode):** author baseline OpenSpec specs for
  current behavior, treated as **already-implemented** (the code is the proof).
  Where behavior is genuinely unclear, record a **gap**, don't guess.
- Run `check-traceability` to map which existing tests/modules cover which
  inferred FRs; **gaps are recorded, not hidden** (they become candidate work).

## 4. CHECKPOINT — baseline sign-off
Present the inferred requirements + baseline specs + the coverage/gap report. The
user **confirms or corrects** before any of it is treated as the source of truth.
Reverse-engineering is a hypothesis; the human ratifies it. (This is the
onboard-only checkpoint named in the orchestrator skill §4.)

## 4b. Retrofit honesty — record it
Legacy code enters the chain as **baseline**, but its historical **red-first
slice history cannot be reconstructed** — there were no failing-tests-first
commits to point at. Write the onboarded baseline slices to
`.project-factory/retrofit.json` (`{ "slices": ["<name>", …] }`) so
`node scripts/gate-status.mjs` flags them as **RETROFITTED, not earned**. Only
NEW slices get genuine red-first evidence. Never present a retrofitted gate as if
it were earned through the process.

## 5. Capability plan for NEW work only
Existing behavior is the **baseline**; the plan covers changes/additions going
forward, each a gated slice (`parallel-safe`/`serialize` as usual).

## 6. Govern forward
Every new slice runs the full Phase 4 loop (tests-first → implement → battery →
review-gate → check-trajectory → archive). Legacy code is now in the spec/trace
chain, so new work can't silently drift from it. When you later touch legacy code,
write/raise its spec first (promote the baseline to an active change).

---

**`--no-reverse` fallback:** skip steps 3–4. Install the loop and govern only NEW
slices, leaving legacy code outside the spec chain — lighter and faster, but
without the baseline coverage. Offer this when the codebase is huge or the user
wants speed over completeness.

**Safety:** onboarding is non-destructive and read-only toward existing code.
Any change to existing behavior happens **later**, as a gated slice the user approves —
never silently during onboarding.
