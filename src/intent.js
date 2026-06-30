// Heuristic: the "why" for an action = the reasoning sentence most relevant to it.
// Match on action keywords (tool name, skill path, command head); fall back to last sentence.
function sentences(text) {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function keywords(action) {
  const ks = [action.kind];
  if (action.what?.tool) ks.push(action.what.tool);
  if (action.what?.path) ks.push(action.what.path);
  if (action.what?.command) {
    ks.push('command', 'run');
    const head = String(action.what.command).trim().split(/\s+/)[0];
    if (head) ks.push(head.replace(/['"]/g, ''));
  }
  return ks.map(k => k.toLowerCase()).filter(k => k.length > 2);
}

export function extractIntent(reasoning, action) {
  if (!reasoning) return '';
  const sents = sentences(reasoning);
  if (!sents.length) return '';
  const ks = keywords(action);
  let best = null, bestScore = 0;
  for (const s of sents) {
    const low = s.toLowerCase();
    const score = ks.reduce((n, k) => n + (low.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best || sents[sents.length - 1];
}
