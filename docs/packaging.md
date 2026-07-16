# Đóng gói & chia sẻ (Packaging & Distribution)

Cách phân phối Cline Agent Loop Analyzer cho máy khác **mà không cần đưa full
source code**: mỗi lần build tạo ra **một file cài đặt duy nhất**
(`dist/cline-agent-installer.mjs`) chứa toàn bộ app đã bundle/minify kèm skill
`cline-agent`. Người nhận chỉ cần Node.js v18+ và file đó.

## Quy trình cho người phát hành (máy dev — repo này)

```bash
npm install        # lần đầu, để có esbuild
npm run package
```

Kết quả trong `dist/` (đã gitignore):

| Đường dẫn | Nội dung |
|---|---|
| `dist/cline-agent-installer.mjs` | **File duy nhất cần share.** Self-extracting installer, nhúng sẵn toàn bộ app + skill (base64). |
| `dist/app/` | Bản app đã bundle để kiểm tra: `parser.js`, `clean.js`, `serve.mjs` (mỗi file đã gộp cả `src/` và minify), `web/`, `docs/`, `package.json`. |
| `dist/skill/cline-agent/SKILL.md` | Skill bản phân phối (nguồn gốc: `.claude/skills/cline-agent/SKILL.md` được tự động điều chỉnh đường dẫn). |

**Khi sửa mã nguồn** (`src/`, `parser.js`, `web/`, …): chỉ cần chạy lại
`npm run package` rồi gửi lại file `cline-agent-installer.mjs` mới. Người nhận
chạy lại installer là skill + app được thay thế tại chỗ (upgrade in-place,
version ghi trong `version.json`).

Nếu muốn đổi nội dung skill bản phân phối, sửa trực tiếp file nguồn [.claude/skills/cline-agent/SKILL.md](file:///e:/the.thoi/Project/cline-agent/cline-agent/.claude/skills/cline-agent/SKILL.md). Quá trình đóng gói sẽ tự động tối ưu hóa file này thành bản phân phối.

## Quy trình cho người nhận (máy khác)

```bash
node cline-agent-installer.mjs
```

Installer sẽ:

1. Cài đặt toàn bộ skill và các file script thực thi đi kèm vào thư mục skill `.agents/skills/cline-agent/` (Windows: `%USERPROFILE%\.agents\skills\cline-agent` hoặc ở thư mục dự án nếu dùng `--project`). Không có thư mục app riêng biệt, toàn bộ ứng dụng chạy trực tiếp bên trong thư mục skill (ở thư mục con `scripts/`).

Tùy chọn:

| Cờ | Ý nghĩa |
|---|---|
| `--project <dir>` | Cài skill vào `<dir>/.agents/skills/cline-agent` (theo project) thay vì global. |
| `--force` | Cho phép ghi đè thư mục skill cũ không do installer tạo ra. |

Sau khi cài, người dùng chỉ cần nói với agent (Cline) những câu
như "analyze this cline log" hay "open the cline dashboard" — skill
`cline-agent` sẽ tự điều khiển app đã cài (parse → serve → mở
http://localhost:8099/). Không cần thao tác trực tiếp với các file script.

## Nâng cấp

Gửi file installer mới → người nhận chạy lại `node cline-agent-installer.mjs`.
Installer nhận diện bản cài cũ qua `version.json` và thay thế sạch (an toàn:
từ chối ghi đè thư mục lạ nếu thiếu `--force`).
Log đã parse không bị đụng tới khi nâng cấp.

## Ghi chú kỹ thuật

- Build script: `scripts/build-installer.mjs` (esbuild bundle + minify, ESM,
  target node18).
- Installer template: `packaging/installer-template.mjs` — placeholder
  `__BUILD_INFO__` / `__MANIFEST_JSON__` được thay khi build.
- Bundle không có dependency runtime nào — chỉ cần Node.js chuẩn.
- Log đã parse và output sinh ra có thể chứa nội dung nhạy cảm; installer
  không đụng tới chúng, và `clean.js` chỉ xóa output sinh ra.
