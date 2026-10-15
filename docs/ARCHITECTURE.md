# Kiến trúc — Phase 0

Nguồn yêu cầu: [PLAN.md](D:/LocalProject/ChromeExtension/DownloadRouter/PLAN.md), [workingphase.md](D:/LocalProject/ChromeExtension/DownloadRouter/workingphase.md).

## Luồng đang có

```text
onDeterminingFilename (listener đồng bộ ở module top level)
  → đọc config mới từ storage.local
  → kiểm tra envelope/version và lọc rule domain hợp lệ
  → xét original/final URL theo setting
  → chọn priority cao nhất, hòa giữ rule đứng trước
  → lấy basename Chrome cung cấp, validate destination + toàn relative path
  → suggest({ filename, conflictAction })

disabled / no match / invalid / exception / watchdog
  → suggest() không đối số
```

Callback trả true đồng bộ. Mỗi invocation có completion guard và watchdog 1.000 ms riêng; promise hoàn tất muộn không route lại. Log lỗi dùng thông báo cố định, không log URL hoặc error object có dữ liệu tải xuống.

Config dùng model canonical với configVersion: 1 ở root, lưu dưới key config. onInstalled chỉ khởi tạo khi reason là install và key chưa tồn tại. Load rule lỗi chỉ bỏ qua trong memory, không xóa dữ liệu đã lưu. Worker khởi động lại không reset cấu hình. Writer tuần tự phục vụ UI sẽ được thực hiện ở Phase 2.

Module core không gọi Chrome/DOM. API Chrome tập trung trong background và repository. Vite có root src, output dist; background.js ổn định để manifest tham chiếu; options/popup HTML có script local. CSP chỉ cho script-src self và object-src none. Hai quyền duy nhất là downloads, storage.

## Quyết định engine regex

Chọn **re2js 2.8.6**, MIT, dependency runtime duy nhất. Package là JavaScript thuần, không native binary/WASM, không yêu cầu tải executable code từ mạng hay thêm CSP unsafe-eval. Giữ bản license trong artifact.

- compileRegex dùng RE2JS.compile; không chuyển pattern người dùng sang native RegExp và không có fallback native.
- matchesRegex dùng matcher.find để giữ semantics tìm kiếm substring khi pattern không tự anchor.
- Cú pháp theo RE2JS với flags mặc định; lookahead/lookbehind và backreference trong corpus thử bị từ chối. Không bật LOOKBEHINDS hoặc cung cấp tham số flags.
- Pattern có 1–256 UTF-16 code units (String.length); input tối đa 8.192 code units. Input dài hơn trả false cho lần kiểm tra đó; core Phase 1 sẽ tiếp tục xét candidate/rule khác và cung cấp lý do cho tester.
- Các RegExp literal trong path validation là pattern cố định do dự án viết, không phải thực thi pattern người dùng.

regex.js là entry build dùng để kiểm chứng helper thực tế trong trang extension MV3 bằng dynamic import local. Handler Phase 0 vẫn chỉ route domain; Phase 1 sẽ dùng lại helper này trong rule engine. Không thêm test hook vào background hoặc tính năng regex vào UI để vượt trước phase.

Bằng chứng hiện tại: unit kiểm tra syntax và biên; production regex.js chạy trong trang MV3 thật, CSP script-src self. Nested quantifier ^(a+)+$ với input không khớp dài 129/1.025/8.192 code units hoàn tất; ghi thời gian từng trường hợp trong evidence E2E. Đây là phép thử khả thi, không phải chứng minh mọi workload hay benchmark 200 rule của Phase 5.

## Quyết định kiểm thử browser

Dùng Playwright với persistent context riêng và Chromium headless. Tạo Preferences cho Downloads nằm trong workspace. Sau khi khởi tạo context, chuyển Browser.setDownloadBehavior về default: chế độ automation allow/allowAndName bỏ qua hook đặt tên của extension trên môi trường đã thử.

Cold worker được stop bằng ServiceWorker.stopWorker, quan sát runningStatus stopped rồi mới bấm tải. Một marker trong JS global do bài test đặt trước đó phải biến mất sau restart. Không dựa vào targetId phải đổi, vì Chromium đã tái sử dụng targetId trong thực nghiệm. Không mở cửa sổ worker DevTools. File đúng thư mục và download history complete xác nhận đường đi thực tế; không dùng download.saveAs để tự di chuyển file rồi coi là extension route thành công.

## Giới hạn có chủ đích

- Chỉ domain rule không filter được thực thi; matcher khác/filter khác được bỏ qua mà không mutate storage. Validator schema đầy đủ và toàn bộ matching thuộc Phase 1.
- Options/popup là skeleton; chưa có editor, toggle UI, import/export, activity log hoặc cache.
- Chưa kiểm tra natural idle shutdown, Save As, extension conflict hay các trường hợp release của Phase 5–7. Cold worker hiện được stop chủ động qua CDP.
- Chrome/Chromium có quyền quyết định cuối cùng về filename/destination; routing là gợi ý tương đối dưới Downloads.

## Nguồn tham khảo đã dùng

- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads#event-onDeterminingFilename)
- [RE2JS: tài liệu của tác giả](https://github.com/le0pard/re2js#readme)
- [Playwright: Chrome extensions](https://playwright.dev/docs/chrome-extensions)
- [Playwright issue về download behavior và hook filename](https://github.com/microsoft/playwright/issues/19885)
- [pnpm: verifyDepsBeforeRun](https://pnpm.io/settings/build#verifydepsbeforerun)
