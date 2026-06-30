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

  L.push(`# 📊 Báo Cáo Phân Tích Lượt Hoạt Động (Flow Report) — Task: ${flow.taskId}`);
  L.push('');
  L.push('## 1. 📈 Thông Số Tổng Quan (Metadata & Totals)');
  L.push('');
  L.push('| 🏷️ Chỉ số (Metric) | 📝 Chi tiết (Value) |');
  L.push('| :--- | :--- |');
  L.push(`| **Tác vụ (Prompt)** | \`${flow.prompt.replace(/\r?\n/g, ' ')}\` |`);
  if (flow.model) {
    L.push(`| **Mô hình AI (Model)** | \`${flow.model.modelId}\` (${flow.model.mode}) |`);
  }
  L.push(`| **Thời gian thực hiện** | \`${formatDateTime(startTs)}\` ── \`${formatDateTime(endTs)}\` (Tổng: **${Math.round(t.durationMs/1000)} giây**) |`);
  L.push(`| **Tài nguyên tiêu thụ** | **${t.turns} turns** · **${t.events} events** |`);
  L.push(`| **Token sử dụng** | Input: \`${t.tokensIn.toLocaleString()}\` · Output: \`${t.tokensOut.toLocaleString()}\` |`);
  L.push(`| **Đọc/Ghi Cache** | Đọc: \`${t.cacheReads.toLocaleString()}\` · Ghi: \`${t.cacheWrites.toLocaleString()}\` |`);
  L.push(`| **Chi phí (Cost)** | \`$${t.cost.toFixed(4)}\` |`);
  L.push('');
  L.push('## 2. 🗺️ Sơ Đồ Tiến Trình (Flow Diagram)');
  L.push('```mermaid');
  L.push(flow.mermaid);
  L.push('```');
  L.push('');
  L.push('## 3. 🔍 Chi Tiết Từng Lượt Hoạt Động (Execution Turns)');
  L.push('');

  for (const turn of flow.turns) {
    const startStr = formatFullTime(turn.tsStart);
    const endStr = formatFullTime(turn.tsEnd);
    L.push(`### 🔄 Turn ${turn.index}  ·  \`[${startStr} - ${endStr} | ts: ${turn.tsStart}]\`  ·  \`+${Math.round(turn.durationMs/1000)}s\`  ·  \`${turn.request.tokensIn}→${turn.request.tokensOut}\` tok`);
    
    if (turn.reasoning) {
      L.push('<details>');
      L.push('<summary>🧠 <b>Reasoning (Suy nghĩ của AI)</b></summary>');
      L.push('');
      L.push(`> ${block(turn.reasoning).split('\n').join('\n> ')}`);
      L.push('</details>');
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
        L.push(`  * 📥 **Output:** \`${outTime}\` (ts: \`${a.output.ts}\`) | delta: \`+${delta}s\``);
        
        const outputText = block(a.output);
        if (outputText && outputText !== '_none_') {
          const lines = outputText.split('\n');
          L.push('    <details>');
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
  L.push('## 4. 🏁 Kết quả hoàn thành (Completion)');
  L.push(block(flow.completion));
  L.push('');
  return L.join('\n');
}
