function block(b) {
  if (!b) return '_none_';
  let s = b.preview || '';
  if (b.sidecar) s += `\n\n  > _summary:_ ${b.summary}  \n  > _full (${b.fullLen} chars):_ \`${b.sidecar}\``;
  return s;
}

function formatFullTime(ts) {
  if (!ts) return '_N/A_';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function renderMarkdown(flow) {
  const L = [];
  L.push(`# Flow Report — task ${flow.taskId}`);
  L.push('');
  L.push(`**Prompt:** ${flow.prompt}`);
  if (flow.model) L.push(`**Model:** ${flow.model.modelId} (${flow.model.mode})`);
  const t = flow.totals;
  L.push(`**Totals:** ${t.turns} turns · ${t.events} events · ${t.tokensIn} tok in / ${t.tokensOut} out · ${t.cacheReads} cache reads · cost ${t.cost} · ${Math.round(t.durationMs/1000)}s`);
  L.push('');
  L.push('## Flow Diagram');
  L.push('```mermaid');
  L.push(flow.mermaid);
  L.push('```');
  L.push('');
  for (const turn of flow.turns) {
    const startStr = formatFullTime(turn.tsStart);
    const endStr = formatFullTime(turn.tsEnd);
    L.push(`## Turn ${turn.index}  ·  [${startStr} - ${endStr} | ts: ${turn.tsStart}]  ·  +${Math.round(turn.durationMs/1000)}s  ·  ${turn.request.tokensIn}→${turn.request.tokensOut} tok`);
    if (turn.reasoning) { L.push('**Reasoning:**'); L.push(block(turn.reasoning)); }
    for (const a of turn.actions) {
      const what = a.kind === 'tool' ? `${a.what.tool} ${a.what.path || ''}`.trim() : a.what.command;
      const actionTime = formatFullTime(a.ts);
      L.push(`- **${a.kind}:** \`${what}\` \`[${actionTime} | ts: ${a.ts}]\``);
      if (a.why) L.push(`  **why:** ${a.why}`);
      if (a.output) {
        const outTime = formatFullTime(a.output.ts);
        const delta = ((a.output.ts - a.ts) / 1000).toFixed(2);
        L.push(`  **output:** \`[${outTime} | ts: ${a.output.ts}]\` (\`+${delta}s\`)`);
        L.push(`  ${block(a.output).split('\n').join('\n  ')}`);
      }
    }
    if (turn.taskProgress) {
      L.push('**Progress:**');
      for (const it of turn.taskProgress.items) L.push(`- [${it.done ? 'x' : ' '}] ${it.text}`);
    }
    if (turn.checkpoint) L.push(`_checkpoint:_ \`${turn.checkpoint.hash}\``);
    L.push('');
  }
  L.push('## Completion');
  L.push(block(flow.completion));
  L.push('');
  return L.join('\n');
}
