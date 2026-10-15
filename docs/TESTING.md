# Kiểm thử và phát hành

Tài liệu này mô tả cách kiểm chứng source hiện tại. [Evidence v1.0.0](evidence/v1.0.0.json) ghi source digest, lệnh/exit code, coverage, TEST-ID, production/ZIP hashes và các kết quả browser đã chọn. [Lịch sử triển khai](history/IMPLEMENTATION.md) giữ provenance và các giới hạn của bằng chứng cũ.

## Môi trường và quality gates

- Node 24.x, pnpm 12.3.4 theo `packageManager` và lockfile.
- Chromium tương thích Playwright; môi trường đã kiểm chứng: Windows x64, Chromium 149.0.7827.55.
- Fixture HTTP dùng loopback; sandbox phải cho phép kết nối cục bộ.

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:coverage
pnpm build
pnpm test:e2e
```

Không sửa dependency hoặc lockfile để chạy test. Nếu thiếu browser, chạy `pnpm exec playwright install chromium`, hoặc đặt đường dẫn binary thử:

```powershell
$env:CHROMIUM_EXECUTABLE = 'C:\path\to\chromium\chrome.exe'
pnpm test:e2e
```

## Phạm vi kiểm tra

| Nhóm           | Điểm vào                          | Boundary                                                                                |
| -------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| Core/contract  | `tests/unit/`                     | Validator, matchers, pipeline và path thật; Chrome API/timer giả theo ca                |
| Integration    | `tests/integration/`              | Handler/repository/client thật; storage/messaging/DOM shell giả tại biên                |
| Browser        | `scripts/e2e.mjs`, `scripts/e2e/` | Production unpacked, Chrome API, UI, HTTP fixture và filesystem thật                    |
| Native dialogs | `scripts/e2e/native-dialogs.mjs`  | Chromium có cửa sổ; người thao tác Save As, script kiểm tra history/content/hash        |
| Release        | `scripts/prepare-release.mjs`     | Source snapshot riêng, frozen install, mọi quality gate, ZIP integrity và build lặp lại |

Tất cả `src/core/**/*.ts` thuộc coverage; gate line **≥90%**. Baseline v1: **466/466 tests**, **19 files**, **100% lines (170/170)**, **98,54% branches (271/275)**. Không loại core file, bỏ assertion hoặc quarantine để đạt gate. TEST-ID trong tên test giữ liên hệ với [workingphase](planning/workingphase.md).

Chrome E2E phải xác nhận history ID mới, state `complete`, saved path và nội dung/hash. Không dùng `download.saveAs` hoặc move file để tạo kết quả mong muốn. Profile/Downloads mới nằm dưới `.test-artifacts`; `DOWNLOAD_ROUTER_E2E_ARTIFACTS`, nếu đặt, phải trỏ tới thư mục mới trực tiếp dưới một `.test-artifacts`. Giữ đường dẫn ngắn để không thay boundary full path Windows của corpus.

Browser download behavior là `default`; chế độ automation `allow/allowAndName` có thể bỏ qua hook filename. Worker cold start dùng CDP stop và xác nhận `stopped`, đóng extension pages rồi kiểm tra file trước khi mở lại extension API. Không mở worker DevTools window; không coi CDP stop là chờ idle tự nhiên.

Quota test dùng key filler hoặc intent lớn trong storage của profile dùng riêng; config cũ phải giữ nguyên và tiếp tục route. Lost-response test chỉ điều khiển caller transport sau write thật; UI phải khóa tới explicit reread, không tự retry. File picker dùng `setInputFiles`, cancel-event được dispatch có chủ đích; không gọi đó là thao tác Windows picker.

## Fixture và benchmark

```powershell
pnpm test:fixtures
```

Mở `http://127.0.0.1:8173` bằng profile thử. Direct attachment theo rule mẫu phải nằm trong `Downloads/DownloadRouterTest/Local`; hostname `localhost` không match domain `127.0.0.1`. PDF fixture kiểm tra basename từ Content-Disposition khi URL không có tên. Dừng bằng Ctrl+C. Không dùng tài liệu thật cho overwrite.

Đo 200 rule riêng, không coverage/profiling:

```powershell
$env:DOWNLOAD_ROUTER_BENCHMARK = '1'
try { pnpm exec vitest run tests/unit/reliability.test.ts }
finally { Remove-Item Env:\DOWNLOAD_ROUTER_BENCHMARK }
```

Số đo Node ở `.test-artifacts/benchmarks/handler.json`; browser ở `.test-artifacts/benchmarks/chromium.json` và `e2e-report.json`. Node dùng async in-memory storage, không đo Chrome storage latency. Browser đo click tới file đúng nội dung, gồm polling/I/O; không gọi đó là CPU time. Watchdog không ngắt xử lý đồng bộ.

## Native prompt và Save As

Sau `pnpm build`, chạy `node scripts/e2e/native-dialogs.mjs` với `CHROMIUM_EXECUTABLE`. Helper tạo profile/Downloads riêng và chỉ dùng fixture. Gửi JSON line trong stdin:

```json
{ "action": "trigger", "case": "prompt-cancel" }
```

Người dùng chọn Cancel ở hộp thoại, rồi gửi `{"action":"verify"}`. Lặp với `prompt-choose`, `save-as-choose`, `save-as-cancel`: hai ca chọn tên dùng `prompt-choice.txt`/`user-choice.txt` trong fixture root; hai ca hủy phải đóng hẳn Save As, không xác nhận overwrite. Gửi `{"action":"finish"}` sau đủ bốn ca. `status`/`retry` giữ dialog khi vẫn pending; không suy pass từ lời xác nhận trước khi history/filesystem đạt.

Resume chỉ dùng `NATIVE_RESUME_REPORT` từ report fixture đã kiểm tra, bắt cùng production hash và giữ provenance. Bốn case đã có [bằng chứng lịch sử](evidence/native-dialogs-2026-10-15.json), do người thao tác Windows dialog vì computer-use không đọc được window owner. Đây không phải lần chạy native mới trên build hiện tại.

## Release trên Windows

```powershell
$env:CHROMIUM_EXECUTABLE = 'C:\path\to\chromium\chrome.exe'
pnpm release:prepare
```

Script lấy file inventory Git, gồm thay đổi chưa commit, vào source snapshot không có dependency/build/cache/profile. Base commit, source digest và từng source SHA nhận diện chính xác ứng viên; không gọi working tree chưa sạch là clean commit. Snapshot dùng package cache đã chuẩn bị; nếu frozen offline install thiếu cache, chạy install theo lockfile trước, không nới gate.

Quy trình chạy typecheck/lint/format/full coverage/build/browser, rà version/manifest/CSP/permissions/entries/license và production inventory. ZIP được giải nén và so hash với dist đã load; build lần hai phải tái lập mọi production file. Chỉ gói production resources, không source/test/server/profile. ZIP metadata/timestamps không được coi là tái lập bit-for-bit.

Để kiểm tra upgrade, đặt `PREVIOUS_EXTENSION` tới artifact **0.1.0** đã giữ riêng trước khi build v1. Suite tạo rule/settings và backup bằng UI, thay artifact trong cùng đường dẫn/profile, reload và so exact config cùng download thật. Không có artifact cũ thì report ghi `tested: false`; runtime reload 1.0.0 vẫn được kiểm tra. Bật Developer mode đúng README trước reload; Chrome đóng extension tabs nên phải mở Options mới.

Mỗi lượt có `release-report.json`, logs, source snapshot, ZIP và **`verification.json`** trong `.test-artifacts/release-<version>-<timestamp>/`. `verification.json` là bản gọn có thể chia sẻ, không chứa đường dẫn máy; chỉ copy bản pass đã review vào `docs/evidence/v<version>.json`. Raw reports/profiles/logs giữ cục bộ và được Git ignore. Source hash của report nhận diện snapshot tại lúc chạy; thay đổi tài liệu sau đó không được mô tả như đã nằm trong snapshot cũ.

## TEST-ID và giới hạn

| Phase | Yêu cầu được bảo vệ                                                         | TEST-ID  |
| ----- | --------------------------------------------------------------------------- | -------- |
| 0     | Chrome feasibility, fallback, watchdog, path và regex                       | P0-01–07 |
| 1     | Bốn matcher, filter, priority, URL, path, schema                            | P1-01–08 |
| 2     | Persistence, queue, lifecycle, integration và lỗi storage                   | P2-01–07 |
| 3     | CRUD, validation, tester, draft, keyboard và list order                     | P3-01–07 |
| 4     | Popup toggle/count, events, đồng bộ và cold worker                          | P4-01–05 |
| 5     | Corpus an toàn, conflict, privacy, lỗi và workload 200 rule                 | P5-01–06 |
| 6     | Canonical roundtrip, strict rejection, preview/cancel/stale/quota           | P6-01–07 |
| 7     | Production build, UI workflow, reload/upgrade, package và release checklist | P7-01–05 |

Baseline v1 có **52/52 TEST-ID covered trong boundary đã ghi**. P5-06 dùng addon fixture đối chứng: mỗi listener thật gọi `suggest`, hai requested load orders và file complete/content/hash đều được kiểm tra. Không bảo đảm install order, winner hoặc tương thích mọi addon bên thứ ba.

Chưa kiểm chứng: binary Chrome 120, natural idle shutdown, screen reader/WCAG đầy đủ, mọi full path dài, addon thực tế ngoài fixture và native Save As trên build hiện tại. Basename 107 UTF-16 units đã thử không bảo đảm mọi segment 255 units hoặc đường dẫn đầy đủ được OS chấp nhận. Event có thể cũ vì best effort; quota có thể reject JSON hợp lệ. Các giới hạn này không bị ghi covered bởi test pass.
