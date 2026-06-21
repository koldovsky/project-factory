# Automations (local adapter) — run on your own machine

Three ways to schedule the dispatcher locally. All call the same entry point:

```bash
node scripts/automations/run.mjs --all-due --schedule nightly   # or: weekly
```

The dispatcher must run **with the project root as the working directory** (it
resolves `automations/registry.json` and `scripts/` from `cwd`). Set
`ANTHROPIC_API_KEY` in the environment if you want Tier-1 triage summaries;
without it, Tier-0 findings still ship.

> **On/off, local:** flip `"enabled"` in `automations/registry.json`, or disable
> the scheduled task, or set `AUTOMATIONS_ENABLED=0` (hard kill) /
> `AUTOMATIONS_ENABLED=1` (force on) in the task's environment.

## A. Windows Task Scheduler (recommended on Windows)

PowerShell (sets the working directory and runs nightly at 03:00):

```powershell
$proj = "C:\path\to\your-project"
$action  = New-ScheduledTaskAction -Execute "node" `
  -Argument "scripts\automations\run.mjs --all-due --schedule nightly" -WorkingDirectory $proj
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "pf-automations-nightly" -Action $action -Trigger $trigger
# Weekly: New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 4am  → "pf-automations-weekly"
```

Make the key visible to the task (once): `setx ANTHROPIC_API_KEY "sk-ant-…"`.
Disable / re-enable / remove:

```powershell
Disable-ScheduledTask -TaskName "pf-automations-nightly"
Enable-ScheduledTask  -TaskName "pf-automations-nightly"
Unregister-ScheduledTask -TaskName "pf-automations-nightly" -Confirm:$false
```

## B. cron (macOS / Linux)

```cron
# crontab -e   (load your key from a file your shell sources)
0 3 * * *  cd /path/to/project && /usr/bin/node scripts/automations/run.mjs --all-due --schedule nightly >> /tmp/pf-automations.log 2>&1
0 4 * * 1  cd /path/to/project && /usr/bin/node scripts/automations/run.mjs --all-due --schedule weekly  >> /tmp/pf-automations.log 2>&1
```

Turn off: comment the lines (`crontab -e`) or set `AUTOMATIONS_ENABLED=0`.

## C. Claude Code `/loop` (in-session, while you work)

For cadence only while you have Claude Code open — handy for Tier-1 during a
work session, no OS scheduler needed:

```
/loop 8h  run the automations dispatcher: node scripts/automations/run.mjs --all-due --schedule nightly
```

Stop it by ending the loop. This is the lightest option; it does **not** run
when the session is closed (use A or B for that).

## Surfacing locally

Reports always land in `docs/automations/<id>-<date>.md`. For the
"issue" output, install + auth the GitHub CLI (`gh auth login`); without it,
actionable findings are appended to `docs/automations/INBOX.md` instead.
