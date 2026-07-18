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

test('handles freshly started task with only task event', () => {
  const events = [
    { subtype: 'task', text: 'new task prompt', ts: 1000 }
  ];
  const turns = groupTurns(events);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].index, 0);
  assert.equal(turns[0].request.text, 'new task prompt');
  assert.equal(turns[0].tsStart, 1000);
});

test('captures pre-LLM checkpoint_created in Turn 0', () => {
  const events = [
    { subtype: 'task', text: 'new task prompt', ts: 1000 },
    { subtype: 'checkpoint_created', lastCheckpointHash: 'init_hash', isCheckpointCheckedOut: false, ts: 1100 },
    { subtype: 'api_req_started', text: '{"request":"Full prompt details"}', data: { request: 'Full prompt details' }, ts: 1200 }
  ];
  const turns = groupTurns(events);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].tsStart, 1000);
  assert.ok(turns[0].checkpoint);
  assert.equal(turns[0].checkpoint.hash, 'init_hash');
  assert.equal(turns[0].request.text, '{"request":"Full prompt details"}');
});

test('ignores user response and resumption events when updating turn duration', () => {
  const events = [
    { subtype: 'task', text: 'new task prompt', ts: 1000 },
    { subtype: 'api_req_started', text: 'api request', ts: 1200 },
    { subtype: 'reasoning', text: 'thinking...', ts: 1300 },
    { subtype: 'user_feedback', text: 'user typing...', ts: 5000 },
    { subtype: 'resume_completed_task', text: '', ts: 6000 }
  ];
  const turns = groupTurns(events);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].tsStart, 1000);
  // tsEnd should freeze at 1300 (reasoning event), not 5000 or 6000
  assert.equal(turns[0].tsEnd, 1300);
  assert.equal(turns[0].durationMs, 300); // 1300 - 1000 (starting at the task event ts)
});


