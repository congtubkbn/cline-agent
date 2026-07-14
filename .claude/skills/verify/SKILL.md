---
name: verify
description: >-
  Build/launch/drive recipe for verifying changes to this repo at its two
  runtime surfaces: the parser CLI (parser.js, incl. --watch) and the
  dashboard GUI (serve.mjs + web/). Use when a change needs end-to-end
  verification rather than code reading.
---

# Verifying the Cline Agent Analyzer

Two surfaces. No build step — plain Node (v18+) and static files.

## CLI surface (parser.js)

- Sample log ships in `cline-log/1782757522666`. Copy it to a scratch dir
  before mutating it — the watcher writes sidecar/report files *into* the
  task folder, and raw logs shouldn't be dirtied.
- One-shot: `node parser.js "<folder>"` → expect `Parsing completed successfully.`
- Watch mode: `node parser.js "<folder>" --watch` in the background with
  output redirected to a log file; drive it by rewriting files in the folder:
  - normal change: `cat backup > folder/ui_messages.json`
  - mid-write/partial JSON: `head -c <half> backup > folder/ui_messages.json`
  - watch output lines are prefixed `[watch]`; debounce is 500ms, failed
    parses retry on a 2s timer up to 5 times, budget resets on any new
    file event.
- Watcher pollution: each parse writes `web/tasks/<taskId>/` and prepends an
  entry to `web/tasks.json`. Remove the test task's entry and dir afterwards
  (they're gitignored, but they leak into any dashboard session).

## GUI surface (web/ dashboard)

- Serve: `node serve.mjs` (port 8099, long-lived — background it).
- Drive headless with `playwright-core` (npm-install it in the scratchpad;
  `playwright` itself isn't needed) + the pre-installed browser at
  `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`.
- Gotchas that cost time:
  - Launch Chromium with `args: ['--no-proxy-server']` — otherwise localhost
    goes through the agent proxy and fails with ERR_TUNNEL_CONNECTION_FAILED.
  - `index.html` pulls lucide / chart.js / mermaid from CDNs that the network
    policy blocks. npm-install those three packages (registry.npmjs.org is
    allowed) and `page.route()` the CDN URLs to the local dist files
    (`lucide/dist/umd/lucide.min.js`, `chart.js/dist/chart.umd.js`,
    `mermaid/dist/mermaid.min.js`). Abort fonts.googleapis.com — cosmetic only.
  - Top-level `let` state in `web/app.js` (`flowData`, `currentTaskId`,
    `isPlaying`, `currentStepIndex`) is reachable from `page.evaluate` as bare
    identifiers, but NOT as `window.*` properties.
  - Auto-refresh minimum interval is 10s, so timer-driven assertions need
    ~12-15s sleeps; to probe refresh logic without the timer racing you, set
    `localStorage.analyzerAutoRefresh = {"intervalMs":0,"mode":"auto"}` and
    call `checkForUpdates()` manually.
- Useful flow: watcher running on the scratch task copy + rewriting
  `ui_messages.json` is the cleanest way to bump `parsedAt` in
  `web/tasks.json` and exercise the dashboard's update path for real.
