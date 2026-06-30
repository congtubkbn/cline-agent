function esc(s) { return String(s).replace(/"/g, "'").replace(/[\n\r]/g, ' ').slice(0, 40); }

function turnLabel(t) {
  const acts = (t.actions || []).map(a =>
    a.kind === 'tool' ? (a.what.tool || 'tool') : (String(a.what.command || 'cmd').trim().split(/\s+/)[0] || 'cmd')
  );
  const head = acts.length ? acts.join(', ') : 'no-action';
  return `Turn ${t.index}: ${esc(head)}`;
}

export function toMermaid(turns) {
  const lines = ['flowchart TD'];
  lines.push('  START([task prompt])');
  for (const t of turns) lines.push(`  T${t.index}["${turnLabel(t)}"]`);
  if (turns.length) lines.push(`  START --> T${turns[0].index}`);
  for (let i = 0; i < turns.length - 1; i++) lines.push(`  T${turns[i].index} --> T${turns[i + 1].index}`);
  if (turns.length) lines.push(`  T${turns[turns.length - 1].index} --> DONE([completion])`);
  return lines.join('\n');
}
