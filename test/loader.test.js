import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../src/loader.js';

test('load decodes, joins, and tags subtypes', () => {
  const run = load('test/fixtures/mini');
  assert.equal(run.taskId, 'mini');
  assert.equal(run.events.length, 9, 'partial entries are dropped');
  assert.ok(run.events.every(e => ['task','api_req_started','reasoning','text','command','command_output','completion_result'].includes(e.subtype)));
  // first event is the task prompt
  assert.equal(run.events[0].subtype, 'task');
  assert.equal(run.events[0].text, 'do the thing');
  // api_req_started text is decoded into fields
  const req = run.events[1];
  assert.equal(req.subtype, 'api_req_started');
  assert.equal(req.data.tokensIn, 10);
  // conversationHistoryIndex join: event[2] links to assistant msg
  assert.equal(run.events[2].apiMessage.role, 'assistant');
});

test('load tags unknown subtype as raw without crashing', () => {
  const run = load('test/fixtures/unknown');
  const ev = run.events.find(e => e.subtype === 'mystery');
  assert.ok(ev, 'unknown subtype preserved');
  assert.equal(ev.raw, true);
});
