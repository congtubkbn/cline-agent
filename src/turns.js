// A turn = from one api_req_started (or task initialization) up to (excluding) the next.
// Pre-LLM events (after the 'task' prompt but before the first 'api_req_started')
// are captured in Turn 0.
export function groupTurns(events) {
  const turns = [];
  let cur = null;
  let startedWithTask = false;
  let hasEnrichedTurn0 = false;
  let lastEventTs = 0;

  for (const e of events) {
    if (e.subtype === 'task' && turns.length === 0) {
      cur = {
        index: turns.length,
        isUserInitiated: true,
        tsStart: e.ts, tsEnd: e.ts, durationMs: 0, idleMs: 0,
        request: { ts: e.ts, data: {}, text: e.text },
        reasoning: null,
        texts: [],
        actions: [],
        errors: [],
        taskProgress: null,
        checkpoint: null
      };
      turns.push(cur);
      startedWithTask = true;
      lastEventTs = e.ts;
      continue;
    }

    if (e.subtype === 'api_req_started') {
      if (startedWithTask && !hasEnrichedTurn0) {
        // Enrich Turn 0 with the actual API request details
        cur.tsStart = Math.min(cur.tsStart, e.ts);
        cur.request = { ts: e.ts, data: e.data || {}, text: e.text };
        hasEnrichedTurn0 = true;
      } else {
        cur = {
          index: turns.length,
          isUserInitiated: false,
          tsStart: e.ts, tsEnd: e.ts, durationMs: 0, idleMs: 0,
          request: { ts: e.ts, data: e.data || {}, text: e.text },
          reasoning: null,
          texts: [],
          actions: [],
          errors: [],
          taskProgress: null,
          checkpoint: null
        };
        turns.push(cur);
      }
      lastEventTs = e.ts;
      continue;
    }

    if (!cur) continue; // skip pre-LLM events if 'task' wasn't present
    if (e.subtype === 'user_feedback' || e.subtype === 'resume_task' || e.subtype === 'resume_completed_task') {
      cur.idleMs += Math.max(0, e.ts - lastEventTs);
      cur.isUserInitiated = true;
    } else {
      cur.tsEnd = e.ts;
      cur.durationMs = Math.max(0, (cur.tsEnd - cur.tsStart) - cur.idleMs);
    }
    lastEventTs = e.ts;
    switch (e.subtype) {
      case 'reasoning':
        cur.reasoning = cur.reasoning
          ? { ts: e.ts, text: cur.reasoning.text + '\n\n' + e.text }
          : { ts: e.ts, text: e.text };
        break;
      case 'text': {
        const toolCall = parseXmlToolCall(e.text);
        if (toolCall) {
          if (toolCall.tool === 'execute_command') {
            cur.actions.push({
              kind: 'command',
              ts: e.ts,
              what: { command: toolCall.params.command },
              text: e.text,
              why: null,
              output: null
            });
          } else {
            cur.actions.push({
              kind: 'tool',
              ts: e.ts,
              what: { tool: toolCall.tool, ...toolCall.params },
              text: e.text,
              why: null,
              output: null
            });
          }
        } else {
          cur.texts.push({ ts: e.ts, text: e.text });
        }
        break;
      }
      case 'tool':
        cur.actions.push({ kind: 'tool', ts: e.ts, what: e.data || {}, text: e.text, why: null, output: null });
        break;
      case 'command':
        cur.actions.push({ kind: 'command', ts: e.ts, what: { command: e.text }, text: e.text, why: null, output: null });
        break;
      case 'command_output': {
        const last = cur.actions[cur.actions.length - 1];
        if (!last) break;
        const chunk = e.text || '';
        if (!last.output) {
          last.output = { ts: e.ts, text: chunk };
        } else {
          // Streamed output arrives as multiple events. A re-sent event
          // carries the accumulated text so far as its prefix; otherwise
          // it is a fresh continuation chunk.
          last.output.ts = e.ts;
          last.output.text = chunk.startsWith(last.output.text)
            ? chunk
            : last.output.text + chunk;
        }
        break;
      }
      case 'error':
        cur.errors.push({ ts: e.ts, text: e.text });
        break;
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
  return text.split(/\r?\n/)
    .map(l => l.match(/^- \[( |x|X)\]\s+(.*)$/))
    .filter(Boolean)
    .map(m => ({ done: m[1].toLowerCase() === 'x', text: m[2].trim() }));
}

export function parseXmlToolCall(text) {
  if (!text || !text.includes('<tool_call>')) return null;
  const funcMatch = text.match(/<function=(\w+)>/);
  if (!funcMatch) return null;
  const tool = funcMatch[1];
  
  const params = {};
  const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
  let match;
  while ((match = paramRegex.exec(text)) !== null) {
    params[match[1]] = match[2].trim();
  }
  
  return { tool, params };
}
