import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMermaid } from '../src/diagram.js';

test('mermaid graph has a node per turn and edges between them', () => {
  const turns = [
    { index: 0, actions: [{ kind: 'tool', what: { tool: 'useSkill' } }] },
    { index: 1, actions: [{ kind: 'command', what: { command: 'echo hi' } }] }
  ];
  const mmd = toMermaid(turns);
  assert.match(mmd, /^flowchart TD/m);
  assert.match(mmd, /T0/);
  assert.match(mmd, /T1/);
  assert.match(mmd, /T0 --> T1/);
});
