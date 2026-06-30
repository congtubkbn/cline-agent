import { groupTurns } from './turns.js';
import { extractIntent } from './intent.js';
import { makeTextPolicy } from './text-policy.js';
import { toMermaid } from './diagram.js';

export function buildFlow(run, { thresholdTokens = 200, perKind = {}, sink } = {}) {
  const policy = makeTextPolicy({ thresholdTokens, perKind, sink });
  const rawTurns = groupTurns(run.events);

  const turns = rawTurns.map(t => {
    const reasoningText = t.reasoning?.text || '';
    const actions = t.actions.map((a, ai) => ({
      kind: a.kind,
      what: a.what,
      why: extractIntent(reasoningText, a),
      text: policy(`action_${a.kind}`, `${t.index}_${ai}`, a.text),
      output: a.output ? policy('output', `${t.index}_${ai}_out`, a.output.text) : null
    }));
    const d = t.request.data || {};
    return {
      index: t.index,
      tsStart: t.tsStart, tsEnd: t.tsEnd, durationMs: t.durationMs,
      request: {
        tokensIn: d.tokensIn || 0, tokensOut: d.tokensOut || 0, cost: d.cost || 0,
        cacheReads: d.cacheReads || 0, cacheWrites: d.cacheWrites || 0,
        text: policy('request', `${t.index}_req`, d.request || '')
      },
      reasoning: reasoningText ? policy('reasoning', `${t.index}_reason`, reasoningText) : null,
      actions,
      taskProgress: t.taskProgress ? { items: t.taskProgress.items } : null,
      checkpoint: t.checkpoint ? { hash: t.checkpoint.hash, checkedOut: t.checkpoint.checkedOut } : null
    };
  });

  const completionEv = [...run.events].reverse().find(e => e.subtype === 'completion_result' && e.text);
  const completion = completionEv
    ? policy('completion', 'completion', completionEv.text)
    : { preview: '', summary: '', sidecar: '', fullLen: 0 };

  const totals = turns.reduce((acc, t) => {
    acc.tokensIn += t.request.tokensIn; acc.tokensOut += t.request.tokensOut;
    acc.cost += t.request.cost; acc.cacheReads += t.request.cacheReads;
    acc.cacheWrites += t.request.cacheWrites;
    return acc;
  }, { turns: turns.length, events: run.events.length, tokensIn: 0, tokensOut: 0, cost: 0, cacheReads: 0, cacheWrites: 0 });
  const ts = run.events.map(e => e.ts).filter(Boolean);
  totals.durationMs = ts.length ? Math.max(...ts) - Math.min(...ts) : 0;

  // `stats` is an alias of `totals` using the field names the web UI reads.
  const stats = {
    durationMs: totals.durationMs,
    totalSteps: totals.turns,
    totalEvents: totals.events,
    totalTokensIn: totals.tokensIn,
    totalTokensOut: totals.tokensOut,
    totalCost: totals.cost,
    totalCacheReads: totals.cacheReads,
    totalCacheWrites: totals.cacheWrites
  };

  return {
    taskId: run.taskId, model: run.model, prompt: run.prompt,
    totals, stats, turns, completion, mermaid: toMermaid(rawTurns)
  };
}
