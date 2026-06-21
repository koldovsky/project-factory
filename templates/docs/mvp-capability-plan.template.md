# MVP Capability Change Plan

**Step 4 of the SDD process** — split the MVP into capability changes that the
delivery loop executes one-by-one (proposal → spec deltas → design → tasks →
implementation → tests → review gate → archive).

> Inputs: `docs/product-brief.md`, `docs/requirements.md`, and the baseline
> specs under `openspec/specs/`.

## 1. Slicing principles

1. One slice ≈ one cohesive capability, sized to design/build/test/archive as
   a unit.
2. Dependency-respecting order — foundations first; no slice depends on a
   sibling shipping after it.
3. One owner per requirement — every MVP FR assigned to exactly one slice
   (no gaps, no duplicates). Domain-bound NFRs travel with their domain;
   cross-cutting NFRs are honored by every slice.
4. Baseline-spec aligned; bundle multiple specs only when tightly coupled.
5. Naming: kebab-case `add-<capability>` under `openspec/changes/`.

## 2. The capability changes

| # | Change name | Baseline specs touched | MVP FRs | NFRs travelled | Depends on | Parallel |
|---|---|---|---|---|---|---|
| 1 | `add-identity-and-access` | … | … | … | — | serialize (migrations) |
| 2 | … | … | … | … | 1 | parallel-safe (disjoint modules) |

**Parallel** = `parallel-safe` (disjoint modules, no shared migration → may run
concurrently in a worktree) or `serialize` (touches migrations or a shared
module). Default to parallel-safe only when you can prove the disjointness.

**Cross-cutting NFRs every change MUST honor:** {{list NFR ids + summary}}.

## 3. Dependency graph

```mermaid
flowchart LR
    a["1. add-…"] --> b["2. add-…"]
```

**Critical path:** {{…}}. **Parallelizable:** {{which `parallel-safe` slices run
concurrently in isolated worktrees, after what}} — disjoint modules, no shared
migration. Everything touching migrations or a shared module stays serialized.

## 4. Per-change scope and exit criteria

### 4.x `add-<capability>`

- **Scope in:** {{…}}
- **Scope out:** {{explicit exclusions with FR/TC refs}}
- **Baseline spec impact:** {{…}}
- **Definition of done:** {{3-6 objectively checkable bullets, citing NFR
  budgets where relevant}}
- **Risks:** {{ADR-worthy decisions, open questions to resolve before build}}

## 5. FR coverage check

| FR | Slice | FR | Slice | FR | Slice |
|---|---|---|---|---|---|
| FR-1 | 1 | … | … | … | … |

Total: **{{N}} MVP FRs across {{M}} slices** (no gaps, no duplicates).

## 6. Sequencing

Implement in dependency order; after each archive run
`npx openspec validate --all --strict` before starting the next slice.
Future-Phase work is NOT in this plan.
