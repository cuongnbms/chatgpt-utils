# ChatGPT → Obsidian Markdown Exporter

Chrome extension (MV3) xuất **một response** của ChatGPT ra Markdown chuẩn cho Obsidian, giữ nguyên:

- in đậm / in nghiêng / gạch ngang / inline code / link (bỏ `utm_source=chatgpt.com`)
- heading, list lồng nhau, task list (`- [x]`), blockquote, bảng (kèm căn lề), đường kẻ
- code block (đúng ngôn ngữ, lấy code gốc)
- công thức toán KaTeX → `$…$` / `$$…$$`
- **ảnh** web search (`images.openai.com`) → file ảnh gốc; ảnh upload/generate: chưa kiểm chứng host (xem phần Bảo mật)
- **diagram / chart / mermaid / card** do ChatGPT vẽ → ảnh PNG (2x)

## Vì sao nút Copy của ChatGPT bị mất format

ChatGPT (2026) render câu trả lời bằng renderer mới ("DIL"): chữ đậm là `<span data-d-default-strong>`, in nghiêng là `data-d-font-style="italic"`, gạch ngang là `data-d-text-decoration="line-through"`… thay vì `<strong>/<em>/<del>`. Diagram là các khối layout (div + mũi tên SVG), chart là SVG inline, mermaid chỉ còn SVG đã render. Extension này đọc trực tiếp các thuộc tính đó.

## Cài đặt

1. `chrome://extensions` → bật **Developer mode**
2. **Load unpacked** → chọn thư mục này
3. Reload tab ChatGPT

## Sử dụng

Dưới mỗi response có thêm nút **⤓** ở cuối thanh action (cạnh Copy, Like…):

| Lựa chọn | Kết quả |
| --- | --- |
| **Copy Markdown** | Markdown vào clipboard, ảnh/diagram nhúng dạng `data:image/png;base64` (tự chứa, note nặng; việc Obsidian hiển thị ảnh base64 chưa được kiểm chứng) |
| **Tải .zip cho Obsidian** | `<Tiêu đề>.zip` gồm `<Tiêu đề>.md` (có frontmatter `source`, `exported`, `tags`) + `attachments/*.png` — giải nén thẳng vào vault |

Khuyến nghị dùng **.zip** cho note có ảnh/diagram. Giải nén bằng Finder (hoặc `ditto -x -k`); `unzip` CLI có sẵn của macOS không đọc cờ UTF-8 nên có thể làm hỏng tên file tiếng Việt.

## Bảo mật

- Chỉ đọc DOM đang hiển thị. **Không** gọi `/api/auth/session`, **không** dùng access token, **không** gọi `/backend-api`.
- Không gửi dữ liệu đi đâu. Network duy nhất: tải ảnh từ `images.openai.com` (ảnh web search, bị CORS chặn trong trang) qua service worker, không kèm cookie. Ảnh cùng origin `chatgpt.com` được tải trực tiếp trong trang.
- Quyền: `clipboardWrite`, host `images.openai.com`. Content script chỉ chạy trên `chatgpt.com` / `chat.openai.com`.
- Ảnh từ host khác không nằm trong danh sách → giữ link gốc (có cảnh báo). Muốn thêm host: sửa `host_permissions` trong `manifest.json` và `ALLOWED_HOSTS` trong `src/background.js`.

## Cấu trúc

```
manifest.json
src/converter.js   DOM → Markdown (chạy được cả trong jsdom)
src/rasterize.js   element → PNG qua SVG foreignObject (không thư viện ngoài)
src/zip.js         ZIP writer tối giản (STORE, tên file UTF-8)
src/content.js     chèn nút, menu, clipboard, tải zip
src/background.js  tải ảnh cross-origin cho host được phép
test/              node:test + jsdom, fixture mô phỏng DOM thật
```

## Test

```bash
npm install
npm test
```

## Giới hạn đã biết

- Mermaid: DOM không chứa source mermaid, chỉ có SVG đã render → xuất PNG, không phải code ```` ```mermaid ````.
- Citation badge (ví dụ "MDN") không có URL trong DOM → xuất thành `(MDN)`.
- Selector phụ thuộc DOM của ChatGPT; khi OpenAI đổi giao diện có thể cần cập nhật `src/converter.js`.
- Chỉ export từng response (không export cả hội thoại).
