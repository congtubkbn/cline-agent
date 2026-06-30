import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCompare } from '../src/render-compare.js';

test('compare markdown is a two-column table with markers', () => {
  const c = { source: 'self-declared', total: 2, covered: 1, missing: 1, unexpected: 1, score: 0.5, rows: [
    { expected: { id:'sd0', what:'Do X' }, actual: { text:'Did X', kind:'declared' }, status:'match', score:0.4 },
    { expected: { id:'sd1', what:'Do Y' }, actual: null, status:'missing', score:0.05 },
    { expected: null, actual: { text:'Did Z', kind:'action' }, status:'unexpected', score:0 }
  ] };
  const md = renderCompare(c);
  assert.match(md, /Expected \(initial\)/);
  assert.match(md, /adherence.*0\.5/i);
  assert.match(md, /Do X/);
  assert.match(md, /Did Z/);
  assert.match(md, /✓|✗|＋/);
});

test('compare markdown renders attribution section when present', () => {
  const c = { source: 'self-declared', total: 1, covered: 1, missing: 0, unexpected: 0, score: 1, rows: [
    { expected: { id:'sd0', what:'Scrape case' }, actual: { text:'Scrape case', kind:'declared' }, status:'match', score:0.5 }
  ], attribution: {
    phases: [ { phase: 'Scrape case', actions: [ { text:'node scrape.mjs', kind:'command' } ], count: 1 } ],
    orphans: [ { text:'echo debug', kind:'command' } ], orphanCount: 1, attributed: 1, totalActions: 2
  } };
  const md = renderCompare(c);
  assert.match(md, /Execution attribution/);
  assert.match(md, /node scrape\.mjs/);
  assert.match(md, /Off-plan/);
  assert.match(md, /echo debug/);
});
