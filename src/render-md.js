function block(b) {
  if (!b) return '_none_';
  let s = b.preview || '';
  if (b.sidecar) s += `\n\n  > _summary:_ ${b.summary}  \n  > _full (${b.fullLen} chars):_ \`${b.sidecar}\``;
  return s;
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
    L.push(`## Turn ${turn.index}  ·  +${Math.round(turn.durationMs/1000)}s  ·  ${turn.request.tokensIn}→${turn.request.tokensOut} tok`);
    if (turn.reasoning) { L.push('**Reasoning:**'); L.push(block(turn.reasoning)); }
    for (const a of turn.actions) {
      const what = a.kind === 'tool' ? `${a.what.tool} ${a.what.path || ''}`.trim() : a.what.command;
      L.push(`- **${a.kind}:** \`${what}\``);
      if (a.why) L.push(`  **why:** ${a.why}`);
      if (a.output) L.push(`  **output:** ${block(a.output)}`);
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
