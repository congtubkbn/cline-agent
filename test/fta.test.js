import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFaultTree, minimalCutSets, collectBasics, ftaToMermaid } from '../src/fta.js';

function makeTurn(index, actions, extra = {}) {
  return {
    index, tsStart: index * 1000, tsEnd: index * 1000 + 500, durationMs: 500,
    hasError: actions.some(a => a.output && a.output.isError),
    request: { tokensIn: 10, tokensOut: 5, cost: 0.01, cacheReads: 0, cacheWrites: 0 },
    reasoning: null, actions, taskProgress: null, checkpoint: null,
    ...extra
  };
}

function cmd(command, isError = false) {
  return { kind: 'command', ts: 0, what: { command }, why: '', text: null, output: { ts: 1, isError } };
}

const faultyFlow = {
  taskId: 't1', prompt: 'do things', model: null,
  turns: [
    makeTurn(0, [cmd('npm install')]),
    makeTurn(1, [cmd('npm test', true)]),
    makeTurn(2, [cmd('npm test', true)]),
    makeTurn(3, [cmd('git status')], {
      taskProgress: { items: [{ done: true, text: 'setup' }, { done: false, text: 'ship it' }] }
    })
  ],
  totals: { turns: 4, events: 10, tokensIn: 40, tokensOut: 20, cost: 0.04, cacheReads: 0, cacheWrites: 0, durationMs: 4000 },
  completion: { preview: '', summary: '', sidecar: '', fullLen: 0 }
};

const healthyFlow = {
  taskId: 't2', prompt: 'do things', model: null,
  turns: [makeTurn(0, [cmd('npm test')])],
  totals: { turns: 1, events: 3, tokensIn: 10, tokensOut: 5, cost: 0.01, cacheReads: 0, cacheWrites: 0, durationMs: 500 },
  completion: { preview: 'done', summary: '', sidecar: '', fullLen: 4 }
};

test('buildFaultTree detects errors, retry loops, checklist and completion faults', () => {
  const fta = buildFaultTree(faultyFlow, null);
  assert.equal(fta.healthy, false);
  const cats = fta.basicEvents.map(b => b.category);
  assert.ok(cats.includes('action-error'), 'failing command detected');
  assert.ok(cats.includes('retry-loop'), 'npm test repeated with errors = retry loop');
  assert.ok(cats.includes('no-completion'), 'no completion_result');
  assert.ok(cats.includes('unfinished-checklist'), 'open checklist item');
  // evidence points into flow_data.json
  const err = fta.basicEvents.find(b => b.category === 'action-error');
  assert.match(err.evidence[0].ref, /^turns\[\d+\]\.actions\[\d+\]$/);
  // top gate is OR over intermediate branches
  assert.equal(fta.top.gate, 'OR');
  assert.ok(fta.top.children.every(g => g.type === 'intermediate'));
});

test('buildFaultTree reports a healthy run as empty tree', () => {
  const fta = buildFaultTree(healthyFlow, null);
  assert.equal(fta.healthy, true);
  assert.equal(fta.basicEvents.length, 0);
  assert.deepEqual(fta.cutSets, []);
  assert.match(ftaToMermaid(fta), /healthy run/);
});

test('plan deviation basic events come from conformance', () => {
  const conformance = {
    source: 'skill-contract', total: 2, score: 0.5,
    rows: [
      { status: 'match', expected: { id: 's0', what: 'step A' }, actual: { text: 'step A' } },
      { status: 'missing', expected: { id: 's1', what: 'step B', skill: 'my-skill' }, actual: null }
    ],
    attribution: { orphans: [{ text: 'stray action', kind: 'command' }], totalActions: 4, attributed: 3, orphanCount: 1 }
  };
  const fta = buildFaultTree(healthyFlow, conformance);
  const drop = fta.basicEvents.find(b => b.category === 'plan-step-dropped');
  assert.ok(drop, 'dropped skill step detected');
  assert.equal(drop.severity, 'major'); // skill-contract source escalates severity
  assert.equal(drop.evidence[0].skill, 'my-skill');
  assert.ok(fta.basicEvents.some(b => b.category === 'off-plan-action'));
});

test('minimalCutSets: OR unions, AND crosses, supersets pruned', () => {
  const tree = {
    id: 'TOP', type: 'top', gate: 'AND', children: [
      { id: 'A', type: 'basic', children: [] },
      {
        id: 'G', type: 'intermediate', gate: 'OR', children: [
          { id: 'B', type: 'basic', children: [] },
          { id: 'C', type: 'basic', children: [] }
        ]
      }
    ]
  };
  const sets = minimalCutSets(tree);
  assert.deepEqual(sets.map(s => s.sort()).sort(), [['A', 'B'], ['A', 'C']]);
  // for the OR-only faulty tree, each basic event is its own cut set
  const fta = buildFaultTree(faultyFlow, null);
  assert.equal(fta.cutSets.length, fta.basicEvents.length);
  assert.ok(fta.cutSets.every(cs => cs.length === 1));
});

test('ftaToMermaid renders gates, severity classes and edges', () => {
  const fta = buildFaultTree(faultyFlow, null);
  const mmd = ftaToMermaid(fta);
  assert.match(mmd, /^flowchart TD/);
  assert.match(mmd, /TOP_GATE\{\{"OR"\}\}/);
  assert.match(mmd, /classDef sev_critical/);
  assert.match(mmd, /class BE-NO-COMPLETION sev_critical;/);
  // every basic event appears as a node
  for (const be of collectBasics(fta.top)) assert.ok(mmd.includes(be.id));
});
