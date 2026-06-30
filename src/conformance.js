function tokenize(s) { return new Set(String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []); }

export function jaccard(a, b) {
  const A = tokenize(a), B = tokenize(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Attribute each executed action to the best-matching plan phase (intent-aware: action
// text + its `why` are matched against phase text). Actions matching no phase = orphans
// (truly off-plan). Turns a flat "N unexpected" count into structured execution mapping.
export function attribute(phases, actions, { threshold = 0.12 } = {}) {
  const groups = phases.map(p => ({ phase: p.text, actions: [], count: 0 }));
  const orphans = [];
  for (const a of actions) {
    const hay = `${a.text} ${a.why || ''}`;
    let best = -1, bestScore = 0;
    phases.forEach((p, i) => { const s = jaccard(p.text, hay); if (s > bestScore) { bestScore = s; best = i; } });
    if (best >= 0 && bestScore >= threshold) { groups[best].actions.push({ text: a.text, kind: a.kind }); groups[best].count++; }
    else orphans.push({ text: a.text, kind: a.kind });
  }
  return { phases: groups, orphans, orphanCount: orphans.length, attributed: actions.length - orphans.length, totalActions: actions.length };
}

// Align each expected step to the best unused actual candidate (greedy by score).
// Unmatched expected -> missing; unused candidates -> unexpected.
export function conform(expected, actual, { threshold = 0.15 } = {}) {
  const cands = (actual.candidates || []).map((c, i) => ({ ...c, _i: i, _used: false }));
  const rows = [];
  let covered = 0;
  for (const step of expected.steps) {
    let best = null, bestScore = 0;
    for (const c of cands) {
      if (c._used) continue;
      const s = jaccard(step.what, c.text);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (best && bestScore >= threshold) {
      best._used = true; covered++;
      rows.push({ expected: step, actual: { text: best.text, kind: best.kind, why: best.why || '' }, status: 'match', score: +bestScore.toFixed(2) });
    } else {
      rows.push({ expected: step, actual: null, status: 'missing', score: +bestScore.toFixed(2) });
    }
  }
  for (const c of cands) {
    if (!c._used) rows.push({ expected: null, actual: { text: c.text, kind: c.kind, why: c.why || '' }, status: 'unexpected', score: 0 });
  }
  const total = expected.steps.length;
  return {
    source: expected.source, total, covered,
    missing: rows.filter(r => r.status === 'missing').length,
    unexpected: rows.filter(r => r.status === 'unexpected').length,
    score: total ? +(covered / total).toFixed(2) : 0,
    rows
  };
}
