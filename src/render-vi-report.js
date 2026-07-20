/**
 * Vietnamese Hierarchical & Narrative Report Generator
 * Renders <taskId>_bao_cao_chi_tiet.md with deep turn-by-turn narrative breakdown.
 */

function formatDuration(ms) {
  if (!ms) return '0s';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

function describeTurnAction(turn) {
  const action = turn.actions?.[0];
  if (!action) {
    if (turn.reasoning?.preview) return turn.reasoning.preview;
    return 'Hoàn tất tác vụ, không có hành động tool thêm.';
  }
  
  const tool = action.what?.tool || action.kind;
  const cmd = action.what?.command || action.what?.path || '';
  const why = action.why || turn.reasoning?.preview || '';

  if (tool === 'useSkill') {
    return `Kích hoạt Skill **"${cmd}"** để nạp quy tắc thực thi quy trình chuyên biệt.`;
  }
  if (tool === 'readFile') {
    return `Đọc nội dung file \`${cmd}\` để nạp dữ liệu vào context.`;
  }
  if (tool === 'replace_file_content' || tool === 'write_to_file') {
    return `Ghi / Cập nhật nội dung dữ liệu vào file \`${cmd}\`.`;
  }
  if (cmd.includes('intake.mjs')) {
    return `Chạy script kiểm tra hợp lệ của mã Case (chỉ chấp nhận đúng 8 chữ số).`;
  }
  if (cmd.includes('scrape_case.mjs')) {
    return `Bóc tách nội dung thô thành file JSON có cấu trúc (\`case.json\`).`;
  }
  if (cmd.includes('render_case.mjs')) {
    return `Đưa dữ liệu vào template để render báo cáo dạng HTML (\`case.html\`).`;
  }
  if (cmd.includes('agent-browser skill')) {
    return `Thử nạp tài liệu hướng dẫn CLI agent-browser.`;
  }
  if (cmd.includes('agent-browser connect')) {
    return `Kết nối công cụ tự động hóa agent-browser vào trình duyệt Chrome (Port CDP 9222).`;
  }
  if (cmd.includes('agent-browser open')) {
    return `Điều hướng trình duyệt mở trang tìm kiếm / chi tiết case trên portal.`;
  }
  if (cmd.includes('agent-browser snapshot')) {
    return `Chụp cấu trúc cây DOM của trang web để phân tích các thành phần UI.`;
  }
  if (cmd.includes('agent-browser click')) {
    return `Thực hiện thao tác Click mở rộng bài viết / chuyển trang trên giao diện portal.`;
  }
  if (cmd.includes('agent-browser eval')) {
    return `Chạy đoạn mã JavaScript trong trang web để trích xuất dữ liệu bài viết / comment.`;
  }
  if (cmd.includes('agent-browser pdf')) {
    return `Xuất giao diện báo cáo HTML thành file PDF lưu trữ địa phương.`;
  }
  if (cmd.includes('agent-browser help') || cmd.includes('agent-browser --help')) {
    return `Tra cứu cú pháp lệnh hướng dẫn của công cụ CLI agent-browser.`;
  }
  if (cmd.includes('powershell')) {
    return `Chạy script PowerShell kiểm tra trạng thái tiến trình và môi trường Chrome.`;
  }
  if (cmd.includes('python -c')) {
    return `Thực thi câu lệnh Python kiểm tra sự tồn tại & dung lượng của file sản phẩm.`;
  }
  if (cmd.includes('del ') || cmd.includes('rm ')) {
    return `Dọn dẹp các file rác và dữ liệu thô trung gian (\`case.raw.json\`).`;
  }
  if (cmd.includes('for /L')) {
    return `Vòng lặp Polling kiểm tra trạng thái hoàn tất tải trang của trình duyệt.`;
  }
  if (cmd.includes('node -e')) {
    return `Chạy script Node.js kiểm tra cache địa phương hoặc thẩm định cấu trúc JSON.`;
  }

  if (why) {
    return why.length > 140 ? why.slice(0, 137) + '...' : why;
  }
  return `Thực thi hành động \`${cmd || tool}\`.`;
}

export function renderViReport(flow) {
  const { taskId, prompt, model, totals, macroTurns = [], phases = [], turns = [] } = flow;

  let md = `# 📊 Báo Cáo Phân Tích Chi Tiết Agent Loop — Task ${taskId}\n\n`;

  // 1. Chỉ số Tổng quan
  md += `## 1. 📈 Chỉ Số Tổng Quan\n\n`;
  md += `| 🏷️ Chỉ số | 📝 Giá trị |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Yêu cầu (Prompt)** | \`${prompt || 'N/A'}\` |\n`;
  md += `| **Mô hình AI** | \`${model?.modelId || 'Unknown'}\` |\n`;
  md += `| **Tổng thời gian** | **${formatDuration(totals.durationMs)}** |\n`;
  md += `| **Quy mô Thực thi** | **${macroTurns.length} Macro Turns** · **${phases.length} Phases** · **${turns.length} Micro Turns** |\n`;
  md += `| **Tổng Token** | Input: \`${(totals.tokensIn || 0).toLocaleString()}\` · Output: \`${(totals.tokensOut || 0).toLocaleString()}\` |\n`;
  md += `| **Cache Hit Rate** | Read: \`${(totals.cacheReads || 0).toLocaleString()}\` tokens |\n\n`;

  // 2. Bản đồ Giai đoạn (Phase Outline Map)
  md += `## 2. 🗺️ Bản Đồ Giai Đoạn Thực Thi (Phase Outline Map)\n\n`;
  md += `Bản đồ nén 200+ turns thành các Giai đoạn chính để xem nhanh bức tranh tổng thể:\n\n`;
  md += `| STT | Giai Đoạn (Phase) | Số Turn | Phạm vi Turn | Thời gian | Trạng thái |\n`;
  md += `| :-: | :--- | :-: | :-: | :-: | :-: |\n`;

  phases.forEach((p, i) => {
    const status = p.hasError ? '❌ Có lỗi' : '✅ Thành công';
    md += `| ${i + 1} | **${p.name}** | ${p.turnCount} turns | Turn ${p.turnRange[0]} ── ${p.turnRange[1]} | ${formatDuration(p.durationMs)} | ${status} |\n`;
  });

  md += `\n---\n\n`;

  // 3. Phân tích Chi tiết từng Turn theo Giai đoạn
  md += `## 3. 🧩 Phân Tích Chi Tiết Toàn Bộ ${turns.length} Turns Theo Giai Đoạn\n\n`;

  phases.forEach((p, pIdx) => {
    const phaseStatus = p.hasError ? '❌ Có lỗi' : '✅ Thành công';
    md += `### 🌐 GIAI ĐOẠN ${pIdx}: ${p.name} (Turns ${p.turnRange[0]} ── ${p.turnRange[1]})\n`;
    md += `* **Thời gian thực thi**: ${formatDuration(p.durationMs)} | **Trạng thái**: ${phaseStatus}\n\n`;

    const phaseTurns = turns.slice(p.turnRange[0], p.turnRange[1] + 1);
    phaseTurns.forEach(t => {
      const act = t.actions?.[0];
      const actName = act?.what?.tool || act?.kind || 'action';
      const cmdShort = act?.what?.command ? ` (${act.what.command.slice(0, 30)})` : '';
      const statusIcon = t.hasError ? '❌' : '🔹';
      const desc = describeTurnAction(t);
      const durationStr = formatDuration(t.durationMs);

      md += `* **${statusIcon} Turn ${t.index}** (\`${actName}${cmdShort}\`): ${desc} *(⏱️ ${durationStr} · ${t.request?.tokensIn || 0}→${t.request?.tokensOut || 0} tok)*\n`;
      if (t.hasError && t.errors?.length) {
        md += `  - ⚠️ **Chi tiết Lỗi**: \`${t.errors[0]?.text?.preview || t.errors[0]?.text || 'Error occurred'}\`\n`;
      }
    });

    md += `\n`;
  });

  // 4. Phân tích Điểm Nóng & Lỗi
  const errorTurns = turns.filter(t => t.hasError);
  md += `## 4. 🚨 Phân Tích Điểm Nóng & Lỗi (Anomaly & Error Highlights)\n\n`;

  if (!errorTurns.length) {
    md += `✅ **Không phát hiện lỗi rủi ro nào trong suốt quá trình chạy task.**\n\n`;
  } else {
    md += `Phát hiện **${errorTurns.length} Turn có lỗi**. Dưới đây là chi tiết trích xuất:\n\n`;
    errorTurns.forEach(et => {
      md += `### ❌ Turn ${et.index}\n`;
      md += `- **Thời điểm**: \`${new Date(et.tsStart).toLocaleTimeString()}\`\n`;
      md += `- **Hành động**: \`${et.actions?.[0]?.kind || 'Unknown'}\` - \`${et.actions?.[0]?.what?.command || et.actions?.[0]?.what?.tool || ''}\`\n`;
      if (et.errors?.length) {
        md += `- **Chi tiết lỗi**: \n`;
        et.errors.forEach(err => {
          md += `  \`\`\`\n  ${err.text?.preview || err.text || 'Error occurred'}\n  \`\`\`\n`;
        });
      }
      md += `\n`;
    });
  }

  md += `---\n\n*Báo cáo được khởi tạo tự động bởi Cline Agent Scalable Hierarchical Engine vào lúc ${new Date().toLocaleString('vi-VN')}.*\n`;

  return md;
}
