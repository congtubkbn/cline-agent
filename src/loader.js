import fs from 'node:fs';
import path from 'node:path';

const KNOWN_SAY = new Set([
  'task','api_req_started','reasoning','tool','task_progress',
  'command','checkpoint_created','completion_result','error'
]);
const KNOWN_ASK = new Set(['command_output','completion_result','tool']);

// subtypes whose text field is JSON-encoded
const JSON_TEXT = new Set(['api_req_started','tool']);

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }

export function load(taskDir) {
  const uiPath = path.join(taskDir, 'ui_messages.json');
  const ui = readJson(uiPath);
  const apiPath = path.join(taskDir, 'api_conversation_history.json');
  const api = fs.existsSync(apiPath) ? readJson(apiPath) : [];
  const metaPath = path.join(taskDir, 'task_metadata.json');
  const meta = fs.existsSync(metaPath) ? readJson(metaPath) : { files_in_context: [] };

  const events = ui.map((m, i) => {
    const subtype = m.type === 'say' ? m.say : m.ask;
    const known = m.type === 'say' ? KNOWN_SAY.has(subtype) : KNOWN_ASK.has(subtype);
    let data = null;
    if (JSON_TEXT.has(subtype) && typeof m.text === 'string' && m.text.length) {
      try { data = JSON.parse(m.text); } catch { data = null; }
    }
    const idx = m.conversationHistoryIndex;
    const apiMessage = (idx != null && idx >= 0 && idx < api.length) ? api[idx] : null;
    return {
      id: i, ts: m.ts, type: m.type, subtype, raw: !known,
      text: typeof m.text === 'string' ? m.text : '',
      data, apiMessage,
      modelInfo: m.modelInfo || null,
      conversationHistoryIndex: idx,
      lastCheckpointHash: m.lastCheckpointHash || null,
      isCheckpointCheckedOut: m.isCheckpointCheckedOut || false
    };
  });

  const taskId = path.basename(taskDir);
  const first = events.find(e => e.subtype === 'task');
  return {
    taskId,
    prompt: first ? first.text : '',
    model: first?.modelInfo || events[0]?.modelInfo || null,
    events, api, meta
  };
}
