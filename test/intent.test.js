import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIntent } from '../src/intent.js';

test('intent picks the reasoning sentence mentioning the action', () => {
  const reasoning = 'First I check the file. I will run a command to do the thing. Then finish.';
  const action = { kind: 'command', what: { command: 'echo hi' } };
  const why = extractIntent(reasoning, action);
  assert.match(why, /run a command/);
});

test('intent falls back to last reasoning sentence when no keyword match', () => {
  const reasoning = 'Some context. The plan is to enrich the data.';
  const action = { kind: 'tool', what: { tool: 'useSkill', path: 'x' } };
  const why = extractIntent(reasoning, action);
  assert.equal(why, 'The plan is to enrich the data.');
});

test('intent is empty string when no reasoning', () => {
  assert.equal(extractIntent(null, { kind: 'command', what: {} }), '');
});
