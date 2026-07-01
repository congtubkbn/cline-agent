function pathBasename(p) {
  if (!p) return '';
  p = String(p).replace(/\\/g, '/');
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
}

function getActionParam(a) {
  if (!a.what) return '';
  if (a.kind === 'command') {
    const cmd = String(a.what.command || '').trim();
    const words = cmd.split(/\s+/);
    if (words.length > 1) {
      return words.slice(0, 2).join(' ');
    }
    return words[0] || '';
  }
  const preferredKeys = ['path', 'TargetFile', 'DirectoryPath', 'AbsolutePath', 'SearchPath', 'Query', 'CommandLine', 'Url', 'TargetFolder'];
  for (const k of preferredKeys) {
    if (a.what[k]) {
      return pathBasename(a.what[k]);
    }
  }
  for (const k of Object.keys(a.what)) {
    if (k !== 'tool' && typeof a.what[k] === 'string' && a.what[k].length > 0) {
      return pathBasename(a.what[k]);
    }
  }
  return '';
}

function turnLabel(t) {
  const acts = (t.actions || []).map(a => {
    const name = a.kind === 'tool' ? (a.what.tool || 'tool') : 'cmd';
    const param = getActionParam(a);
    const shortParam = param && param.length > 25 ? param.slice(0, 22) + '...' : param;
    return shortParam ? `${name}(${shortParam})` : name;
  });
  
  const head = acts.length ? acts.join(', ') : 'no-action';
  
  let summary = '';
  if (t.actions && t.actions[0] && t.actions[0].why) {
    summary = t.actions[0].why;
  } else if (t.reasoning) {
    summary = typeof t.reasoning === 'string' ? t.reasoning : (t.reasoning.preview || '');
  }
  
  if (summary) {
    summary = String(summary)
      .replace(/"/g, "'")
      .replace(/[\n\r]/g, ' ')
      .trim();
    if (summary.length > 50) {
      summary = summary.slice(0, 47) + '...';
    }
  }

  const turnText = t.hasError ? `❌ Turn ${t.index}` : `Turn ${t.index}`;
  const escHead = String(head).replace(/"/g, "'").replace(/[\n\r]/g, ' ');
  
  if (summary) {
    return `${turnText}: ${escHead}\\n(${summary})`;
  } else {
    return `${turnText}: ${escHead}`;
  }
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
