import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const TASK_ID = '1782757522666';

function runParser() {
  execFileSync('node', ['parser.js', TASK_ID], { cwd: repoRoot, stdio: 'pipe' });
}

function readTasksCatalog() {
  const p = path.join(repoRoot, 'web', 'tasks.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function readTaskTotals() {
  const p = path.join(repoRoot, 'web', 'tasks', TASK_ID, 'flow_data.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')).totals;
}

// CASE C: re-running the parser for the SAME task id must recompute from the
// current log (overwrite, not append) and must not create a duplicate catalog
// entry — so tokens are "continued" from the latest log, never double-counted.
test('re-parsing the same task id dedupes the catalog and does not double-count tokens', () => {
  runParser();
  const catalog1 = readTasksCatalog();
  const totals1 = readTaskTotals();

  const entries1 = catalog1.filter(t => t.taskId === TASK_ID);
  assert.equal(entries1.length, 1, 'exactly one catalog entry after first parse');

  runParser();
  const catalog2 = readTasksCatalog();
  const totals2 = readTaskTotals();

  const entries2 = catalog2.filter(t => t.taskId === TASK_ID);
  assert.equal(entries2.length, 1, 'still exactly one catalog entry after re-parse (dedupe by taskId)');

  // Same log parsed twice -> identical totals. No accumulation across runs.
  assert.equal(totals2.tokensIn, totals1.tokensIn);
  assert.equal(totals2.tokensOut, totals1.tokensOut);
  assert.equal(totals2.cacheReads, totals1.cacheReads);
  assert.equal(totals2.turns, totals1.turns);
  assert.equal(catalog2.filter(t => t.taskId === TASK_ID)[0].totals.turns, totals1.turns);
});
