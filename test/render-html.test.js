import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../src/loader.js';
import { buildFlow } from '../src/flow.js';
import { renderHtml } from '../src/render-html.js';

function buildWithSidecars() {
  const run = load('cline-log/1782757522666');
  const sidecars = {};
  const flow = buildFlow(run, {
    thresholdTokens: 200,
    sink: (id, text) => { sidecars[`sidecar/${id}`] = text; }
  });
  return { flow, sidecars };
}

test('html is self-contained: no external scripts or stylesheets', () => {
  const { flow, sidecars } = buildWithSidecars();
  const html = renderHtml(flow, { sidecars });
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/);
  assert.doesNotMatch(html, /<link[^>]*stylesheet/);
});

test('html has sticky nav, per-turn anchors, error filter, and modal', () => {
  const { flow, sidecars } = buildWithSidecars();
  const html = renderHtml(flow, { sidecars });
  assert.match(html, /id="turn-0"/);
  assert.match(html, /href="#turn-0"/);
  assert.match(html, /id="f-err"/);          // errors-only filter
  assert.match(html, /id="modal"/);          // in-page full-text viewer
  assert.match(html, /window\.__SIDECARS__=/); // sidecars embedded inline
});

test('embedded sidecar JSON neutralizes </script> breakouts', () => {
  const flow = {
    taskId: 'T', prompt: 'p', model: null, mermaid: 'flowchart TD',
    totals: { turns: 0, events: 0, tokensIn: 0, tokensOut: 0, cost: 0, cacheReads: 0, cacheWrites: 0, durationMs: 0 },
    turns: [], completion: { preview: '', summary: '', sidecar: '', fullLen: 0 }
  };
  const html = renderHtml(flow, { sidecars: { 'sidecar/x.txt': 'danger </script> here' } });
  // The literal closing tag must not survive inside the data script block
  assert.doesNotMatch(html, /danger <\/script> here/);
  assert.match(html, /\\u003c\/script>/);
});

test('escapes HTML in user text to prevent markup injection', () => {
  const flow = {
    taskId: 'T', prompt: '<img src=x onerror=alert(1)>', model: null, mermaid: '',
    totals: { turns: 0, events: 0, tokensIn: 0, tokensOut: 0, cost: 0, cacheReads: 0, cacheWrites: 0, durationMs: 0 },
    turns: [], completion: { preview: '', summary: '', sidecar: '', fullLen: 0 }
  };
  const html = renderHtml(flow, {});
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /<img src=x onerror/);
});
