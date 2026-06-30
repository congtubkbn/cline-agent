import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTextPolicy } from '../src/text-policy.js';

test('short text: preview equals full, no sidecar needed', () => {
  const sink = [];
  const policy = makeTextPolicy({ thresholdTokens: 200, sink: (id, full) => sink.push([id, full]) });
  const block = policy('reasoning', 0, 'short text');
  assert.equal(block.preview, 'short text');
  assert.equal(block.fullLen, 10);
  assert.equal(block.sidecar, '');
  assert.equal(sink.length, 0);
});

test('long text: preview truncated, summary set, sidecar written', () => {
  const sink = [];
  const policy = makeTextPolicy({ thresholdTokens: 5, sink: (id, full) => sink.push([id, full]) });
  const long = 'word '.repeat(50).trim(); // ~250 chars, >5 tokens
  const block = policy('reasoning', 3, long);
  assert.ok(block.preview.length < long.length);
  assert.ok(block.preview.endsWith('…'));
  assert.ok(block.sidecar.includes('3'));
  assert.equal(block.summary.length > 0, true);
  assert.equal(sink[0][1], long); // full text handed to sink
});
