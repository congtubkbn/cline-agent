# Quy trình hoạt động: Harness ↔ Agent ↔ Model

Tài liệu logic-level, không phụ thuộc vào 1 run cụ thể. Mọi ví dụ (case Qualcomm, file
`cline-log/1783615946293/ui_messages.json`) chỉ để minh họa — quy trình dưới đây đúng cho
mọi run của Cline.

> **Sơ đồ trực quan:** [`docs/diagrams/harness-model-loop.html`](diagrams/harness-model-loop.html)
> (bản đã publish: https://claude.ai/code/artifact/9a3976de-aadd-46e8-b7f9-f551471866d4 — private,
> cần đăng nhập đúng tài khoản; bản trong repo tự chạy được không phụ thuộc link này).

---

## 1. Ba tác nhân (actor) và ranh giới trách nhiệm

Điểm mấu chốt: **model không có tay chân**. Nó chỉ nhận text và trả text. Mọi hành động
thật (đọc/ghi file, chạy shell, gọi browser, ghi log) đều do **harness** làm.

| Actor | Là gì | Làm được gì | KHÔNG làm được |
|-------|-------|-------------|----------------|
| **Model** (LLM) | Bộ não thuần text, stateless | Suy luận, chọn tool + sinh arguments, viết text cho user | Đọc/ghi disk, chạy lệnh, gọi API, ghi log. Không "nhớ" gì giữa các lượt. |
| **Harness** (Cline) | Vòng lặp điều phối chạy trên máy | Gói request, gọi API model, thực thi tool, snapshot, gate side-effect, **ghi mọi event ra log** | Không tự "suy nghĩ" — chỉ thực thi theo output model |
| **User** | Người dùng | Ra task ban đầu, duyệt/từ chối các `ask` | — |

> **"Agent" = Harness + Model ghép lại.** Không có thực thể "agent" riêng. Khi nói "agent làm X"
> nghĩa là: model quyết định X → harness thực thi X.

### Nguyên tắc vàng để đọc log
- **Ai AUTHOR nội dung** (model hay user) ≠ **ai GHI event** (luôn là harness).
- Model chỉ là *nguồn nội dung* cho một số event; harness là *người viết sổ* cho TẤT CẢ event.

---

## 2. Vòng lặp 1 lượt (turn loop)

Một "turn" = một lần gọi API tới model. Mỗi turn chạy đúng chuỗi sau:

```
[USER]     ①  task đến (chỉ ở turn đầu)
              │
[HARNESS]  ②  checkpoint: snapshot trạng thái để rollback
              │
[HARNESS]  ③  PACK CONTEXT → gọi model API
              │  gom: task + lịch sử hội thoại + tool results trước đó
              │       + <environment_details> (file mở, CWD, cây file, context-window %, mode)
              │       + các nudge (vd: gợi ý tạo todo list)
              │  → bắn request tới model, CHỜ
              │
[MODEL]    ④  suy luận → trả về: reasoning + text + (tùy chọn) 1 tool call
              │  model KHÔNG chạy gì — chỉ nói "tôi muốn gọi tool T với args A"
              │
[HARNESS]  ⑤  thực thi tool T(A) trên máy thật
              │  nếu tool có side-effect (ghi file, chạy shell) → có thể GATE:
              │  dừng lại, hỏi user duyệt (một `ask` event)
              │  → thu kết quả (stdout/stderr/return value)
              │
              └─→ ↺ kết quả tool trở thành INPUT của turn kế tiếp
                     quay lại ③, conversationHistoryIndex++
```

Vòng lặp dừng khi model gọi tool kết thúc (vd `attempt_completion`) hoặc user ngắt.

### Vì sao context phình mỗi turn
Model stateless → mỗi turn harness phải **gói lại toàn bộ** lịch sử + kết quả tool mới vào
request. Càng nhiều turn, context càng to → token cost tăng, file log phình. Đây là lý do
1 file `ui_messages.json` có thể lên vài trăm KB đến vài MB.

---

## 3. Cách log được lưu (`ui_messages.json`)

### 3.1 Cấu trúc
- **Một mảng JSON phẳng**, mỗi phần tử = 1 event.
- Thứ tự = thứ tự thời gian, key sắp xếp duy nhất là `ts` (epoch milliseconds).
- **Index của mảng = thứ tự event, KHÔNG phải thứ tự turn.** Một turn sinh ra nhiều event.

### 3.2 Các field cốt lõi trên mỗi event

| Field | Ý nghĩa |
|-------|---------|
| `ts` | Epoch ms. Đồng hồ + key sắp xếp. |
| `type` | `"say"` = phát 1 chiều · `"ask"` = harness dừng, chờ user/UI |
| `say` / `ask` | Subtype — quyết định actor & ý nghĩa (bảng 3.3) |
| `text` | Payload chính (chuỗi, có thể là JSON string lồng nhau) |
| `partial` | `true` = đang stream, chưa chốt · `false` = đã hoàn tất |
| `modelInfo` | `{providerId, modelId, mode}` — model NÀO chạy, KHÔNG phải "ai làm". Stamp trên mọi event. |
| `conversationHistoryIndex` | Turn nào sở hữu event này. Nhiều event chung 1 index. |

### 3.3 Bảng decode actor từ subtype (không có field "author" — phải suy)

| type | subtype | Actor / ý nghĩa |
|------|---------|-----------------|
| say | `task` | **USER** — prompt gốc |
| say | `reasoning` | **MODEL** author — chain-of-thought |
| say | `text` | **MODEL** author — nói với user |
| say | `tool` | **MODEL** author — quyết định gọi tool + args (CHƯA chạy) |
| say | `command` | **MODEL** author — đề xuất lệnh shell (CHƯA chạy) |
| say | `api_req_started` | **HARNESS** action — gói request + gọi model API |
| say | `checkpoint_created` | **HARNESS** action — snapshot rollback (`lastCheckpointHash`) |
| ask | `command_output` | **HARNESS** action — đã chạy lệnh, trả stdout (chờ duyệt/hiển thị) |
| ask | `tool` / `followup` | **HARNESS** hỏi → chờ **USER** duyệt |

Quy tắc gọn:
- `say` + reasoning/text/tool/command → **model author**, harness ghi.
- `say` + api_req_started/checkpoint → **harness action**.
- Bất kỳ `ask` → **harness dừng, chờ user**. = ranh giới side-effect.

### 3.4 Cạm bẫy: KHÔNG phải append-only thuần

Đa số event append 1 lần rồi bất biến. NGOẠI LỆ quan trọng:

- **`api_req_started` bị PATCH tại chỗ (in-place).**
  - Lúc gửi request: event chỉ có `request` + `tokensIn`.
  - Khi model trả xong: harness **vá lại chính object đó**, thêm `tokensOut / cacheReads /
    cacheWrites / cost`.
  - → File bạn đọc là **trạng thái CUỐI** (sau patch). Đừng tưởng `tokensOut` biết trước lúc gửi.
- **Streaming text/reasoning** cũng được update dần: `partial: true` khi đang chảy, chốt
  `partial: false` khi xong.

Hệ quả khi debug: nếu bắt log lúc đang chạy live, cùng 1 `ts`/index có thể khác nội dung
so với lúc chạy xong. Chỉ tin số liệu ở event có `partial: false`.

### 3.5 `text` thường là JSON lồng chuỗi
Field `text` của `api_req_started` và `command_output` hay là 1 **JSON được stringify**
(escape `\"`, `\n`...). Muốn đọc phải parse 2 lớp: parse event → lấy `text` → parse `text`.

---

## 4. Quy trình debug 1 file log

Mục tiêu debug: tái dựng "agent đã nghĩ gì → làm gì → nhận lại gì" theo từng turn.

### Bước 1 — Xác định ranh giới turn
Group event theo `conversationHistoryIndex`. Mỗi nhóm = 1 turn. Đây là đơn vị suy luận,
không phải từng event lẻ.

### Bước 2 — Với mỗi turn, đọc theo thứ tự nhân-quả
```
api_req_started   → context gì được nhồi vào (parse text → xem request + <environment_details>)
reasoning         → model nghĩ gì
text              → model nói gì với user
tool / command    → model QUYẾT ĐỊNH làm gì (chưa chạy)
ask:*             → harness thực thi + kết quả trả về (input cho turn sau)
```

### Bước 3 — Soi token/cost để tìm chỗ phình context
Trong mỗi `api_req_started.text`, đọc `tokensIn / tokensOut / cacheReads / cost`.
- `tokensIn` tăng đột biến ở 1 turn → cái gì vừa được nhồi vào (skill doc? file lớn? tool
  output khổng lồ?). Đây là nơi tối ưu context.
- `cacheReads` cao = phần prefix được tái dùng (rẻ). Thấp = cache miss (đắt).

### Bước 4 — Truy cặp "muốn làm" ↔ "đã làm"
Mỗi `say:tool`/`say:command` (model muốn) phải có event thực thi tương ứng ngay sau
(thường là `ask:command_output` hoặc kết quả nhồi vào `api_req_started` turn kế). Nếu
thiếu → đó là chỗ agent bị treo/lỗi.

### Bước 5 — Phát hiện lỗi thường gặp
| Triệu chứng trong log | Nguyên nhân |
|-----------------------|-------------|
| Nhiều `api_req_started` liên tiếp cùng nội dung tool | Model lặp — gọi lại tool y hệt (loop) |
| `tokensIn` chạm trần context window | Context tràn — cần cắt lịch sử/tool output |
| `ask:*` nhưng không có event tiếp theo | User từ chối hoặc run bị ngắt tại gate |
| Tool result là error string nhồi vào turn sau | Tool fail — đọc stderr trong `text` |
| Event `partial: true` không bao giờ chốt `false` | Stream bị đứt giữa chừng |

### Bước 6 — Công cụ
- Repo này có analyzer: `parser.js` → `analysis.json`/`flow_data.json`, dashboard tại
  `http://localhost:8099/`. Dùng skill `cline-agent` để chạy parse→serve→open thay vì gọi
  node tay. Xem `docs/walkthrough.md` và `docs/analysis-schema.md`.
- Đọc thô: parse mảng, filter theo `conversationHistoryIndex`, parse 2 lớp field `text`.

---

## 5. Tóm tắt 1 dòng

> Model = não text stateless (author nội dung). Harness = tay chân + thư ký (thực thi mọi
> thứ, ghi mọi event). Mỗi turn: harness gói context → gọi model → model chọn tool →
> harness chạy tool → kết quả quay lại thành context turn sau. Log = mảng JSON phẳng sắp
> theo `ts`, đa số append-only trừ `api_req_started` (patch token/cost sau khi model trả
> xong). Debug = group theo `conversationHistoryIndex`, đọc nhân-quả trong từng turn, soi
> token để tìm chỗ phình/loop/fail.
