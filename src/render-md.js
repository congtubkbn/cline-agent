function block(b) {
  if (!b) return '_none_';
  let s = b.preview || '';
  if (b.sidecar) s += `\n\n  > _summary:_ ${b.summary}  \n  > _full (${b.fullLen} chars):_ [${b.sidecar}](${b.sidecar})`;
  return s;
}

function ctxHeader(req) {
  const c = req && req.contextWindow;
  if (!c) return '';
  return `  ·  \`🪟 ${c.used.toLocaleString()}/${c.total} (${c.percent}%)\``;
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

function formatDateTime(ts) {
  if (!ts) return '_N/A_';
  const date = new Date(ts);
  const YYYY = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const DD = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

export function renderMarkdown(flow) {
  const L = [];
  const firstTurn = flow.turns[0];
  const lastTurn = flow.turns[flow.turns.length - 1];
  const startTs = firstTurn ? firstTurn.tsStart : null;
  const endTs = lastTurn ? lastTurn.tsEnd : null;
  const t = flow.totals;

  L.push(`# 📊 Agent Loop Flow Report — Task: ${flow.taskId}`);
  L.push('');
  L.push('## 1. 📈 Metadata & Totals');
  L.push('');
  L.push('| 🏷️ Metric | 📝 Value |');
  L.push('| :--- | :--- |');
  L.push(`| **Task (Prompt)** | \`${flow.prompt.replace(/\r?\n/g, ' ')}\` |`);
  if (flow.model) {
    L.push(`| **AI Model (Model)** | \`${flow.model.modelId}\` (${flow.model.mode}) |`);
  }
  L.push(`| **Execution Time** | \`${formatDateTime(startTs)}\` ── \`${formatDateTime(endTs)}\` (Total: **${Math.round(t.durationMs/1000)} seconds**) |`);
  L.push(`| **Resource Usage** | **${t.turns} turns** · **${t.events} events** |`);
  L.push(`| **Tokens Used** | Input: \`${t.tokensIn.toLocaleString()}\` · Output: \`${t.tokensOut.toLocaleString()}\` |`);
  L.push(`| **Cache Read/Write** | Read: \`${t.cacheReads.toLocaleString()}\` · Write: \`${t.cacheWrites.toLocaleString()}\` |`);
  L.push(`| **Cost** | \`$${t.cost.toFixed(4)}\` |`);
  L.push('');
  L.push('## 2. 🗺️ Flow Diagram');
  L.push('```mermaid');
  L.push(flow.mermaid);
  L.push('```');
  L.push('');
  L.push('## 3. 🔍 Detailed Execution Turns');
  L.push('');

  for (const turn of flow.turns) {
    const startStr = formatFullTime(turn.tsStart);
    const endStr = formatFullTime(turn.tsEnd);
    const iconTurn = turn.hasError ? '❌' : '🔄';
    L.push(`### ${iconTurn} Turn ${turn.index}  ·  \`[${startStr} - ${endStr} | ts: ${turn.tsStart}]\`  ·  \`+${Math.round(turn.durationMs/1000)}s\`  ·  \`${turn.request.tokensIn}→${turn.request.tokensOut}\` tok${ctxHeader(turn.request)}`);

    if (turn.request && (turn.request.text?.preview || turn.request.text?.sidecar)) {
      L.push('<details>');
      L.push('<summary>✉️ <b>API Request Prompt</b></summary>');
      L.push('');
      L.push(`> **Tokens In:** \`${turn.request.tokensIn}\` · **Cache Reads:** \`${turn.request.cacheReads}\` · **Cache Writes:** \`${turn.request.cacheWrites}\` · **Cost:** \`$${turn.request.cost.toFixed(4)}\`${turn.request.contextWindow ? ` · **Context Window:** \`${turn.request.contextWindow.raw}\`` : ''}`);
      L.push('>');
      L.push(`> ${block(turn.request.text).split('\n').join('\n> ')}`);
      L.push('</details>');
      L.push('');
    }

    if (turn.reasoning) {
      L.push('<details>');
      L.push('<summary>🧠 <b>AI Reasoning</b></summary>');
      L.push('');
      L.push(`> ${block(turn.reasoning).split('\n').join('\n> ')}`);
      L.push('</details>');
      L.push('');
    }

    for (const s of (turn.texts || [])) {
      L.push(`> 💬 **Agent:** ${block(s).split('\n').join('\n> ')}`);
      L.push(`> — \`${formatFullTime(s.ts)}\` (ts: \`${s.ts}\`)`);
      L.push('');
    }

    for (const a of turn.actions) {
      const what = a.kind === 'tool' ? `${a.what.tool} ${a.what.path || ''}`.trim() : a.what.command;
      const actionTime = formatFullTime(a.ts);
      const icon = a.kind === 'tool' ? '🛠️' : '💻';
      
      L.push(`* ${icon} **${a.kind}:** \`${what}\``);
      L.push(`  * ⏱️ **Time:** \`${actionTime}\` (ts: \`${a.ts}\`)`);
      if (a.why) {
        L.push(`  * 🎯 **Why:** ${a.why}`);
      }
      if (a.output) {
        const outTime = formatFullTime(a.output.ts);
        const delta = ((a.output.ts - a.ts) / 1000).toFixed(2);
        const errAlert = a.output.isError ? ' · ⚠️ **Error Detected!**' : '';
        L.push(`  * 📥 **Output:** \`${outTime}\` (ts: \`${a.output.ts}\`) | delta: \`+${delta}s\`${errAlert}`);
        
        const outputText = block(a.output);
        if (outputText && outputText !== '_none_') {
          const lines = outputText.split('\n');
          const openAttr = a.output.isError ? ' open' : '';
          L.push(`    <details${openAttr}>`);
          L.push(`    <summary>📄 <i>Click to view output details (${lines.length} lines)</i></summary>`);
          L.push('');
          L.push(`    > ` + lines.join('\n    > '));
          L.push('    </details>');
        }
      }
    }

    if (turn.taskProgress && turn.taskProgress.items.length) {
      L.push('  * 📋 **Progress:**');
      for (const it of turn.taskProgress.items) {
        L.push(`    - [${it.done ? 'x' : ' '}] ${it.text}`);
      }
    }
    if (turn.checkpoint) {
      L.push(`  * 💾 **checkpoint:** \`${turn.checkpoint.hash}\``);
    }
    L.push('');
  }
  L.push('## 4. 🏁 Completion Result');
  L.push(block(flow.completion));
  L.push('');
  return L.join('\n');
}

export function renderErrorMarkdown(flow, workspaceRoot = null) {
  const L = [];
  const errorTurns = flow.turns.filter(t => t.hasError);

  let flowReportLink = 'flow_report.md';
  if (workspaceRoot) {
    const normalized = workspaceRoot.replace(/\\/g, '/');
    // Ensure Windows drive letters (like e:) are preceded by a slash or properly formatted if needed.
    // Standard file:/// URL format on Windows can be file:///E:/...
    const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
    flowReportLink = `${prefix}${normalized}/flow_report.md`;
  }

  L.push(`# ❌ Agent Loop Error Report — Task: ${flow.taskId}`);
  L.push('');

  if (errorTurns.length === 0) {
    L.push('🎉 **Congratulations! No execution errors were detected in any of the turns for this task.**');
    L.push('');
    L.push(`👉 *View the full report at [flow_report.md](${flowReportLink}).*`);
    L.push('');
    return L.join('\n');
  }

  L.push(`Detected **${errorTurns.length}** turns with technical errors:`);
  L.push('');

  for (const turn of errorTurns) {
    const startStr = formatFullTime(turn.tsStart);
    const endStr = formatFullTime(turn.tsEnd);
    L.push(`### ❌ Turn ${turn.index}  ·  \`[${startStr} - ${endStr} | ts: ${turn.tsStart}]\`  ·  \`+${Math.round(turn.durationMs/1000)}s\`  ·  \`${turn.request.tokensIn}→${turn.request.tokensOut}\` tok${ctxHeader(turn.request)}`);

    if (turn.request && (turn.request.text?.preview || turn.request.text?.sidecar)) {
      L.push('<details>');
      L.push('<summary>✉️ <b>API Request Prompt</b></summary>');
      L.push('');
      L.push(`> **Tokens In:** \`${turn.request.tokensIn}\` · **Cache Reads:** \`${turn.request.cacheReads}\` · **Cache Writes:** \`${turn.request.cacheWrites}\` · **Cost:** \`$${turn.request.cost.toFixed(4)}\`${turn.request.contextWindow ? ` · **Context Window:** \`${turn.request.contextWindow.raw}\`` : ''}`);
      L.push('>');
      L.push(`> ${block(turn.request.text).split('\n').join('\n> ')}`);
      L.push('</details>');
      L.push('');
    }

    if (turn.reasoning) {
      L.push('<details>');
      L.push('<summary>🧠 <b>AI Reasoning</b></summary>');
      L.push('');
      L.push(`> ${block(turn.reasoning).split('\n').join('\n> ')}`);
      L.push('</details>');
      L.push('');
    }

    for (const s of (turn.texts || [])) {
      L.push(`> 💬 **Agent:** ${block(s).split('\n').join('\n> ')}`);
      L.push(`> — \`${formatFullTime(s.ts)}\` (ts: \`${s.ts}\`)`);
      L.push('');
    }

    for (const a of turn.actions) {
      const what = a.kind === 'tool' ? `${a.what.tool} ${a.what.path || ''}`.trim() : a.what.command;
      const actionTime = formatFullTime(a.ts);
      const icon = a.kind === 'tool' ? '🛠️' : '💻';
      
      L.push(`* ${icon} **${a.kind}:** \`${what}\``);
      L.push(`  * ⏱️ **Time:** \`${actionTime}\` (ts: \`${a.ts}\`)`);
      if (a.why) {
        L.push(`  * 🎯 **Why:** ${a.why}`);
      }
      if (a.output) {
        const outTime = formatFullTime(a.output.ts);
        const delta = ((a.output.ts - a.ts) / 1000).toFixed(2);
        const errAlert = a.output.isError ? ' · ⚠️ **Error Detected!**' : '';
        L.push(`  * 📥 **Output:** \`${outTime}\` (ts: \`${a.output.ts}\`) | delta: \`+${delta}s\`${errAlert}`);
        
        const outputText = block(a.output);
        if (outputText && outputText !== '_none_') {
          const lines = outputText.split('\n');
          const openAttr = a.output.isError ? ' open' : '';
          L.push(`    <details${openAttr}>`);
          L.push(`    <summary>📄 <i>Click to view output details (${lines.length} lines)</i></summary>`);
          L.push('');
          L.push(`    > ` + lines.join('\n    > '));
          L.push('    </details>');
        }
      }
    }

    if (turn.taskProgress && turn.taskProgress.items.length) {
      L.push('  * 📋 **Progress:**');
      for (const it of turn.taskProgress.items) {
        L.push(`    - [${it.done ? 'x' : ' '}] ${it.text}`);
      }
    }
    if (turn.checkpoint) {
      L.push(`  * 💾 **checkpoint:** \`${turn.checkpoint.hash}\``);
    }
    L.push('');
  }

  L.push('---');
  L.push(`👉 *View the full report at [flow_report.md](${flowReportLink}).*`);
  L.push('');
  return L.join('\n');
}
