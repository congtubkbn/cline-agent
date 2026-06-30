import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../src/loader.js';
import { analyze } from '../src/analyze.js';

test('analyze attaches conformance to the flow for the real sample', () => {
  const run = load('cline-log/1782757522666');
  const { flow, conformance, compareMd } = analyze(run, { thresholdTokens: 200, sink: () => {} });
  assert.equal(flow.totals.turns, 29);
  assert.equal(conformance.source, 'self-declared');
  assert.equal(conformance.total, 5);             // initial plan had 5 items
  assert.ok(conformance.covered >= 1);
  assert.ok(conformance.rows.length >= 5);
  assert.equal(flow.conformance.total, 5);        // attached to flow
  assert.match(compareMd, /Expected vs Actual/);
});

test('analyze computes plan evolution and action attribution', () => {
  const run = load('cline-log/1782757522666');
  const { conformance } = analyze(run, { thresholdTokens: 200, sink: () => {} });
  // plan evolution: initial 5-item plan vs final plan
  const ev = conformance.planEvolution;
  assert.ok(ev, 'planEvolution present');
  assert.equal(ev.kept.length + ev.dropped.length, 5);   // every initial item is kept or dropped
  assert.ok(ev.added.length >= 1, 'final plan added emergent phases');
  // attribution: executed actions mapped to phases, totals consistent
  const at = conformance.attribution;
  assert.ok(at.totalActions > 0);
  assert.equal(at.attributed + at.orphanCount, at.totalActions);
  assert.ok(at.phases.length >= 1);
});
