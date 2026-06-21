# Automations — the standing factory (optional, off by default)

Scheduled, unprompted jobs that watch the project and **surface findings for a
human** — the Loop Engineering "Automations" primitive, in a deliberately
pragmatic form. They **propose, never push**: every run writes a report (and
optionally opens an issue); none of them ever edits or merges code.

> **Ships OFF.** Nothing runs until you flip the master switch in
> [`registry.json`](registry.json). You also choose **local or cloud** per
> automation — the job logic is identical either way.

## Why this can't surprise-bill: cost tiers

| Tier | What it does | Cost |
|---|---|---|
| **0** | Runs the framework's existing exit-coded checks on a timer (trace/coverage/eval freshness, OpenSpec & handoff hygiene, `npm audit`) | **$0 — no LLM** |
| **1** | *Only when a Tier-0 check is red / CI fails:* one capped **Haiku** call summarizes the cause and proposes a next step | cents, on-red only |
| **2** | Re-grade a sample of evals / a bounded `review-gate` bug-hunt (invokes existing workflows) | **$, opt-in, off by default** |

Tier 0 is the workhorse and spends nothing. Tokens are spent only when
something is actually wrong (Tier 1) or when you explicitly opt in (Tier 2).

## The four off-switches (default = fully off)

1. **Master switch** — `"enabled": false` in `registry.json`. The whole layer.
2. **Per-automation** — each entry's `"enabled"`. Turn one on/off.
3. **Env hard-kill** — `AUTOMATIONS_ENABLED=0` overrides everything, even
   `--force`. (Set it as a CI variable to freeze automations instantly.)
4. **Don't install a scheduler** — with no cron/Task Scheduler/Action wired,
   nothing is scheduled; you can still run jobs by hand.

Plus two standing guarantees the registry **cannot** override: `writeCode:false`
(propose-only) and Tier-2 workflows additionally gated by
`AUTOMATIONS_RUN_WORKFLOWS=1`.

## Run it by hand

```bash
node scripts/automations/run.mjs --list             # status of every automation
node scripts/automations/run.mjs --dry-run drift-watch
node scripts/automations/run.mjs drift-watch        # runs if enabled…
node scripts/automations/run.mjs drift-watch --force --no-gh   # …or force, report-only
node scripts/automations/run.mjs --all-due --schedule nightly  # what a nightly trigger runs
```

Output lands in `docs/automations/<id>-<date>.md` (committed evidence). When an
automation finds something actionable and `gh` is available, it also opens a
GitHub issue; otherwise it appends to `docs/automations/INBOX.md`.

## Turn it on

1. Set `"enabled": true` in `registry.json` (and confirm each automation's own
   `enabled`).
2. Pick where it runs:
   - **Local** — follow [`../templates/automations/local-setup.md`](../templates/automations/local-setup.md)
     (Windows Task Scheduler / cron, or the Claude Code `/loop` for in-session cadence).
   - **Cloud** — add [`../templates/ci/automations.yml`](../templates/ci/automations.yml)
     to `.github/workflows/`; set repo secrets (`ANTHROPIC_API_KEY` for Tier 1)
     and the repo variable `AUTOMATIONS_ENABLED=1`.
3. For Tier-1 triage summaries, export `ANTHROPIC_API_KEY` (locally) or add it
   to CI secrets. Without it, Tier-0 findings still ship — just without the
   prose summary (honest degradation).

## Registry shape

```jsonc
{
  "enabled": false,                       // master switch
  "defaults": { "model": "claude-haiku-4-5-20251001", "maxTokens": 20000,
                "timeoutSec": 180, "writeCode": false, "output": ["report","issue"] },
  "automations": [
    { "id": "drift-watch", "enabled": true, "tier": 0, "schedule": "nightly",
      "run": "node scripts/automations/drift-watch.mjs", "summarizeOnRed": true },
    { "id": "eval-drift",  "enabled": false, "tier": 2, "schedule": "weekly",
      "workflow": "eval-suite", "args": { "sample": 5 }, "budget": { "maxTokens": 150000 } }
  ]
}
```

`schedule` is a label (`nightly` / `weekly` / `on-ci-failure` / `manual`); the
**scheduler trigger** decides cadence (so the same registry works on an
ephemeral cloud runner with no state file).

## Add an automation

- **Deterministic (Tier 0):** add a `scripts/automations/<id>.mjs` that runs
  checks and prints `{ id, title, ok, red, findings:[{level,check,detail}] }` to
  stdout; add a registry entry with `"run"`. Reuse existing `check:*` scripts.
- **Cheap triage (Tier 1):** same, but call the bounded helper in
  `scripts/automations/lib/llm.mjs` for the summary.
- **Heavy (Tier 2):** add a registry entry with `"workflow"` + `"args"` +
  `"budget"`; it stays off until you enable it *and* set
  `AUTOMATIONS_RUN_WORKFLOWS=1`.
