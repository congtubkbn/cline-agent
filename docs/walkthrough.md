# cline-analyzer-agent — Walkthrough

Generic analyzer for **Cline agent task logs**. Parses any `ui_messages.json` (+ siblings) into a
flow report and an interactive web app: timeline, reasoning, tool calls, intent, telemetry charts,
step-through simulation, and a flow-logic diagram.

![web app](screenshot.png)

## 1. What it does

Given a Cline task dir (`cline-log/<taskId>/` holding `ui_messages.json`,
`api_conversation_history.json`, `task_metadata.json`), it reconstructs the agent loop:

```
task prompt ──► [ api_req_started ──► reasoning ──► tool/command ──► output ]×N ──► completion
```

For the sample run `1782757522666` (prompt **"qualcomm sync 08381225"**):

| Metric | Value |
|--------|-------|
| Turns (loop iterations) | 29 |
| UI events | 199 |
| Tokens in / out | 330,145 / 12,664 |
| Cache reads | 949,248 |
| Cost | 0 |
| Wall time | ~268 s |
| Commands run | 24 · Tool calls | 4 |

## 2. Run the parser

```bash
node parser.js <task-dir|root> [--out DIR] [--threshold N] [--batch]
```

- `node parser.js cline-log/1782757522666` → analyzes one task.
- `node parser.js cline-log --batch` → analyzes **every** task dir under `cline-log/`.
- `--threshold N` → text truncation budget in tokens (default 200).

Outputs to `out/<taskId>/`:

| File | Contents |
|------|----------|
| `flow_report.md` | Human-readable flow: prompt, per-turn reasoning/actions/intent/output, Mermaid diagram, completion. |
| `flow_data.json` | Machine model (consumed by the web app + future LLM judge). |
| `flow.mmd` | Mermaid flow-logic graph. |
| `sidecar/` | Full text of every truncated block. |

## 3. Text policy

Long text is never dumped raw and never lost:

1. **Preview** — first ~200 tokens (`threshold` × 4 chars), ends with `…`.
2. **Summary** — one-line gist.
3. **Sidecar** — full text in `sidecar/<id>.txt`, referenced by path; `fullLen` records original length.

Verified round-trip: 19 truncated blocks in the sample, each sidecar's byte length equals its
`fullLen`.

## 4. Intent ("why")

Every tool/command action carries `{ what, why }`. `what` = the tool id + args; `why` = the intent
mined from the same turn's reasoning (keyword-matched sentence, ≥3-char keywords, falls back to the
last reasoning sentence). This is the hook the next phase (expected-vs-actual conformance) compares
against.

## 5. Web app

```bash
node serve.mjs            # serves web/ on http://localhost:8099
```

Open `http://localhost:8099`. Sections:

- **Telemetry** — Chart.js: tokens in/out per turn (bar), latency per turn (line).
- **Simulation** — `▶ Play` / `⏭ Step` / `⟲ Reset` walk the turns; active turns highlight and
  scroll into view. Mermaid flow diagram above.
- **Flow** — every turn: reasoning, actions (with `why`), command output. Long text shows an
  `▼ full` expander pulling from the sidecar.
- **Expected vs Actual** — reserved placeholder for the conformance phase.

> Serve over HTTP, not `file://` — sidecar expansion and `flow_data.json` use `fetch`.
> Load a different run by picking its `flow_data.json` with the file input.

## 6. Genericity

No task/skill/model names are hardcoded. Unknown `say`/`ask` subtypes are preserved as `raw`
events (never dropped, never crash). Missing optional files degrade gracefully. Bad/unreadable
paths are reported, not thrown. Point it at any same-format log.

## 7. Architecture (modules)

| File | Responsibility |
|------|----------------|
| `src/loader.js` | Read + validate + decode + join the 3 files → `NormalizedRun`. |
| `src/turns.js` | Group events into agent-loop turns. |
| `src/intent.js` | Extract per-action intent from reasoning. |
| `src/text-policy.js` | Truncate + summary + sidecar. |
| `src/diagram.js` | Mermaid flow-logic graph. |
| `src/flow.js` | Assemble `FlowModel` + totals. |
| `src/render-md.js` | `flow_report.md`. |
| `parser.js` | CLI: discover, parse, write outputs. |
| `web/` | `index.html` + `style.css` (glassmorphism) + `app.js` (render, sim, charts). |

Tests: `node --test` (12 passing) — schema validation, unknown-subtype tolerance, turn grouping
(29 on the sample), intent, text-policy round-trip, diagram, flow assembly, markdown render.

## 8. Next phase

- **L3 Expectation** — derive expected workflow (skill contract / task_progress / external spec / LLM).
- **L4 Conformance** — side-by-side **Expected | Actual** with mismatch markers + diagram overlay.
- **L5 Simulator** — dry-run annotation + opt-in re-exec.
- **L6 Review** — human review UI + LLM judge.

See the spec: [`docs/superpowers/specs/2026-06-30-cline-analyzer-design.md`](superpowers/specs/2026-06-30-cline-analyzer-design.md).
