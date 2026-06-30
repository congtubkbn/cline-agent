import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../src/loader.js';
import { groupTurns } from '../src/turns.js';

test('groups events into turns starting at each api_req_started', () => {
  const run = load('test/fixtures/mini');
  const turns = groupTurns(run.events);
  assert.equal(turns.length, 1);
  const t = turns[0];
  assert.equal(t.index, 0);
  assert.ok(t.request, 'turn has request');
  assert.ok(t.reasoning, 'turn has reasoning');
  assert.equal(t.actions.length, 1);
  assert.equal(t.actions[0].kind, 'command');
  assert.equal(t.actions[0].output.text, 'hi\n');
});

test('real sample has 29 turns', () => {
  const run = load('cline-log/1782757522666');
  const turns = groupTurns(run.events);
  assert.equal(turns.length, 29);
});
