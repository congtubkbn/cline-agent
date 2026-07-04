# `analysis.json` — Machine-Readable Analysis Contract

`analysis.json` is the analyzer's machine-first output: one self-contained JSON
document per parsed Cline run, designed so that an **AI model or a script can
evaluate the run without reading the raw trace**, and so an engineer can drill
from any conclusion back to the exact turn that produced it.

Produced by `parser.js` at:

- `<task-log-dir>/<taskId>_analysis.json` (next to the raw log)
- `web/tasks/<taskId>/analysis.json` (served to the dashboard)
- `analysis.json` (repo root, legacy convenience copy)

The same record is embedded as `flow.analysis` inside `flow_data.json`, and its
human twin is `<taskId>_analysis_report.md`.

## Design rules (the contract)

1. **Versioned.** `schemaVersion` follows semver. Additive changes bump minor;
   renames/removals bump major. Consumers must tolerate unknown fields.
2. **Stable enums.** `outcome.status`, finding `category`, `severity`,
   recommendation `target` and `priority` are closed vocabularies listed below.
   New values may be added; existing values are never renamed.
3. **Evidence is addressable.** Every finding carries `evidence[].ref` — a JSON
   path into `flow_data.json` (e.g. `turns[5].actions[0]`) or into the
   conformance block (`conformance.attribution.orphans`). An LLM can quote the
   ref; a script can resolve it; the dashboard turns it into a click.
4. **Bounded text.** Free text is clipped (prompt ≤ 500 chars, finding detail
   ≤ 600, completion preview ≤ 300). Full text lives in sidecar files referenced
   from `flow_data.json` — the record never bloats a context window.

## Top-level shape

```jsonc
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-07-04T14:20:29.334Z",
  "task":            { /* identity */ },
  "outcome":         { /* verdict */ },
  "metrics":         { /* run economics */ },
  "plan":            { /* plan adherence, null if no plan observed */ },
  "fta":             { /* fault tree */ },
  "findings":        [ /* flat, ranked fault list */ ],
  "recommendations": [ /* improvement advice per target */ ]
}
```

### `task`

| Field | Type | Notes |
| :-- | :-- | :-- |
| `id` | string | Cline task folder name |
| `prompt` | string | initial user prompt, clipped to 500 chars |
| `model` | object\|null | `{ modelId, mode }` |

### `outcome`

| Field | Type | Notes |
| :-- | :-- | :-- |
| `status` | enum | `completed` · `completed_with_faults` · `incomplete` |
| `healthScore` | int 0–100 | `100 − 40·critical − 15·major − 5·minor`, floored at 0. Comparable across runs of the same workflow — use it to trend skill changes. |
| `completionPreview` | string | first 300 chars of the agent's completion result |

### `metrics`

Run economics, all numeric: `turns`, `events`, `durationMs`,
`avgTurnDurationMs`, `tokensIn`, `tokensOut`, `cost`, `cacheReads`,
`cacheWrites`, `cacheHitRate` (0–1), `totalActions`, `errorActionCount`,
`errorTurns`.

### `plan` (nullable)

Where the expected plan came from and how execution tracked it.

| Field | Type | Notes |
| :-- | :-- | :-- |
| `source` | enum | `skill-contract` (steps parsed from an invoked skill's SKILL.md — most objective) · `self-declared` (agent's first task_progress checklist) |
| `adherenceScore` | 0–1 | fraction of initial plan steps kept in the final plan |
| `totalSteps` | int | size of the initial plan |
| `kept` / `dropped` / `added` | string[] | plan evolution: initial → final |
| `attribution` | object\|null | `{ attributed, orphanCount, totalActions }` — how many executed actions mapped to a plan phase |

### `fta` — Fault Tree Analysis

A classic FTA decomposition: one **top event** ("Degraded task outcome")
connected through OR/AND **gates** to observable **basic events**.

| Field | Type | Notes |
| :-- | :-- | :-- |
| `healthy` | bool | `true` = empty tree, no faults observed |
| `top` | node | nested tree, node shape below |
| `cutSets` | string[][] | minimal cut sets — smallest combinations of basic-event ids sufficient to trigger the top event. With the current OR-dominant tree each set has one element; AND gates would produce multi-element sets. |
| `severityCount` | object | `{ critical, major, minor }` |

Node shape:

```jsonc
{
  "id": "BE-ERR-0",            // stable within one record
  "type": "top" | "intermediate" | "basic",
  "gate": "OR" | "AND" | null,  // gates on top/intermediate nodes
  "label": "Action failed: cmd:npm test (×2)",
  "category": "action-error",  // basic events only — see enum below
  "severity": "major",         // basic events only
  "observed": { "count": 2, "rate": 0.071 },  // occurrences / denominator
  "evidence": [ { "turn": 5, "action": 0, "ref": "turns[5].actions[0]", "note": "..." } ],
  "children": [ /* nested nodes */ ]
}
```

Branch gates currently emitted (only when non-empty):
`G-EXEC` Execution faults · `G-PLAN` Plan deviation · `G-OUTCOME` Incomplete
outcome · `G-PERF` Efficiency degradation.

A Mermaid rendering of the tree ships as `flow.ftaMermaid` in `flow_data.json`
and inside the markdown report.

### `findings[]`

The flat, ranked view of the FTA basic events — the primary list an evaluator
(human or model) should iterate.

| Field | Type | Notes |
| :-- | :-- | :-- |
| `id` | string | `F001`, `F002`, … stable within one record |
| `category` | enum | see below |
| `severity` | enum | `critical` · `major` · `minor` |
| `title` | string | one-line statement of the fault |
| `detail` | string | evidence notes joined, ≤ 600 chars |
| `observed` | object | `{ count, rate }` |
| `evidence` | array | `{ turn, action, ref }` — `turn`/`action` are indexes into `flow_data.json`, `ref` is the JSON path; `null` turn means the evidence lives in the conformance block |
| `ftaEventId` | string | id of the corresponding FTA basic event |
| `suggestion` | string | category playbook advice (same text feeds recommendations) |

Finding categories (closed vocabulary):

| Category | Meaning | Default severity |
| :-- | :-- | :-- |
| `action-error` | a command/tool output matched an error pattern | major |
| `retry-loop` | the same action repeated consecutively with error(s) — thrash instead of progress | major |
| `plan-step-dropped` | a declared plan step was never executed | major if plan source is `skill-contract`, else minor |
| `off-plan-action` | executed actions matched no declared plan phase | minor |
| `no-completion` | run ended without `attempt_completion` | critical |
| `unfinished-checklist` | checklist items still open at end of run | major |
| `slow-turn` | turn duration > mean + 2σ | minor |
| `cost-spike` | turn API cost > mean + 2σ | minor |

### `recommendations[]`

Findings translated into improvement actions, sorted most-severe first.

| Field | Type | Notes |
| :-- | :-- | :-- |
| `target` | enum | `skill` (fix the SKILL.md) · `workflow` (fix the process/instructions) · `runtime` (fix the environment/efficiency) |
| `targetName` | string\|null | skill name(s) when `target` is `skill` and the evidence names one |
| `priority` | enum | `high` · `medium` · `low` (mapped from severity) |
| `text` | string | the advice |
| `findingIds` | string[] | which findings motivated it |

## How to consume it

**As an AI model** (evaluating or improving a skill/workflow): read
`outcome` + `plan` for the verdict, iterate `findings` most-severe first, and
resolve any `evidence[].ref` you need against `flow_data.json` (same folder).
Compare `healthScore` and `plan.adherenceScore` across runs of the same
workflow to measure whether a skill change helped.

**As an engineer**: open `<taskId>_analysis_report.md` for the rendered
verdict, fault-tree diagram and recommendations, or the dashboard's
**Analysis** tab (`node serve.mjs` → http://localhost:8099/) where evidence
links jump straight to the offending turn in the Simulator.
