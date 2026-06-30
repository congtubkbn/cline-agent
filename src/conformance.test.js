import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conform, jaccard } from '../src/conformance.js';

test('jaccard token overlap', () => {
  assert.equal(jaccard('scrape the case', 'scrape case now') > 0, true);
  assert.equal(jaccard('abc', 'xyz'), 0);
});

test('conform matches, flags missing and unexpected', () => {
  const expected = { source: 'self-declared', steps: [
    { id: 'sd0', what: 'Scrape case from portal' },
    { id: 'sd1', what: 'Enrich with expert analysis' },
    { id: 'sd2', what: 'Send carrier pigeon to Mars' }
  ] };
  const actual = { candidates: [
    { text: 'Scrape the case from the portal page', kind: 'declared' },
    { text: 'Enrich case with expert RF analysis', kind: 'declared' },
    { text: 'Persist artifacts to disk', kind: 'action' }
  ] };
  const c = conform(expected, actual, { threshold: 0.15 });
  assert.equal(c.total, 3);
  assert.equal(c.covered, 2);
  assert.equal(c.missing, 1);        // "carrier pigeon" matches nothing
  assert.equal(c.unexpected, 1);     // "Persist artifacts" not in expected
  assert.equal(c.score, 0.67);
  const pigeon = c.rows.find(r => r.expected && r.expected.id === 'sd2');
  assert.equal(pigeon.status, 'missing');
});
