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
});

test('captures say:text messages on the turn', () => {
  const run = load('test/fixtures/mini');
  const t = groupTurns(run.events)[0];
  assert.equal(t.texts.length, 1, 'partial text is filtered, final kept');
  assert.equal(t.texts[0].text, 'Running the command now.');
});

test('merges streamed command_output chunks', () => {
  const run = load('test/fixtures/mini');
  const t = groupTurns(run.events)[0];
  // "hi\n" then cumulative resend "hi\nbye\n" (prefix → replace),
  // then continuation "end\n" (append)
  assert.equal(t.actions[0].output.text, 'hi\nbye\nend\n');
  assert.equal(t.actions[0].output.ts, 1440);
});

test('real sample has 29 turns', () => {
  const run = load('cline-log/1782757522666');
  const turns = groupTurns(run.events);
  assert.equal(turns.length, 29);
});
