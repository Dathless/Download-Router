# Download Router

Chrome extension MV3 gợi ý thư mục lưu file theo URL, loại file và MIME. Dữ liệu xử lý cục bộ; chỉ sử dụng quyền `downloads` và `storage`, không backend hoặc telemetry.

**Phiên bản:** 1.0.0 · **Nhánh mặc định:** `dev` · **Cách cài:** Load unpacked.

## Tính năng

- Match theo domain, URL prefix, glob hoặc regex RE2JS đã bundle; lọc extension/MIME.
- Chọn rule theo priority, hòa thì giữ thứ tự đã lưu; có tùy chọn xét URL sau redirect.
- Quản lý rule, nhân bản, bật/tắt và thử rule trong Options; thao tác nhanh từ popup.
- Xử lý tên trùng bằng `uniquify`, `overwrite` hoặc `prompt`; mặc định `uniquify`.
- Export/import JSON có preview và xác nhận; giữ ID, timestamps, thứ tự và cấu hình khi ghi lỗi.

Extension chỉ đề xuất **thư mục con của Downloads**. Chrome, Save As và extension khác có thể thay tên/vị trí cuối. Không match, routing bị tắt hoặc handler gặp lỗi sẽ dùng hành vi mặc định của Chrome.

## Cài đặt

Cần Node.js **24.x**, pnpm **12.3.4** và Chrome/Chromium **120+**. Môi trường đã kiểm chứng là Windows x64 với Chromium 149; Chrome 120 thực tế chưa được kiểm thử.

```powershell
git clone --branch dev https://github.com/Dathless/Download-Router.git
cd Download-Router
pnpm install --frozen-lockfile
pnpm build
```

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Chọn **Load unpacked**, mở thư mục `dist/`.
3. Bấm icon extension → **Mở cài đặt**, hoặc Details → Extension options.

Nếu dùng ZIP đã build, giải nén rồi Load unpacked thư mục chứa `manifest.json`. Extension hoạt động từ artifact, không cần Node, pnpm hoặc dev server sau khi build. Giữ Developer mode bật khi reload bản unpacked.

## Sử dụng

Trong Options, chọn **Thêm rule**, nhập matcher/pattern, thư mục tương đối, filters và priority rồi lưu. Ví dụ:

| Matcher | Pattern                                     | Thư mục con          |
| ------- | ------------------------------------------- | -------------------- |
| Domain  | `github.com`                                | `Development/GitHub` |
| Prefix  | `https://example.com/reports/`              | `Reports`            |
| Glob    | `https://*.example.com/files/*.pdf`         | `Documents`          |
| Regex   | `^https://example[.]com/releases/.*[.]zip$` | `Archives`           |

Priority cao hơn thắng; cùng priority thì rule đứng trước thắng. Domain match chính xác hostname, không tự gồm subdomain. Filters cách nhau bằng dấu phẩy; để trống nếu không giới hạn. Chi tiết grammar và giới hạn: [Quy tắc định tuyến](docs/RULES.md).

**Thử rule** dùng bản nháp với settings đã lưu; cần URL, basename Chrome và MIME khi có MIME filter. Tester không ghi cấu hình hoặc tải file, và không hứa winner của cả danh sách. Lưu lỗi giữ bản nháp; mất phản hồi sau write cần **Đọc lại cấu hình** trước khi thử lại.

Popup có công tắc routing, số rule và **Đề xuất gần nhất**. Event chỉ lưu timestamp/rule ID/basename/destination trên máy; đây là đề xuất best effort, không phải xác nhận file đã tải hoàn tất.

Lần cài mới có rule mẫu `127.0.0.1 → DownloadRouterTest/Local`. Có thể tắt hoặc xóa rule này bằng UI. `overwrite` có thể thay nội dung file cũ; chỉ kiểm thử với file giả.

## Backup và nâng cấp

Trong Options → **Sao lưu và khôi phục**:

1. **Xuất JSON** để tải `download-router-config.json` từ cấu hình đã lưu; file không chứa event/log hoặc bản nháp.
2. Chọn JSON tối đa **16 MiB**, bấm **Xem trước thay thế**, kiểm tra số rule/settings.
3. Chỉ **Xác nhận thay toàn bộ** khi muốn thay tất cả settings/rules. Hủy không ghi dữ liệu; không merge hoặc migrate.

File sai version, field, ID, rule, regex hoặc đường dẫn bị từ chối toàn bộ. Cấu hình đổi sau preview yêu cầu xem trước lại. Ghi lỗi giữ dữ liệu cũ; mất channel không tự retry vì write có thể đã commit.

Trước khi nâng cấp, giữ backup và artifact cũ. Thay artifact trong **cùng thư mục**, bấm Reload ở `chrome://extensions` rồi mở lại Options/Popup để giữ extension ID/profile. Rollback cùng schema v1 cũng dùng thư mục đó; không clear storage. Chỉ import backup khi chủ động muốn thay cấu hình hiện tại.

## Phát triển và kiểm thử

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:coverage
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm dev` build theo dõi thay đổi; sau build cần Reload extension. Không dùng Vite HMR làm runtime. E2E sử dụng profile và Downloads riêng trong `.test-artifacts/`; không mở Chrome cá nhân. Có thể đặt `CHROMIUM_EXECUTABLE` tới browser thử đã cài.

Hướng dẫn fixture, native dialogs, benchmark, release và bằng chứng: [Kiểm thử](docs/TESTING.md). Bộ kiểm chứng v1 có **466 tests**, core line coverage **100%** và **52 TEST-ID** trong boundary được ghi rõ; xem [evidence](docs/evidence/v1.0.0.json) để đối chiếu revision/build.

## Cấu trúc và tài liệu

```text
src/                   Core, models, background, storage, options, popup
public/                Manifest, icons, thông báo license của RE2JS
tests/                 Unit/integration tests và fixture dùng chung
scripts/e2e.mjs        Browser regression runner
scripts/e2e/           Kịch bản Options, Popup, portability, reliability, release
scripts/               HTTP fixture server và chuẩn bị release
docs/                  Hợp đồng kỹ thuật, kiểm thử và evidence gọn
docs/planning/         Kế hoạch gốc và các phase đã hoàn thành
docs/history/          Tóm tắt lịch sử triển khai và quyết định giữ lại
```

| Tài liệu                                  | Nội dung                                             |
| ----------------------------------------- | ---------------------------------------------------- |
| [ARCHITECTURE](docs/ARCHITECTURE.md)      | Module, luồng dữ liệu, message API và bảo vệ dữ liệu |
| [RULES](docs/RULES.md)                    | Grammar matcher/filter, priority, URL và đường dẫn   |
| [TESTING](docs/TESTING.md)                | Lệnh kiểm tra, boundary và quy trình release         |
| [CHANGELOG](CHANGELOG.md)                 | Thay đổi phiên bản và giới hạn đã biết               |
| [Lịch sử](docs/history/IMPLEMENTATION.md) | Tiến trình v1 và provenance bằng chứng               |
| [AGENTS](AGENTS.md)                       | Hướng dẫn sửa dự án và yêu cầu kiểm chứng            |

Raw logs, browser profiles, Downloads, cache, coverage và build outputs không thuộc cây source hiện tại. Chỉ evidence gọn, không chứa đường dẫn máy cá nhân, được chọn để theo dõi trong Git. RE2JS 2.8.6 dùng MIT; [license của dependency](public/RE2JS-LICENSE.txt) được kèm artifact. Chưa publish lên Chrome Web Store.
