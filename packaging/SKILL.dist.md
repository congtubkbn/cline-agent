---
name: cline-agent
description: >-
  Drive the Cline Agent Loop Analyzer (installed app) — clean generated
  artifacts or run a live-debug session on a Cline execution log. Use this
  skill whenever the user wants to analyze, debug, replay, or visualize a Cline
  agent run, parse a `ui_messages.json` log folder, clean the analyzer output,
  or open the analyzer dashboard at http://localhost:8099/. Triggers on phrases
  like "cline-agent", "analyze this cline log", "live debug the agent loop",
  "clean the analyzer", "parse my cline run", "open the cline dashboard", or
  any request to inspect a Cline agent's reasoning/turns. Prefer this skill
  over running node commands by hand so the parse→serve→open flow stays
  consistent.
---

# Cline Agent Analyzer (installed distribution)

This skill drives the Cline Agent Loop Analyzer **installed as an app** on this
machine — there is no source repository here. All commands run against the
install directory:

- Windows: `%USERPROFILE%\.cline-agent-analyzer`
- macOS / Linux: `~/.cline-agent-analyzer`

Call that path `<APP_DIR>` below. Resolve it first (e.g. in bash:
`APP_DIR="$HOME/.cline-agent-analyzer"`; in PowerShell:
`$APP_DIR = "$env:USERPROFILE\.cline-agent-analyzer"`).

**Before anything else**, verify the app is installed: `<APP_DIR>/version.json`
must exist. If it doesn't, stop and tell the user to run the installer they
were given (`node cline-agent-installer.mjs`) — do not try to reconstruct the
app. To report the installed version, read `version.json` (fields: `name`,
`version`, `builtAt`).

The skill exposes two operations behind a menu: **Clean** (reset generated
output) and **Live-debug** (parse a Cline log and open the interactive
dashboard). They are mutually exclusive and easy to confuse — cleaning wipes
generated files, live-debug produces them — so surface the choice up front
when intent is unclear.

## Step 1 — Present the menu

When triggered without a clear operation already stated, ask the user to pick
using the AskUserQuestion tool. Offer exactly these options:

- **Clean** — remove generated artifacts (legacy outputs, `web/flow_data.json`,
  `web/tasks/`, sidecars) from the installed app.
- **Live-debug** — ask for a Cline log folder, parse it, serve the dashboard,
  and open it in the browser.

If the user's message already makes the choice obvious (e.g. "clean the
analyzer" or "debug this run at C:\logs\task123"), skip the menu and go
straight to that operation. Don't ask redundant questions when intent is clear.

## Step 2a — Clean

Cleaning only removes regenerated output, never the app itself or the user's
raw logs, so it's safe to run without a heavy confirmation:

```bash
node "<APP_DIR>/clean.js"
```

Report which artifacts were removed (the command prints them) and stop. Don't
start the server after a clean.

## Step 2b — Live-debug

This is a three-part flow: **parse → serve → open**.

### Get the log folder

The parser needs a **folder**, not a single file. A valid Cline task folder
contains `ui_messages.json`, and usually `api_conversation_history.json` and
`task_metadata.json` alongside it. If the user names just `ui_messages.json`,
use its parent directory.

Ask for the folder path if it wasn't supplied. Prefer an **absolute path** (it
is used directly); a bare folder name is resolved against
`<APP_DIR>/cline-log/` if that exists. Before parsing, confirm the folder
exists and contains `ui_messages.json`; if not, tell the user what's missing
rather than running a parse that will throw.

Tip: Cline stores task logs under
`%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\tasks\<taskId>` on
Windows (similar under `~/Library/Application Support` / `~/.config` on
macOS/Linux) — useful when the user only knows the task id.

### Parse

Run the parser with the folder as its argument. Quote both paths — they may
contain spaces.

```bash
node "<APP_DIR>/parser.js" "<log-folder-path>"
```

A successful run prints `Parsing completed successfully.` and writes
`<APP_DIR>/web/flow_data.json` plus per-task data under `<APP_DIR>/web/tasks/`
that the dashboard reads. It also runs the analysis layer (plan conformance +
fault tree analysis) and writes `<taskId>_analysis.json` (machine-readable,
schema in `<APP_DIR>/docs/analysis-schema.md`) and
`<taskId>_analysis_report.md` (engineer report) next to the log. Mention these
to the user — they are the evaluation outputs, and the dashboard's **Analysis**
tab renders the same data. If the parse fails, surface the error and stop —
serving a stale or empty dataset is misleading.

### Serve

The dashboard is served by `serve.mjs` on port **8099**. The server is
long-lived (it blocks), so start it in the background and leave it running:

```bash
node "<APP_DIR>/serve.mjs"
```

Always run `node "<APP_DIR>/serve.mjs"` to ensure the server is active. The script automatically handles port reuse and workspace conflicts:
- If a server is already running for the current project, it will detect this and exit immediately without error (so it is safe to run it multiple times).
- If port 8099 is occupied by a server from a different project/location, it will request that server to shutdown and start the new one in its place.
- If it is occupied by a different application entirely, it will report an error.

### Open the dashboard

Open the URL in the user's default browser.

- Windows: `cmd.exe /c start "" "http://localhost:8099/"` (PowerShell:
  `Start-Process "http://localhost:8099/"`)
- macOS: `open "http://localhost:8099/"`
- Linux: `xdg-open "http://localhost:8099/"`

Then tell the user the dashboard is live at http://localhost:8099/ and that
they can use the Simulator / Performance / Flowchart / Inspector tabs to step
through the parsed run.

## Re-parsing another log

To analyze a different run while the server is already up: re-run
`node "<APP_DIR>/parser.js" "<new-folder>"` (this overwrites
`web/flow_data.json`), then have the user refresh the browser. No need to
restart the server.

## Watching a live-updating log

If the task is still running in Cline (its `ui_messages.json` is actively
being appended to), add `--watch` instead of manually re-running the parser
after every turn:

```bash
node "<APP_DIR>/parser.js" "<log-folder-path>" --watch
```

This keeps the process running in the foreground and re-parses automatically
whenever `ui_messages.json`, `api_conversation_history.json`, or
`task_metadata.json` change (debounced, so a burst of writes for one turn
only triggers one re-parse). Start it in the background alongside `serve.mjs`
and tell the user to just refresh the browser to see new turns. A change
caught mid-write is skipped with a logged warning and retried on the next
change, so it's safe to leave running for the life of the task. Stop it with
Ctrl+C (or kill the background job) once the task finishes.

## Upgrading

If the user says the analyzer is outdated or hands you a new
`cline-agent-installer.mjs`, run `node cline-agent-installer.mjs` — it
overwrites `<APP_DIR>` and this skill in place. Never hand-edit files inside
`<APP_DIR>`; they are generated bundles and will be overwritten on the next
install.

## Notes

- `node` (v18+) must be on PATH.
- The app files in `<APP_DIR>` are a minified distribution — don't try to read
  or debug them; report issues to whoever shared the installer instead.
- Parsed logs and generated output may contain sensitive trace content — don't
  commit or share them without asking the user.
