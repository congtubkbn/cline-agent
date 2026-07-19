import { groupTurns } from './turns.js';
import { extractIntent } from './intent.js';
import { makeTextPolicy } from './text-policy.js';
import { toMermaid } from './diagram.js';
import { detectError } from './errors.js';

// Cline appends a "# Context Window Usage" line to each request's
// environment_details, e.g. "19,427 / 256K tokens used (8%)". It reflects the
// context size entering this turn. Parse it from the raw request text.
export function parseContextWindow(reqText) {
  if (!reqText) return null;
  const m = reqText.match(/#\s*Context Window Usage\s*\r?\n\s*([\d,]+)\s*\/\s*([\d.,]+\s*[KM]?)\s*tokens used\s*\(([\d.]+)\s*%\)/i);
  if (!m) return null;
  return {
    used: parseInt(m[1].replace(/,/g, ''), 10),
    total: m[2].replace(/\s+/g, ''),
    percent: parseFloat(m[3]),
    raw: `${m[1]} / ${m[2].replace(/\s+/g, '')} tokens used (${m[3]}%)`
  };
}

export function buildFlow(run, { thresholdTokens = 200, perKind = {}, sink } = {}) {
  const policy = makeTextPolicy({ thresholdTokens, perKind, sink });
  const rawTurns = groupTurns(run.events);

  const turns = rawTurns.map(t => {
    const reasoningText = t.reasoning?.text || '';
    const actions = t.actions.map((a, ai) => {
      const hasErr = a.output ? detectError(a.output.text) : false;
      return {
        kind: a.kind,
        ts: a.ts,
        what: a.what,
        why: extractIntent(reasoningText, a),
        text: policy(`action_${a.kind}`, `${t.index}_${ai}`, a.text),
        output: a.output ? {
          ts: a.output.ts,
          isError: hasErr,
          ...policy('output', `${t.index}_${ai}_out`, a.output.text)
        } : null
      };
    });
    const errors = t.errors.map((er, ei) => ({
      ts: er.ts,
      text: policy('error', `${t.index}_${ei}_err`, er.text)
    }));
    const turnHasError = errors.length > 0 || actions.some(act => act.output && act.output.isError);
    const d = t.request.data || {};
    return {
      index: t.index,
      tsStart: t.tsStart, tsEnd: t.tsEnd, durationMs: t.durationMs,
      hasError: turnHasError,
      request: {
        tokensIn: d.tokensIn || 0, tokensOut: d.tokensOut || 0, cost: d.cost || 0,
        cacheReads: d.cacheReads || 0, cacheWrites: d.cacheWrites || 0,
        contextWindow: parseContextWindow(d.request),
        text: policy('request', `${t.index}_req`, d.request || '')
      },
      reasoning: reasoningText ? policy('reasoning', `${t.index}_reason`, reasoningText) : null,
      texts: t.texts.map((x, i) => ({ ts: x.ts, ...policy('say_text', `${t.index}_say${i}`, x.text) })),
      actions,
      errors,
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
    acc.activeDurationMs += (t.durationMs || 0);
    return acc;
  }, { turns: turns.length, events: run.events.length, tokensIn: 0, tokensOut: 0, cost: 0, cacheReads: 0, cacheWrites: 0, activeDurationMs: 0 });
  const ts = run.events.map(e => e.ts).filter(Boolean);
  let minTs = ts[0] || 0;
  let maxTs = ts[0] || 0;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] < minTs) minTs = ts[i];
    if (ts[i] > maxTs) maxTs = ts[i];
  }
  totals.durationMs = maxTs - minTs;

  // `stats` is an alias of `totals` using the field names the web UI reads.
  const stats = {
    durationMs: totals.durationMs,
    activeDurationMs: totals.activeDurationMs,
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
    totals, stats, turns, completion, mermaid: toMermaid(turns)
  };
}
