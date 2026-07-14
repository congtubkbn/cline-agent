---
name: cline-agent
description: >-
  Drive the Cline Agent Loop Analyzer in this repo — clean generated artifacts or
  run a live-debug session on a Cline execution log. Use this skill whenever the
  user wants to analyze, debug, replay, or visualize a Cline agent run, parse a
  `ui_messages.json` log folder, clean the analyzer output, or open the analyzer
  dashboard at http://localhost:8099/, or build the shareable single-file
  installer. Triggers on phrases like "cline-agent", "analyze this cline log",
  "live debug the agent loop", "clean the analyzer", "parse my cline run",
  "open the cline dashboard", "package the analyzer", "build the installer",
  or any request to inspect a Cline agent's reasoning/turns. Prefer this skill
  over running npm/node commands by hand so the menu and the parse→serve→open
  flow stay consistent.
---

# Cline Agent Analyzer

This skill runs the Cline Agent Loop Analyzer (this repository) for the user. It
exposes three operations behind a menu: **Clean** (reset generated output),
**Live-debug** (parse a Cline log and open the interactive dashboard), and
**Package** (build the single-file installer to share with other machines).

The point of the menu is that Clean and Live-debug are mutually exclusive and
easy to confuse — cleaning wipes generated files, live-debug produces them.
Surfacing the choice up front prevents accidentally deleting a freshly-parsed
run.

## Step 1 — Present the menu

When triggered without a clear operation already stated, ask the user to pick
using the AskUserQuestion tool. Offer exactly these options:

- **Clean** — run `npm run clean` to remove generated artifacts (`out/`,
  `flow_data.json`, `flow_report.md`, `flow_report.html`, `web/flow_data.json`,
  `web/sidecar/`).
- **Live-debug** — ask for a Cline log folder, parse it, serve the dashboard, and
  open it in the browser.
- **Package** — run `npm run package` to build the shareable installer
  (`dist/cline-agent-installer.mjs`).

If the user's message already makes the choice obvious (e.g. "clean the analyzer"
or "debug this run at C:\logs\task123"), skip the menu and go straight to that
operation. Don't ask redundant questions when intent is clear.

## Step 2a — Clean

Cleaning only removes regenerated output, never source code or the user's raw
logs under `cline-log/`, so it's safe to run without a heavy confirmation. Run it
from the repo root:

```bash
npm run clean
```

Report which artifacts were removed (the command prints them) and stop. Don't
start the server after a clean.

## Step 2b — Live-debug

This is a three-part flow: **parse → serve → open**.

### Get the log folder

The parser needs a **folder**, not a single file. A valid Cline task folder
contains `ui_messages.json`, and usually `api_conversation_history.json` and
`task_metadata.json` alongside it. If the user names just `ui_messages.json`, use
its parent directory.

Ask for the folder path if it wasn't supplied. Accept either an absolute path
(used directly) or a folder name that lives under `cline-log/` (the parser
resolves it automatically). Before parsing, confirm the folder exists and
contains `ui_messages.json`; if not, tell the user what's missing rather than
running a parse that will throw.

### Parse

Run the parser with the folder as its argument. Quote the path — Windows paths
contain spaces.

```bash
node parser.js "<log-folder-path>"
```

A successful run prints `Parsing completed successfully.` and writes
`web/flow_data.json` plus sidecar files that the dashboard reads. It also writes
two per-run reports next to the log: `<taskId>_flow_report.md` (for git/sharing;
has a jump-to-turn TOC and collapsible turn bodies) and `<taskId>_flow_report.html`
— a single self-contained file built for debugging: sticky turn index, an
errors-only filter, `#turn-N` deep links, and an in-page modal for full text (no
new tabs). Point users at the HTML when a run is long and they need to navigate;
sidecar `.txt` files carry a banner naming their turn and linking back to the
report. It also runs the analysis layer (plan conformance + fault tree analysis)
and writes `<taskId>_analysis.json` (machine-readable, schema in
`docs/analysis-schema.md`) and `<taskId>_analysis_report.md` (engineer report).
Mention these to the user — they are the evaluation outputs, and the dashboard's
**Analysis** tab renders the same data. If the parse fails, surface the error
and stop — serving a stale or empty dataset is misleading.

### Serve

The dashboard is served by `serve.mjs` on port **8099**. The server is long-lived
(it blocks), so start it in the background and leave it running:

```bash
node serve.mjs
```

If port 8099 is already serving (a server from an earlier run), reuse it — don't
start a second one. A quick way to check is hitting `http://localhost:8099/`; a
200 means it's already up.

### Open the dashboard

Open the URL in the user's default browser. On this Windows machine:

```bash
cmd.exe /c start "" "http://localhost:8099/"
```

(PowerShell equivalent: `Start-Process "http://localhost:8099/"`.)

Then tell the user the dashboard is live at http://localhost:8099/ and that they
can use the Simulator / Performance / Flowchart / Inspector tabs to step through
the parsed run.

## Step 2c — Package

Build the distributable single-file installer from the repo root:

```bash
npm run package
```

(If it fails because `esbuild` is missing, run `npm install` first, then retry.)

The build bundles and minifies the app (`src/` gets inlined into the entry
points) and writes `dist/cline-agent-installer.mjs`. Tell the user that this
one file is all they need to share: on the other machine,
`node cline-agent-installer.mjs` installs the app to `~/.cline-agent-analyzer`
and the `cline-agent` skill to `~/.claude/skills/cline-agent/`. After source
changes, re-running Package and re-sharing the new installer is the whole
release flow. Details live in `docs/packaging.md`.

## Re-parsing another log

To analyze a different run while the server is already up: re-run
`node parser.js "<new-folder>"` (this overwrites `web/flow_data.json`), then have
the user refresh the browser. No need to restart the server.

## Watching a live-updating log

If the task is still running in Cline (its `ui_messages.json` is actively being
appended to), add `--watch` instead of manually re-running the parser after
every turn:

```bash
node parser.js "<log-folder-path>" --watch
```

This keeps the process running in the foreground and re-parses automatically
whenever `ui_messages.json`, `api_conversation_history.json`, or
`task_metadata.json` change (debounced, so a burst of writes for one turn only
triggers one re-parse). Start it in the background alongside `serve.mjs` and
tell the user to just refresh the browser to see new turns — no need to
re-invoke the parser by hand. A change caught mid-write is skipped with a
logged warning and retried on the next change, so it's safe to leave running
for the life of the task. Stop it with Ctrl+C (or kill the background job)
once the task finishes.

## Notes

- Run all commands from the repo root (where `package.json`, `parser.js`, and
  `serve.mjs` live).
- `node` (v18+) must be on PATH. If it isn't, `parser.ps1` is a PowerShell
  fallback for the parse step.
- Raw logs and generated output are git-ignored on purpose (they may contain
  sensitive trace content) — don't commit them.
