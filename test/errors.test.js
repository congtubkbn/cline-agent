import test from 'node:test';
import assert from 'node:assert/strict';
import { detectError, analyzeError, ERROR_CATEGORY, ERROR_SEVERITY } from '../src/errors.js';

test('detectError returns boolean for backward compatibility', () => {
  assert.equal(detectError('SyntaxError: Unexpected token'), true);
  assert.equal(detectError('Command executed successfully with 0 errors'), false);
  assert.equal(detectError(''), false);
});

test('analyzeError detects critical syntax errors', () => {
  const res = analyzeError('Uncaught SyntaxError: Unexpected token { at app.js:15');
  assert.equal(res.hasError, true);
  assert.equal(res.severity, ERROR_SEVERITY.CRITICAL);
  assert.equal(res.category, ERROR_CATEGORY.SYNTAX_ERROR);
  assert.equal(res.code, 'syntax-error');
});

test('analyzeError detects missing dependencies', () => {
  const res = analyzeError('bash: express: command not found');
  assert.equal(res.hasError, true);
  assert.equal(res.severity, ERROR_SEVERITY.MAJOR);
  assert.equal(res.category, ERROR_CATEGORY.DEPENDENCY_MISSING);
  assert.equal(res.code, 'command-not-found');
});

test('analyzeError filters out false positives like "no merge conflicts"', () => {
  const res = analyzeError('git merge main\nAlready up to date.\nNo merge conflicts found.');
  assert.equal(res.hasError, false);
  assert.equal(res.isFalsePositive, true);
});

test('analyzeError detects permission errors', () => {
  const res = analyzeError('Error: EACCES: permission denied, open "/etc/hosts"');
  assert.equal(res.hasError, true);
  assert.equal(res.severity, ERROR_SEVERITY.CRITICAL);
  assert.equal(res.category, ERROR_CATEGORY.SYSTEM_PERMISSION);
});
