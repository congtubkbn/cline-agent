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
