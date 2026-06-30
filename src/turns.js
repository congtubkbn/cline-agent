// A turn = from one api_req_started up to (excluding) the next.
// Pre-LLM events (before the first api_req_started, e.g. the task prompt)
// attach to a synthetic turn index -1 "preamble" only if present; otherwise ignored here.
export function groupTurns(events) {
  const turns = [];
  let cur = null;
  for (const e of events) {
    if (e.subtype === 'api_req_started') {
      cur = {
        index: turns.length,
        tsStart: e.ts, tsEnd: e.ts, durationMs: 0,
        request: { ts: e.ts, data: e.data || {}, text: e.text },
        reasoning: null,
        actions: [],
        taskProgress: null,
        checkpoint: null
      };
      turns.push(cur);
      continue;
    }
    if (!cur) continue; // skip pre-LLM events (task prompt handled separately)
    cur.tsEnd = e.ts;
    cur.durationMs = cur.tsEnd - cur.tsStart;
    switch (e.subtype) {
      case 'reasoning':
        cur.reasoning = { ts: e.ts, text: e.text };
        break;
      case 'tool':
        cur.actions.push({ kind: 'tool', ts: e.ts, what: e.data || {}, text: e.text, why: null, output: null });
        break;
      case 'command':
        cur.actions.push({ kind: 'command', ts: e.ts, what: { command: e.text }, text: e.text, why: null, output: null });
        break;
      case 'command_output': {
        const last = cur.actions[cur.actions.length - 1];
        if (last) last.output = { ts: e.ts, text: e.text };
        break;
      }
      case 'task_progress':
        cur.taskProgress = { ts: e.ts, text: e.text, items: parseChecklist(e.text) };
        break;
      case 'checkpoint_created':
        cur.checkpoint = { ts: e.ts, hash: e.lastCheckpointHash, checkedOut: e.isCheckpointCheckedOut };
        break;
      // completion_result handled by caller; raw events ignored in turn body
    }
  }
  return turns;
}

export function parseChecklist(text) {
  if (!text) return [];
  return text.split('\n')
    .map(l => l.match(/^- \[( |x|X)\]\s+(.*)$/))
    .filter(Boolean)
    .map(m => ({ done: m[1].toLowerCase() === 'x', text: m[2].trim() }));
}
