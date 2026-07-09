import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../src/loader.js';
import { buildFlow } from '../src/flow.js';
import { renderMarkdown } from '../src/render-md.js';

test('markdown shows prompt, turn headers, intents, completion', () => {
  const run = load('cline-log/1782757522666');
  const flow = buildFlow(run, { thresholdTokens: 200, sink: () => {} });
  const md = renderMarkdown(flow);
  assert.match(md, /qualcomm sync 08381225/);
  assert.match(md, /### 🔄 Turn 0/);
  assert.match(md, /Turn 28/);          // 29 turns => 0..28
  assert.match(md, /\*\*Why:\*\*/);     // intent rendered
  assert.match(md, /## 4. 🏁 Completion Result/);
  
  // Verify API Request Prompt block is rendered
  assert.match(md, /✉️ <b>API Request Prompt<\/b>/);

  // Verify sidecar links are rendered as Markdown relative links rather than code backticks
  assert.match(md, /\[sidecar\/.*_req_request\.txt\]\(sidecar\/.*_req_request\.txt\)/);
});

test('markdown has a jump-to-turn TOC, per-turn anchors, and collapsible bodies', () => {
  const run = load('cline-log/1782757522666');
  const flow = buildFlow(run, { thresholdTokens: 200, sink: () => {} });
  const md = renderMarkdown(flow);

  // TOC anchor + a row linking to turn 0
  assert.match(md, /<a id="toc-turns"><\/a>/);
  assert.match(md, /\[Turn 0\]\(#turn-0\)/);
  // Explicit per-turn anchor so #turn-N deep-links resolve cleanly
  assert.match(md, /<a id="turn-0"><\/a>/);
  // Body collapsed inside <details>, with a back-to-index link
  assert.match(md, /<details( open)?>\n<summary>/);
  assert.match(md, /\[↑ index\]\(#toc-turns\)/);
  // Completion is anchorable from a sidecar back-link
  assert.match(md, /<a id="completion"><\/a>/);
});
