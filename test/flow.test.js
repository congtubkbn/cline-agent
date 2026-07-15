import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../src/loader.js';
import { buildFlow } from '../src/flow.js';

test('buildFlow produces totals, turns with intents, completion', () => {
  const run = load('cline-log/1782757522666');
  const sidecars = [];
  const flow = buildFlow(run, { thresholdTokens: 200, sink: (id, full) => sidecars.push(id) });
  assert.equal(flow.totals.turns, 29);
  assert.equal(flow.totals.tokensIn, 330145);
  assert.equal(flow.totals.tokensOut, 12664);
  assert.equal(flow.totals.cacheReads, 949248);
  assert.equal(flow.totals.events, 199);
  assert.equal(flow.prompt, 'qualcomm sync 08381225');
  // every action carries a `why`
  const actions = flow.turns.flatMap(t => t.actions);
  assert.ok(actions.length > 0);
  assert.ok(actions.every(a => typeof a.why === 'string'));
  // completion present
  assert.ok(flow.completion && flow.completion.preview.length > 0);
  // mermaid present
  assert.match(flow.mermaid, /flowchart TD/);
});

// CASE A/B: totals are scoped to a single task and always start from zero.
// Building the same run twice must yield identical totals — proving no shared
// accumulator survives between builds, which is what makes a fresh/new task id
// reset to 0 instead of inheriting the previous task's numbers.
test('buildFlow totals start from zero and do not accumulate across builds', () => {
  const run = load('cline-log/1782757522666');
  const opts = { thresholdTokens: 200, sink: () => {} };
  const a = buildFlow(run, opts);
  const b = buildFlow(run, opts);

  // Known single-task totals — the sum must not double on a second build.
  assert.equal(a.totals.tokensIn, 330145);
  assert.equal(a.totals.tokensOut, 12664);
  assert.equal(a.totals.cacheReads, 949248);

  assert.equal(b.totals.tokensIn, a.totals.tokensIn);
  assert.equal(b.totals.tokensOut, a.totals.tokensOut);
  assert.equal(b.totals.cacheReads, a.totals.cacheReads);
  assert.equal(b.totals.turns, a.totals.turns);
});
