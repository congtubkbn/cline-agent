// match = kept item, missing = dropped from plan, unexpected = added/emergent phase.
const MARK = { match: '✓', missing: '✗', unexpected: '＋' };

function cell(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }

export function renderCompare(c) {
  const L = [];
  L.push('# Expected vs Actual');
  L.push('');
  L.push(`**Source:** ${c.source} · **Plan adherence:** ${c.score} · kept ${c.covered}/${c.total} · dropped ${c.missing} · added ${c.unexpected}`);
  L.push('');
  L.push('## Plan adherence (initial plan → final plan)');
  L.push('');
  L.push('| | Expected (initial) | Actual (final plan) |');
  L.push('|--|--|--|');
  for (const r of c.rows) {
    const exp = r.expected ? cell(r.expected.what) : '—';
    const act = r.actual ? cell(r.actual.text) : '—';
    L.push(`| ${MARK[r.status]} | ${exp} | ${act} |`);
  }
  L.push('');

  if (c.attribution) {
    const a = c.attribution;
    L.push(`## Execution attribution (${a.attributed}/${a.totalActions} actions mapped to a plan phase, ${a.orphanCount} off-plan)`);
    L.push('');
    for (const p of a.phases) {
      L.push(`- **${cell(p.phase)}** — ${p.count} action(s)`);
      for (const act of p.actions) L.push(`  - \`${cell(act.text)}\` _(${act.kind})_`);
    }
    if (a.orphans.length) {
      L.push(`- **⚠ Off-plan (no matching phase)** — ${a.orphanCount}`);
      for (const o of a.orphans) L.push(`  - \`${cell(o.text)}\` _(${o.kind})_`);
    }
    L.push('');
  }
  return L.join('\n');
}
