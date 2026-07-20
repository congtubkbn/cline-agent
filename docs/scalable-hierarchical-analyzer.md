# 📐 Scalable 3-Layer Hierarchical Analyzer & Vietnamese Reporting Engine

Document này hướng dẫn chi tiết về Kiến trúc Phân tích Phân cấp 3 Tầng (3-Layer Scalable Architecture) và Bộ sinh Báo cáo Tiếng Việt được thiết kế để phân tích các log chạy Agent quy mô lớn (**200+ Turns**, **>1M Tokens**).

---

## 🎯 1. Đặt Vấn Đề (Problem Statement)

Khi phân tích log thực thi của AI Agent (Cline, AutoGPT, ReAct Agents):
1. **Lệch pha Input/Output**: Tool output (`command_output`) bị gán vào cuối Turn $N$, trong khi bản chất nó là Observation Input của Turn $N+1$.
2. **Thiếu Phân cấp Micro vs Macro**: Không phân biệt được đâu là lượt Người dùng tương tác (`isUserInitiated: true`) và đâu là chuỗi Agent tự động lặp (`isUserInitiated: false`).
3. **Quá tải Context Window khi Log lớn**: Khi log chứa 100-200 turns (>2.6MB JSON), ném log thô cho LLM đọc sẽ tốn hàng triệu token, chi phí đắt đỏ và dễ bị trôi thông tin.

---

## 🏗️ 2. Kiến Trúc Giải Pháp 3 Tầng (3-Layer Architecture)

```
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 1: Deterministic Event Stream Parser (Node.js - 0 Token)          │
│  - Tải & lọc partial events từ ui_messages.json & conversation history  │
│  - Phân định ranh giới Input/Reasoning/Action/Feedback                │
│  - Bóc tách văn bản/DOM >200 tokens lưu riêng vào sidecar/.txt        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 2: Algorithmic Phase Aggregation (src/phases.js - 0 Token)       │
│  - Phân loại Tool Family (Initialization, Exploration, Execution...)   │
│  - Tự động gom 200+ Micro Turns thành 5-8 Giai đoạn (Phases) chính    │
│  - Phát hiện điểm bất thường / lỗi (Anomaly Detection)                 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 3: Hierarchical Narrative & Executive UI (Web & Markdown)         │
│  - Xuất file báo cáo phân cấp Tiếng Việt: <taskId>_bao_cao_chi_tiet.md │
│  - Web UI Dashboard SPA (http://localhost:8099/) với Tab Báo cáo TV    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ 3. Chi Tiết Các File Trong System Codebase

### A. Module Phân loại & Gom nhóm Phase (`src/phases.js`)
* **Chức năng**: Tự động nhóm các Micro Turns dựa theo họ Tool (`useSkill`, `list_dir`, `grep_search`, `replace_file_content`, `agent-browser`, `render`, `pdf`).
* **Đầu ra**:
  * `macroTurns`: Danh sách các đợt tương tác của Người dùng (User Sessions).
  * `phases`: Danh sách các Giai đoạn thực thi chính kèm thời gian, phạm vi turn và danh sách lỗi.

### B. Module Diễn giải Báo cáo Tiếng Việt (`src/render-vi-report.js`)
* **Chức năng**: Dịch các câu lệnh CLI/Script thành câu diễn giải **Hành động & Mục đích thực tế** bằng Tiếng Việt cho từng Turn.
* **Tự động xuất file**:
  * `<taskDir>/<taskId>_bao_cao_chi_tiet.md`
  * `web/tasks/<taskId>/bao_cao_chi_tiet.md`

### C. Giao diện Dashboard Web UI (`web/app.js` & `web/style.css`)
* **Tab Báo cáo Tiếng Việt (`#tab-vireport`)**:
  * Render Markdown Tables thành bảng HTML bo góc mượt mà, phân màu dòng và hiệu ứng hover.
  * Tự động biến trạng thái lỗi thành viên Pill `vi-badge-success` (`✅ Thành công`) và `vi-badge-error` (`❌ Có lỗi`).

---

## 📊 4. Kết Quả Kiểm Thử Quy Mô (Scale Benchmarks)

| Task ID | Quy mô Log | Thời gian Chạy Agent | Thời gian Parse | Tỷ lệ Tiết kiệm Token |
| :--- | :--- | :--- | :--- | :--- |
| **1784582123130** | 37 Turns · 289 Events | 418 giây (~7 phút) | **190 ms** | **> 98%** |
| **1783615946293** | 170 Turns · 1,105 Events | 2,087 giây (~35 phút) | **190 ms** | **> 99%** (Nén 503K tok thô $\rightarrow$ 4K tok báo cáo) |

---

## 🚀 5. Hướng Dẫn Sử Dụng & Lệnh Chạy (Usage Guide)

### Chạy Parser cho 1 Task bất kỳ:
```bash
node parser.js "<đường_dẫn_thư_mục_task>"
```

### Chạy Parser ở Chế độ Lắng nghe Tự động (Watch Mode):
```bash
node parser.js "<đường_dẫn_thư_mục_task>" --watch
```

### Xem Dashboard Trực quan:
1. Mở Web Server: `node serve.mjs`
2. Mở trình duyệt: `http://localhost:8099/`
3. Chuyển sang Tab **"Báo cáo Tiếng Việt"** để xem báo cáo phân cấp sắc nét!
