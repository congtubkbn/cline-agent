import fs from 'node:fs';
import path from 'node:path';

// self-declared: the agent's FIRST non-empty task_progress checklist = its initial plan = expected.
export function fromSelfDeclared(progressSnapshots) {
  const first = (progressSnapshots || []).find(s => s.items && s.items.length);
  const steps = (first?.items || []).map((it, i) => ({ id: `sd${i}`, what: it.text, why: '' }));
  return { source: 'self-declared', steps };
}

// skill-contract: parse prescribed steps (numbered or bulleted lines, >=4 chars) from
// <root>/<name>/SKILL.md for each resolvable skill. Auto-skips skills with no file.
export function fromSkillContract(skillNames, skillRoots) {
  const steps = [];
  for (const name of skillNames || []) {
    const dir = (skillRoots || [])
      .map(r => path.join(r, name))
      .find(p => fs.existsSync(path.join(p, 'SKILL.md')));
    if (!dir) continue;
    const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    md.split('\n')
      .map(l => l.match(/^\s*(?:\d+\.|[-*])\s+(.{4,})$/))
      .filter(Boolean)
      .forEach((m, i) => steps.push({ id: `${name}-${i}`, what: m[1].trim(), why: '', skill: name }));
  }
  return { source: 'skill-contract', steps };
}

// Priority: skill-contract (most objective) when it yields steps, else self-declared.
export function buildExpected({ progressSnapshots, skillNames = [], skillRoots = [] }) {
  const sc = fromSkillContract(skillNames, skillRoots);
  if (sc.steps.length) return sc;
  return fromSelfDeclared(progressSnapshots);
}
