import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSidecarId, sidecarHeader, withSidecarHeader } from '../src/sidecar.js';

test('parseSidecarId pulls turn + kind from a turn sidecar', () => {
  assert.deepEqual(parseSidecarId('3_req_request.txt'), { turn: 3, kind: 'request' });
  assert.deepEqual(parseSidecarId('12_0_out_output.txt'), { turn: 12, kind: 'output' });
});

test('parseSidecarId handles the completion sidecar (no turn)', () => {
  assert.deepEqual(parseSidecarId('completion_completion.txt'), { turn: null, kind: 'completion' });
});

test('sidecarHeader names the turn and back-links to the report anchor', () => {
  const h = sidecarHeader('3_req_request.txt', 'TASK9');
  assert.match(h, /Task TASK9/);
  assert.match(h, /Turn 3/);
  assert.match(h, /request/);
  assert.match(h, /TASK9_flow_report\.md#turn-3/);
});

test('completion sidecar links back to the completion anchor', () => {
  const h = sidecarHeader('completion_completion.txt', 'T');
  assert.match(h, /#completion/);
});

test('withSidecarHeader keeps the original text below the banner', () => {
  const body = 'line one\nline two';
  const out = withSidecarHeader('3_req_request.txt', 'T', body);
  assert.ok(out.endsWith(body));
  assert.match(out, /#turn-3/);
});
