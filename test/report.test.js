import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../src/loader.js';
import { analyze } from '../src/analyze.js';
import { buildFaultTree, ftaToMermaid } from '../src/fta.js';
import { buildAnalysisRecord, renderAnalysisMarkdown, SCHEMA_VERSION } from '../src/report.js';

function record(flow, conformance = null) {
  const fta = buildFaultTree(flow, conformance);
  return { fta, rec: buildAnalysisRecord({ flow, expected: null, conformance, fta }) };
}

const baseFlow = {
  taskId: 't1', prompt: 'p'.repeat(600), model: { modelId: 'm', mode: 'act' },
  turns: [{
    index: 0, tsStart: 0, tsEnd: 500, durationMs: 500, hasError: true,
    request: { tokensIn: 10, tokensOut: 5, cost: 0.01, cacheReads: 3, cacheWrites: 1 },
    reasoning: null,
    actions: [{ kind: 'command', ts: 0, what: { command: 'npm test' }, why: '', text: null, output: { ts: 1, isError: true } }],
    taskProgress: null, checkpoint: null
  }],
  totals: { turns: 1, events: 3, tokensIn: 10, tokensOut: 5, cost: 0.0123456, cacheReads: 3, cacheWrites: 1, durationMs: 500 },
  completion: { preview: 'done', summary: '', sidecar: '', fullLen: 4 }
};

test('buildAnalysisRecord produces a versioned, bounded, evidence-linked record', () => {
  const { rec } = record(baseFlow);
  assert.equal(rec.schemaVersion, SCHEMA_VERSION);
  assert.equal(rec.task.id, 't1');
  assert.ok(rec.task.prompt.length <= 500, 'prompt is clipped');
  assert.equal(rec.outcome.status, 'completed_with_faults');
  assert.ok(rec.outcome.healthScore < 100 && rec.outcome.healthScore >= 0);
  assert.equal(rec.metrics.errorActionCount, 1);
  assert.equal(rec.metrics.cacheHitRate, 0.75);
  // findings mirror FTA basic events with JSON-path evidence
  assert.ok(rec.findings.length >= 1);
  const f = rec.findings.find(x => x.category === 'action-error');
  assert.match(f.id, /^F\d{3}$/);
  assert.match(f.evidence[0].ref, /^turns\[0\]\.actions\[0\]$/);
  assert.ok(f.suggestion.length > 0);
  // recommendations reference finding ids and carry a priority
  assert.ok(rec.recommendations.length >= 1);
  assert.ok(rec.recommendations.every(r => ['high', 'medium', 'low'].includes(r.priority)));
  assert.ok(rec.recommendations.every(r => r.findingIds.length >= 1));
});

test('clean run yields completed status, empty findings and full health', () => {
  const clean = {
    ...baseFlow,
    turns: [{ ...baseFlow.turns[0], hasError: false,
      actions: [{ kind: 'command', ts: 0, what: { command: 'npm test' }, why: '', text: null, output: { ts: 1, isError: false } }] }]
  };
  const { rec } = record(clean);
  assert.equal(rec.outcome.status, 'completed');
  assert.equal(rec.outcome.healthScore, 100);
  assert.deepEqual(rec.findings, []);
  assert.equal(rec.fta.healthy, true);
});

test('run without completion_result is incomplete', () => {
  const flow = { ...baseFlow, completion: { preview: '', summary: '', sidecar: '', fullLen: 0 } };
  const { rec } = record(flow);
  assert.equal(rec.outcome.status, 'incomplete');
  assert.ok(rec.findings.some(f => f.category === 'no-completion' && f.severity === 'critical'));
});

test('renderAnalysisMarkdown contains verdict, FTA, findings and recommendations', () => {
  const { rec, fta } = record(baseFlow);
  const md = renderAnalysisMarkdown(rec, { ftaMermaid: ftaToMermaid(fta) });
  assert.match(md, /## 1\. Verdict/);
  assert.match(md, /## 2\. Fault Tree \(FTA\)/);
  assert.match(md, /```mermaid/);
  assert.match(md, /Minimal cut sets/);
  assert.match(md, /## 3\. Findings/);
  assert.match(md, /F001/);
  assert.match(md, /## 4\. Recommendations/);
  assert.match(md, /analysis\.json/);
});

test('end-to-end on the real sample: analyze → FTA → record', () => {
  const run = load('cline-log/1782757522666');
  const { flow, expected, conformance } = analyze(run, { thresholdTokens: 200, sink: () => {} });
  const fta = buildFaultTree(flow, conformance);
  const rec = buildAnalysisRecord({ flow, expected, conformance, fta });
  assert.equal(rec.schemaVersion, SCHEMA_VERSION);
  assert.equal(rec.metrics.turns, 29);
  assert.equal(rec.plan.source, 'self-declared');
  assert.ok(rec.findings.length >= 1, 'sample run has at least one finding');
  // every evidence ref is a JSON path or conformance pointer
  for (const f of rec.findings) {
    for (const e of f.evidence) assert.match(e.ref, /^(turns\[|conformance\.)/);
  }
  const md = renderAnalysisMarkdown(rec, { ftaMermaid: ftaToMermaid(fta) });
  assert.match(md, new RegExp(`Task Analysis Report — ${rec.task.id}`));
});
