// Fault Tree Analysis (FTA) over a parsed flow (+ conformance).
//
// The tree explains WHY a run degraded: a single top event decomposes through
// OR/AND gates into observable basic events. Every basic event carries evidence
// pointers — JSON paths into flow_data.json (e.g. `turns[3].actions[0]`) — so an
// engineer or an LLM can jump straight from a fault to the raw trace that
// produced it.
//
// Node shape (nested):
//   { id, type: 'top'|'intermediate'|'basic', gate: 'OR'|'AND'|null,
//     label, category?, severity?, observed?: { count, rate }, evidence?: [], children: [] }
//
// Categories and severities are STABLE ENUMS (see docs/analysis-schema.md);
// downstream consumers key off them, so add values but never rename.

export const SEVERITY = { CRITICAL: 'critical', MAJOR: 'major', MINOR: 'minor' };

const CATEGORY = {
  ACTION_ERROR: 'action-error',
  RETRY_LOOP: 'retry-loop',
  PLAN_STEP_DROPPED: 'plan-step-dropped',
  OFF_PLAN_ACTION: 'off-plan-action',
  NO_COMPLETION: 'no-completion',
  UNFINISHED_CHECKLIST: 'unfinished-checklist',
  SLOW_TURN: 'slow-turn',
  COST_SPIKE: 'cost-spike'
};

function actionSignature(a) {
  if (a.kind === 'command') {
    const words = String(a.what?.command || '').trim().split(/\s+/);
    return `cmd:${words.slice(0, 2).join(' ')}`;
  }
  const tool = a.what?.tool || 'tool';
  const path = a.what?.path || '';
  return `tool:${tool}${path ? ' ' + path : ''}`;
}

// Flatten actions keeping their trace coordinates.
function flatActions(flow) {
  const out = [];
  for (const t of flow.turns) {
    t.actions.forEach((a, ai) => out.push({
      turn: t.index, action: ai, ref: `turns[${t.index}].actions[${ai}]`,
      kind: a.kind, sig: actionSignature(a), why: a.why || '',
      isError: !!(a.output && a.output.isError)
    }));
  }
  return out;
}

function basicEvent(id, category, severity, label, evidence, denominator) {
  return {
    id, type: 'basic', gate: null, label, category, severity,
    observed: {
      count: evidence.length,
      rate: denominator ? +(evidence.length / denominator).toFixed(3) : null
    },
    evidence, children: []
  };
}

// --- detectors -------------------------------------------------------------

// Failed actions grouped by signature: one basic event per failing command/tool.
function detectActionErrors(actions) {
  const bySig = new Map();
  for (const a of actions) {
    if (!a.isError) continue;
    if (!bySig.has(a.sig)) bySig.set(a.sig, []);
    bySig.get(a.sig).push({ turn: a.turn, action: a.action, ref: a.ref, note: a.sig });
  }
  let i = 0;
  return [...bySig.entries()].map(([sig, ev]) =>
    basicEvent(`BE-ERR-${i++}`, CATEGORY.ACTION_ERROR, SEVERITY.MAJOR,
      `Action failed: ${sig} (×${ev.length})`, ev, actions.length));
}

// Consecutive repeats of the same action signature with at least one error in
// the run = the agent thrashing on a step instead of progressing.
function detectRetryLoops(actions) {
  const events = [];
  let i = 0;
  while (i < actions.length) {
    let j = i + 1;
    while (j < actions.length && actions[j].sig === actions[i].sig) j++;
    const run = actions.slice(i, j);
    if (run.length >= 2 && run.some(a => a.isError)) {
      const ev = run.map(a => ({ turn: a.turn, action: a.action, ref: a.ref, note: a.sig }));
      events.push(basicEvent(`BE-RETRY-${events.length}`, CATEGORY.RETRY_LOOP, SEVERITY.MAJOR,
        `Retry loop: ${run[0].sig} repeated ×${run.length} with error(s)`, ev, actions.length));
    }
    i = j;
  }
  return events;
}

// Plan deviation, read from the conformance layer (analyze.js).
function detectPlanDeviation(conformance) {
  const events = [];
  if (!conformance) return events;
  const dropped = (conformance.rows || []).filter(r => r.status === 'missing');
  if (dropped.length) {
    const fromSkill = conformance.source === 'skill-contract';
    events.push(basicEvent('BE-PLAN-DROP', CATEGORY.PLAN_STEP_DROPPED,
      fromSkill ? SEVERITY.MAJOR : SEVERITY.MINOR,
      `${dropped.length} planned step(s) never executed (source: ${conformance.source})`,
      dropped.map(r => ({
        turn: null, action: null,
        ref: `conformance.rows[?expected.id=='${r.expected.id}']`,
        note: r.expected.what, skill: r.expected.skill || null
      })),
      conformance.total || null));
  }
  const orphans = conformance.attribution?.orphans || [];
  if (orphans.length) {
    events.push(basicEvent('BE-PLAN-ORPHAN', CATEGORY.OFF_PLAN_ACTION, SEVERITY.MINOR,
      `${orphans.length} action(s) matched no plan phase`,
      orphans.map(o => ({ turn: null, action: null, ref: 'conformance.attribution.orphans', note: o.text })),
      conformance.attribution?.totalActions || null));
  }
  return events;
}

// Outcome faults: the run never reached completion, or ended with an
// unfinished checklist.
function detectOutcomeFaults(flow) {
  const events = [];
  const c = flow.completion;
  const completed = !!(c && (c.preview || c.fullLen));
  if (!completed) {
    events.push(basicEvent('BE-NO-COMPLETION', CATEGORY.NO_COMPLETION, SEVERITY.CRITICAL,
      'Run ended without a completion_result', [{ turn: null, action: null, ref: 'completion', note: 'empty completion block' }], null));
  }
  const lastProgress = [...flow.turns].reverse().find(t => t.taskProgress && t.taskProgress.items.length);
  const undone = lastProgress ? lastProgress.taskProgress.items.filter(it => !it.done) : [];
  if (undone.length) {
    events.push(basicEvent('BE-CHECKLIST', CATEGORY.UNFINISHED_CHECKLIST, SEVERITY.MAJOR,
      `${undone.length} checklist item(s) still open at end of run`,
      undone.map(it => ({
        turn: lastProgress.index, action: null,
        ref: `turns[${lastProgress.index}].taskProgress`, note: it.text
      })),
      lastProgress.taskProgress.items.length));
  }
  return events;
}

// Statistical outliers (> mean + 2σ) on turn duration and cost; needs enough
// turns for σ to mean anything.
function detectPerfOutliers(flow) {
  const events = [];
  const turns = flow.turns;
  if (turns.length < 4) return events;
  const outliers = (values) => {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    const cut = mean + 2 * sd;
    return { cut, idx: values.map((v, i) => (sd > 0 && v > cut) ? i : -1).filter(i => i >= 0) };
  };
  const dur = outliers(turns.map(t => t.durationMs));
  if (dur.idx.length) {
    events.push(basicEvent('BE-SLOW', CATEGORY.SLOW_TURN, SEVERITY.MINOR,
      `${dur.idx.length} turn(s) far slower than the run average (> ${Math.round(dur.cut / 1000)}s)`,
      dur.idx.map(i => ({
        turn: turns[i].index, action: null, ref: `turns[${turns[i].index}]`,
        note: `${Math.round(turns[i].durationMs / 1000)}s`
      })),
      turns.length));
  }
  const cost = outliers(turns.map(t => t.request.cost));
  if (cost.idx.length) {
    events.push(basicEvent('BE-COST', CATEGORY.COST_SPIKE, SEVERITY.MINOR,
      `${cost.idx.length} turn(s) with outlier API cost`,
      cost.idx.map(i => ({
        turn: turns[i].index, action: null, ref: `turns[${turns[i].index}].request`,
        note: `$${turns[i].request.cost.toFixed(4)}`
      })),
      turns.length));
  }
  return events;
}

// --- tree assembly ---------------------------------------------------------

function gate(id, label, children) {
  return { id, type: 'intermediate', gate: 'OR', label, children };
}

export function buildFaultTree(flow, conformance = null) {
  const actions = flatActions(flow);
  const branches = [
    gate('G-EXEC', 'Execution faults', [...detectActionErrors(actions), ...detectRetryLoops(actions)]),
    gate('G-PLAN', 'Plan deviation', detectPlanDeviation(conformance)),
    gate('G-OUTCOME', 'Incomplete outcome', detectOutcomeFaults(flow)),
    gate('G-PERF', 'Efficiency degradation', detectPerfOutliers(flow))
  ].filter(g => g.children.length);

  const top = {
    id: 'TOP', type: 'top', gate: 'OR',
    label: 'Degraded task outcome',
    children: branches
  };
  return {
    top,
    healthy: branches.length === 0,
    basicEvents: collectBasics(top),
    cutSets: branches.length ? minimalCutSets(top) : []
  };
}

export function collectBasics(node, acc = []) {
  if (node.type === 'basic') { acc.push(node); return acc; }
  for (const c of node.children) collectBasics(c, acc);
  return acc;
}

// Minimal cut sets: smallest combinations of basic events that trigger the top
// event. OR = union of children's sets, AND = cross product; supersets pruned.
export function minimalCutSets(node, cap = 64) {
  const sets = (function walk(n) {
    if (n.type === 'basic') return [[n.id]];
    const childSets = n.children.map(walk).filter(s => s.length);
    if (!childSets.length) return [];
    if (n.gate === 'AND') {
      let acc = [[]];
      for (const cs of childSets) {
        const next = [];
        for (const a of acc) for (const b of cs) next.push([...new Set([...a, ...b])]);
        acc = next.slice(0, cap);
      }
      return acc;
    }
    return childSets.flat().slice(0, cap);
  })(node);
  // prune supersets to keep the sets minimal
  const sorted = sets.map(s => [...s].sort()).sort((a, b) => a.length - b.length);
  const minimal = [];
  for (const s of sorted) {
    if (!minimal.some(m => m.every(id => s.includes(id)))) minimal.push(s);
  }
  return minimal.slice(0, cap);
}

// --- rendering -------------------------------------------------------------

function esc(s) { return String(s).replace(/"/g, "'").replace(/[\n\r]+/g, ' '); }

export function ftaToMermaid(tree) {
  const L = ['flowchart TD'];
  if (tree.healthy) {
    L.push('  TOP["✅ No faults observed — healthy run"]');
    return L.join('\n');
  }
  const edges = [];
  (function walk(n) {
    if (n.type === 'basic') {
      L.push(`  ${n.id}(["${esc(n.label)}"])`);
      L.push(`  class ${n.id} sev_${n.severity};`);
      return;
    }
    const shape = n.type === 'top' ? `["🔺 ${esc(n.label)}"]` : `["${esc(n.label)}"]`;
    L.push(`  ${n.id}${shape}`);
    if (n.children.length) {
      const gid = `${n.id}_GATE`;
      L.push(`  ${gid}{{"${n.gate}"}}`);
      edges.push(`  ${n.id} --- ${gid}`);
      for (const c of n.children) {
        edges.push(`  ${gid} --> ${c.id}`);
        walk(c);
      }
    }
  })(tree.top);
  L.push(...edges);
  L.push('  classDef sev_critical fill:#7f1d1d,stroke:#f43f5e,color:#fff;');
  L.push('  classDef sev_major fill:#78350f,stroke:#f59e0b,color:#fff;');
  L.push('  classDef sev_minor fill:#1e3a5f,stroke:#06b6d4,color:#fff;');
  return L.join('\n');
}
