// Analysis record builder — the machine-first output of the analyzer.
//
// buildAnalysisRecord() folds flow + conformance + fault tree into ONE
// versioned JSON document (analysis.json) designed to be consumed directly by
// an LLM or a script without reading the full trace:
//   - stable top-level keys and enum values (see docs/analysis-schema.md)
//   - every finding points at the trace via JSON paths into flow_data.json
//   - free text is bounded; full text lives in sidecars referenced from flow_data
//
// renderAnalysisMarkdown() renders the same record for engineers: verdict,
// fault tree diagram, findings and per-target recommendations.

export const SCHEMA_VERSION = '1.0.0';

const SEVERITY_WEIGHT = { critical: 40, major: 15, minor: 5 };
const SEVERITY_PRIORITY = { critical: 'high', major: 'medium', minor: 'low' };

// category → { target, suggestion } — advice aimed at improving the skill or
// workflow definition, not just this one run.
const PLAYBOOK = {
  'action-error': {
    target: 'workflow',
    suggestion: 'Inspect the failing output at the referenced turns. Add a precondition check (file exists, dependency installed, correct cwd) or a documented fallback for this command/tool to the workflow.'
  },
  'retry-loop': {
    target: 'workflow',
    suggestion: 'The agent repeated the same action instead of changing approach. Add explicit error-handling guidance to the skill/workflow: read the error output, and switch strategy after the first failed retry.'
  },
  'plan-step-dropped': {
    target: 'skill',
    suggestion: 'A declared step was never executed. Either the step is unclear or redundant (remove or clarify it in SKILL.md), or the agent skipped it (strengthen the instruction, or gate progress on a checklist item).'
  },
  'off-plan-action': {
    target: 'workflow',
    suggestion: 'Actions ran outside every declared plan phase. Plan granularity may be too coarse — require the agent to update task_progress when scope changes so execution stays attributable.'
  },
  'no-completion': {
    target: 'workflow',
    suggestion: 'The run ended without attempt_completion. Check the last turns for a dead-end loop, context overflow, or user abort; add a wrap-up instruction so partial results are still reported.'
  },
  'unfinished-checklist': {
    target: 'workflow',
    suggestion: 'Checklist items were still open at the end. Verify whether work was silently skipped or the checklist simply was not updated; enforce checklist updates before completion in the workflow.'
  },
  'slow-turn': {
    target: 'runtime',
    suggestion: 'Investigate the outlier turns: oversized tool outputs or prompts are the usual cause. Consider truncating command output or splitting the step.'
  },
  'cost-spike': {
    target: 'runtime',
    suggestion: 'Outlier API cost usually means a cache miss on a large context. Check cacheReads vs cacheWrites on those turns; keep the prompt prefix stable to stay cached.'
  }
};

function clip(s, n = 500) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function skillNamesFromEvidence(ev) {
  return [...new Set(ev.map(e => e.skill).filter(Boolean))];
}

export function buildAnalysisRecord({ flow, expected, conformance, fta, generatedAt }) {
  const findings = fta.basicEvents.map((be, i) => {
    const play = PLAYBOOK[be.category] || { target: 'workflow', suggestion: '' };
    return {
      id: `F${String(i + 1).padStart(3, '0')}`,
      category: be.category,
      severity: be.severity,
      title: clip(be.label, 200),
      detail: clip(be.evidence.map(e => e.note).filter(Boolean).join('; '), 600),
      observed: be.observed,
      evidence: be.evidence.map(e => ({ turn: e.turn, action: e.action, ref: e.ref })),
      ftaEventId: be.id,
      suggestion: play.suggestion
    };
  });

  const severityCount = { critical: 0, major: 0, minor: 0 };
  for (const f of findings) severityCount[f.severity] = (severityCount[f.severity] || 0) + 1;
  const healthScore = Math.max(0, 100 - findings.reduce((s, f) => s + (SEVERITY_WEIGHT[f.severity] || 0), 0));

  const completed = !!(flow.completion && (flow.completion.preview || flow.completion.fullLen));
  const status = !completed ? 'incomplete' : (findings.length ? 'completed_with_faults' : 'completed');

  // Aggregate findings into per-target recommendations, most severe first.
  const order = { critical: 0, major: 1, minor: 2 };
  const recommendations = [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map(f => {
      const play = PLAYBOOK[f.category] || { target: 'workflow' };
      const ftaEvent = fta.basicEvents.find(be => be.id === f.ftaEventId);
      const skills = ftaEvent ? skillNamesFromEvidence(ftaEvent.evidence) : [];
      return {
        target: play.target,
        targetName: play.target === 'skill' && skills.length ? skills.join(', ') : null,
        priority: SEVERITY_PRIORITY[f.severity],
        text: f.suggestion,
        findingIds: [f.id]
      };
    });

  const t = flow.totals;
  const totalActions = flow.turns.reduce((s, x) => s + x.actions.length, 0);
  const errorActionCount = flow.turns.reduce(
    (s, x) => s + x.actions.filter(a => a.output && a.output.isError).length, 0);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt || new Date().toISOString(),
    task: {
      id: flow.taskId,
      prompt: clip(flow.prompt, 500),
      model: flow.model ? { modelId: flow.model.modelId, mode: flow.model.mode } : null
    },
    outcome: {
      status,
      healthScore,
      completionPreview: clip(flow.completion?.preview, 300)
    },
    metrics: {
      turns: t.turns,
      events: t.events,
      durationMs: t.durationMs,
      avgTurnDurationMs: t.turns ? Math.round(flow.turns.reduce((s, x) => s + x.durationMs, 0) / t.turns) : 0,
      tokensIn: t.tokensIn,
      tokensOut: t.tokensOut,
      cost: +t.cost.toFixed(4),
      cacheReads: t.cacheReads,
      cacheWrites: t.cacheWrites,
      cacheHitRate: (t.cacheReads + t.cacheWrites) ? +(t.cacheReads / (t.cacheReads + t.cacheWrites)).toFixed(3) : 0,
      totalActions,
      errorActionCount,
      errorTurns: flow.turns.filter(x => x.hasError).length
    },
    plan: conformance ? {
      source: conformance.source,
      adherenceScore: conformance.score,
      totalSteps: conformance.total,
      kept: conformance.planEvolution?.kept || [],
      dropped: conformance.planEvolution?.dropped || [],
      added: conformance.planEvolution?.added || [],
      attribution: conformance.attribution ? {
        attributed: conformance.attribution.attributed,
        orphanCount: conformance.attribution.orphanCount,
        totalActions: conformance.attribution.totalActions
      } : null
    } : null,
    fta: {
      healthy: fta.healthy,
      top: fta.top,
      cutSets: fta.cutSets,
      severityCount
    },
    findings,
    recommendations
  };
}

// --- engineer-facing markdown ----------------------------------------------

const SEV_ICON = { critical: '🟥', major: '🟧', minor: '🟦' };
const STATUS_LABEL = {
  completed: '✅ Completed cleanly',
  completed_with_faults: '⚠️ Completed with faults',
  incomplete: '❌ Incomplete'
};

function cell(s) { return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

export function renderAnalysisMarkdown(record, { ftaMermaid } = {}) {
  const L = [];
  const m = record.metrics;
  L.push(`# 🧪 Task Analysis Report — ${record.task.id}`);
  L.push('');
  L.push(`> Generated ${record.generatedAt} · schema \`${record.schemaVersion}\` · machine-readable twin: \`analysis.json\``);
  L.push('');
  L.push('## 1. Verdict');
  L.push('');
  L.push('| Metric | Value |');
  L.push('| :--- | :--- |');
  L.push(`| **Outcome** | ${STATUS_LABEL[record.outcome.status]} |`);
  L.push(`| **Health score** | **${record.outcome.healthScore}/100** |`);
  if (record.plan) {
    L.push(`| **Plan adherence** | ${record.plan.adherenceScore} (source: ${record.plan.source}) — kept ${record.plan.kept.length}, dropped ${record.plan.dropped.length}, added ${record.plan.added.length} |`);
  }
  L.push(`| **Findings** | 🟥 ${record.fta.severityCount.critical} critical · 🟧 ${record.fta.severityCount.major} major · 🟦 ${record.fta.severityCount.minor} minor |`);
  L.push(`| **Errors** | ${m.errorActionCount}/${m.totalActions} actions failed across ${m.errorTurns}/${m.turns} turns |`);
  L.push(`| **Cost / Cache** | $${m.cost} · cache hit rate ${(m.cacheHitRate * 100).toFixed(1)}% |`);
  L.push('');

  L.push('## 2. Fault Tree (FTA)');
  L.push('');
  if (record.fta.healthy) {
    L.push('No fault events detected — the tree is empty. 🎉');
  } else {
    if (ftaMermaid) {
      L.push('```mermaid');
      L.push(ftaMermaid);
      L.push('```');
      L.push('');
    }
    L.push('**Minimal cut sets** (any one line is enough to degrade the outcome):');
    L.push('');
    for (const cs of record.fta.cutSets) L.push(`- ${cs.map(id => `\`${id}\``).join(' AND ')}`);
  }
  L.push('');

  L.push('## 3. Findings');
  L.push('');
  if (!record.findings.length) {
    L.push('_None._');
  } else {
    L.push('| ID | Sev | Category | Finding | Evidence |');
    L.push('| :-- | :-- | :-- | :-- | :-- |');
    for (const f of record.findings) {
      const ev = f.evidence.slice(0, 4).map(e => e.ref ? `\`${e.ref}\`` : '').filter(Boolean).join('<br>');
      L.push(`| ${f.id} | ${SEV_ICON[f.severity]} ${f.severity} | \`${f.category}\` | ${cell(f.title)} | ${ev}${f.evidence.length > 4 ? `<br>_+${f.evidence.length - 4} more_` : ''} |`);
    }
    L.push('');
    L.push('_Evidence refs are JSON paths into `flow_data.json` — open the dashboard Inspector tab or the file itself to see the raw turn._');
  }
  L.push('');

  L.push('## 4. Recommendations (improve the skill / workflow)');
  L.push('');
  if (!record.recommendations.length) {
    L.push('_Nothing to improve — clean run._');
  } else {
    for (const r of record.recommendations) {
      const target = r.targetName ? `**${r.target}: ${r.targetName}**` : `**${r.target}**`;
      L.push(`- [${r.priority}] ${target} — ${r.text} _(from ${r.findingIds.join(', ')})_`);
    }
  }
  L.push('');

  if (record.plan) {
    L.push('## 5. Plan evolution');
    L.push('');
    L.push('| | Step |');
    L.push('|--|--|');
    for (const k of record.plan.kept) L.push(`| ✓ kept | ${cell(k)} |`);
    for (const d of record.plan.dropped) L.push(`| ✗ dropped | ${cell(d)} |`);
    for (const a of record.plan.added) L.push(`| ＋ added | ${cell(a)} |`);
    L.push('');
  }

  L.push('---');
  L.push('_For automated consumers: parse `analysis.json` (same directory). Schema contract: `docs/analysis-schema.md`._');
  L.push('');
  return L.join('\n');
}
