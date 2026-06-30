import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExpected, fromSelfDeclared, fromSkillContract } from '../src/expectation.js';

test('self-declared uses the first non-empty progress snapshot', () => {
  const snaps = [
    { items: [] },
    { items: [{ text: 'Plan A', done: false }, { text: 'Plan B', done: false }] },
    { items: [{ text: 'changed', done: true }] }
  ];
  const exp = fromSelfDeclared(snaps);
  assert.equal(exp.source, 'self-declared');
  assert.equal(exp.steps.length, 2);
  assert.equal(exp.steps[0].what, 'Plan A');
});

test('skill-contract parses numbered steps when SKILL.md resolves', () => {
  const exp = fromSkillContract(['qualcomm-x'], ['test/fixtures/skill']);
  assert.equal(exp.steps.length, 3);
  assert.match(exp.steps[0].what, /Validate the case code/);
});

test('skill-contract returns no steps when skill absent', () => {
  const exp = fromSkillContract(['does-not-exist'], ['test/fixtures/skill']);
  assert.equal(exp.steps.length, 0);
});

test('buildExpected prefers skill-contract, falls back to self-declared', () => {
  const snaps = [{ items: [{ text: 'fallback step', done: false }] }];
  const withSkill = buildExpected({ progressSnapshots: snaps, skillNames: ['qualcomm-x'], skillRoots: ['test/fixtures/skill'] });
  assert.equal(withSkill.source, 'skill-contract');
  const noSkill = buildExpected({ progressSnapshots: snaps, skillNames: ['none'], skillRoots: ['test/fixtures/skill'] });
  assert.equal(noSkill.source, 'self-declared');
});
