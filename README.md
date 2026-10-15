# Download Router

Chrome extension local-first để gợi ý thư mục con cho file tải xuống. **Hiện đã triển khai nền tảng Phase 0, chưa phải bản v1 hoàn chỉnh.**

Phase 0 chỉ route domain chính xác, không có filter extension/MIME. Lần cài mới tạo một rule mẫu:

```text
127.0.0.1 → <Chrome Downloads>/DownloadRouterTest/Local/
```

Các download không khớp, routing bị tắt hoặc extension gặp lỗi đi theo hành vi mặc định của Chrome. Đích đến luôn nằm dưới thư mục Downloads do Chrome cấu hình. Options/popup hiện là trang tối thiểu; CRUD và toggle qua UI sẽ được thực hiện ở các phase sau.

## Yêu cầu

- Node.js 24.x; môi trường đã kiểm chứng: 24.18.0.
- pnpm 12.3.4, được chốt trong package.json.
- Chrome/Chromium 120 trở lên; E2E Phase 0 đã chạy trên Chromium 149.0.7827.55, Windows, headless.

## Cài dependency và build

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Dependency store nằm trong .pnpm-store và không được commit. pnpm run sẽ báo lỗi nếu dependency không đồng bộ thay vì tự chạy install song song; khi thay package.json, chạy lại pnpm install trước.

## Load extension

1. Mở một profile Chrome dùng để thử nghiệm.
2. Vào chrome://extensions, bật Developer mode.
3. Chọn **Load unpacked** và chọn thư mục dist của dự án.
4. Mở Details → Extension options hoặc bấm icon extension → Mở cài đặt.

Để phát triển, chạy pnpm dev. Sau khi build thay đổi, bấm Reload extension trong chrome://extensions và tải lại options/popup. Dùng build --watch cho extension; không dùng Vite HMR/dev server làm runtime của extension.

## Thử tải bằng trình duyệt

```powershell
pnpm test:fixtures
```

Mở [HTTP fixture cục bộ](http://127.0.0.1:8173/) trong profile thử đã load extension. Bấm Direct attachment; sample.txt phải nằm trong Downloads/DownloadRouterTest/Local. Bấm Content-Disposition PDF để xác nhận Chrome giữ tên report.pdf dù URL không có tên file. Fixture PDF chỉ là payload thử, không phải tài liệu người dùng. Ctrl+C để dừng server.

Mở cùng trang bằng hostname localhost để thử no-match: rule mẫu là 127.0.0.1, không phải localhost. Tránh kiểm thử với tài liệu thật; không có rule overwrite mặc định.

## Kiểm thử tự động

```powershell
pnpm test
pnpm test:coverage
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Lệnh cài Chromium là bước chuẩn bị nếu máy chưa có browser phù hợp với Playwright. Có thể dùng binary Chromium thử nghiệm đã có bằng cách đặt biến môi trường của riêng phiên shell:

```powershell
$env:CHROMIUM_EXECUTABLE = 'C:\path\to\chromium\chrome.exe'
pnpm test:e2e
```

E2E tạo profile mới và thư mục Downloads trong .test-artifacts cho mỗi lượt chạy. Nó kiểm tra file trên đĩa, trạng thái complete trong Chrome download history, worker bị stop rồi được download đánh thức, và RE2JS trong MV3/CSP. Không dùng profile Chrome cá nhân hoặc ghi vào Downloads cá nhân. Lưu evidence theo đường dẫn được in sau mỗi lượt chạy; profile/file thử không được commit.

Unit suite có fixture HTTP cục bộ nên môi trường sandbox phải cho phép kết nối loopback. Xem [biên bản Phase 0](D:/LocalProject/ChromeExtension/DownloadRouter/docs/TESTING.md) để biết chính xác phần nào đã chạy thật.

## Phạm vi tiếp theo

Xem [kế hoạch](D:/LocalProject/ChromeExtension/DownloadRouter/PLAN.md) và [working phases](D:/LocalProject/ChromeExtension/DownloadRouter/workingphase.md). Phase 1 bổ sung toàn bộ matcher/filter/validator; Phase 2 hoàn thiện serialized mutations; Phase 3–4 bổ sung UI; import/export ở Phase 6. Phase 0 bỏ qua các rule dùng matcher/filter chưa hỗ trợ và không ghi lại cấu hình để loại chúng.

Extension chỉ có quyền downloads và storage, không backend/telemetry. RE2JS 2.8.6 (MIT) được bundle cục bộ; thông báo license nằm trong public/RE2JS-LICENSE.txt và được copy vào dist khi build.
