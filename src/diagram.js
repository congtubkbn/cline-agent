import { buildMacroTurnsAndPhases } from './phases.js';

function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/["'\[\]\(\)\{\}\<\>\\:\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    const cleanParam = sanitize(param);
    const shortParam = cleanParam && cleanParam.length > 20 ? cleanParam.slice(0, 18) + '..' : cleanParam;
    return shortParam ? `${name} ${shortParam}` : name;
  });
  
  const head = acts.length ? acts.join(', ') : 'no-action';
  
  let summary = '';
  if (t.actions && t.actions[0] && t.actions[0].why) {
    summary = t.actions[0].why;
  } else if (t.reasoning) {
    summary = typeof t.reasoning === 'string' ? t.reasoning : (t.reasoning.preview || '');
  }
  
  const cleanSummary = sanitize(summary);
  const shortSummary = cleanSummary.length > 35 ? cleanSummary.slice(0, 32) + '...' : cleanSummary;

  const req = t.request || {};
  const durSec = Math.round((t.durationMs || 0) / 1000);
  const toks = `${req.tokensIn || 0} in`;

  const statusPrefix = t.hasError ? '❌ ' : '';
  const title = `${statusPrefix}Turn ${t.index}: ${head}`;

  if (shortSummary) {
    return `${title} - ${shortSummary} (${durSec}s, ${toks})`;
  } else {
    return `${title} (${durSec}s, ${toks})`;
  }
}

const PHASE_ICONS = {
  'Initialization & Skill Activation': 'Init and Skills',
  'Exploration & Context Gathering': 'Exploration and Context',
  'Implementation & Modification': 'Implementation',
  'Browser & Terminal Execution': 'Execution and Command',
  'Artifact Generation & Render': 'Artifact and Render',
  'Task Completion & Wrap-up': 'Task Completion',
  'General Execution': 'Execution Phase'
};

export function toMermaid(turns, options = {}) {
  const orientation = (options.orientation || 'TD').toUpperCase();
  const lines = [`flowchart ${orientation}`];

  lines.push('  START([task prompt])');

  if (!turns || !turns.length) {
    lines.push('  START --> DONE([completion])');
    return lines.join('\n');
  }

  // Build semantic phases
  const { phases } = buildMacroTurnsAndPhases(turns);

  if (phases && phases.length > 0) {
    for (let pIdx = 0; pIdx < phases.length; pIdx++) {
      const p = phases[pIdx];
      const nameClean = sanitize(PHASE_ICONS[p.name] || p.name || 'Phase');
      const durSec = Math.round((p.durationMs || 0) / 1000);
      lines.push(`  subgraph Phase_${pIdx} ["${nameClean} - ${p.turnCount} turns, ${durSec}s"]`);
      
      const startTurn = p.turnRange[0];
      const endTurn = p.turnRange[1];
      for (let i = startTurn; i <= endTurn; i++) {
        const t = turns.find(x => x.index === i);
        if (t) {
          lines.push(`    T${t.index}["${turnLabel(t)}"]`);
        }
      }
      lines.push('  end');
    }
  } else {
    for (const t of turns) {
      lines.push(`  T${t.index}["${turnLabel(t)}"]`);
    }
  }

  // Connections between nodes
  lines.push(`  START --> T${turns[0].index}`);
  for (let i = 0; i < turns.length - 1; i++) {
    const tCurrent = turns[i];
    const tNext = turns[i + 1];
    lines.push(`  T${tCurrent.index} --> T${tNext.index}`);
  }
  lines.push(`  T${turns[turns.length - 1].index} --> DONE([completion])`);

  return lines.join('\n');
}
