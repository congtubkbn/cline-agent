import path from 'node:path';
import { buildFlow } from './flow.js';
import { buildExpected } from './expectation.js';
import { conform, attribute } from './conformance.js';
import { renderCompare } from './render-compare.js';

// Collect every task_progress snapshot (ordered) from raw events.
function progressSnapshots(run) {
  return run.events
    .filter(e => e.subtype === 'task_progress')
    .map(e => ({ items: parseChecklist(e.text) }));
}
function parseChecklist(text) {
  if (!text) return [];
  return text.split('\n')
    .map(l => l.match(/^- \[( |x|X)\]\s+(.*)$/))
    .filter(Boolean)
    .map(m => ({ done: m[1].toLowerCase() === 'x', text: m[2].trim() }));
}

// Skill names invoked via useSkill tool actions.
function invokedSkills(flow) {
  const names = new Set();
  for (const t of flow.turns) for (const a of t.actions) {
    if (a.kind === 'tool' && a.what && a.what.tool === 'useSkill' && a.what.path) names.add(a.what.path);
  }
  return [...names];
}

// Last non-empty task_progress snapshot = the agent's final plan.
function finalDeclared(snaps) {
  return [...snaps].reverse().find(s => s.items.length)?.items || [];
}

// Executed actions flattened, intent attached.
function executedActions(flow) {
  return flow.turns.flatMap(t => t.actions).map(a => ({
    text: a.kind === 'tool' ? `${a.what.tool} ${a.what.path || ''}`.trim() : (a.what.command || ''),
    kind: a.kind, why: a.why
  }));
}

export function analyze(run, opts = {}) {
  const flow = buildFlow(run, opts);
  const snaps = progressSnapshots(run);
  const skillRoots = opts.skillRoots || ['.claude/skills', path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'skills')];
  const expected = buildExpected({ progressSnapshots: snaps, skillNames: invokedSkills(flow), skillRoots });

  // Adherence: did the agent keep its INITIAL plan? Compare expected (initial) vs FINAL plan.
  // match = kept, missing = dropped (planned, gone from final), unexpected = added (emergent phase).
  const finalItems = finalDeclared(snaps);
  const adherence = conform(
    expected,
    { candidates: finalItems.map(it => ({ text: it.text, kind: 'declared', done: it.done })) },
    { threshold: opts.matchThreshold ?? 0.15 }
  );

  // Attribution: map each executed action to the final plan phase it served (orphans = off-plan).
  const attribution = attribute(
    finalItems.map(it => ({ text: it.text })),
    executedActions(flow),
    { threshold: opts.attrThreshold ?? 0.12 }
  );

  const conformance = {
    ...adherence,
    planEvolution: {
      kept: adherence.rows.filter(r => r.status === 'match').map(r => r.expected.what),
      dropped: adherence.rows.filter(r => r.status === 'missing').map(r => r.expected.what),
      added: adherence.rows.filter(r => r.status === 'unexpected').map(r => r.actual.text)
    },
    attribution
  };

  flow.expected = expected;
  flow.conformance = conformance;
  return { flow, expected, conformance, compareMd: renderCompare(conformance) };
}
