# Kiểm thử và nghiệm thu

Danh mục yêu cầu và TEST-ID nằm trong [workingphase.md](D:/LocalProject/ChromeExtension/DownloadRouter/workingphase.md). Tài liệu này ghi điểm vào thực thi, boundary và bằng chứng; không thay đổi điều kiện nghiệp vụ trong PLAN.md.

## Điểm vào

| Lệnh               | Phạm vi                                             | Boundary                                                                            |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| pnpm typecheck     | TypeScript source, config và test TS                | Không browser                                                                       |
| pnpm lint          | Source, config, scripts và test                     | Không browser                                                                       |
| pnpm format:check  | Mã và tài liệu được Prettier quản lý                | Hai tài liệu kế hoạch giữ layout gốc và có trong .prettierignore                    |
| pnpm test          | 5 test files, 59 assertions/test cases của Phase 0  | Core/handler/repository thật; Chrome API và timer giả; fixture HTTP/loopback thật   |
| pnpm test:coverage | Cùng suite; đo toàn bộ src/core/**/*.ts             | V8 coverage, không trộn UI vào core                                                 |
| pnpm build         | Production dist                                     | Executable local, manifest entries ổn định                                          |
| pnpm test:fixtures | Fixture server 127.0.0.1:8173                       | HTTP attachments/redirect, không đọc filesystem người dùng                          |
| pnpm test:e2e      | Extension unpacked + Chromium + file Downloads thật | Profile và download root mới trong .test-artifacts; không mock Chrome extension API |

Chạy pnpm install --frozen-lockfile trước. Nếu thiếu Chromium, chạy pnpm exec playwright install chromium; hoặc đặt CHROMIUM_EXECUTABLE tới binary Chromium thử nghiệm. Fixture server được E2E khởi động ở cổng trống và đóng trong finally. Mỗi lần chạy giữ report/profile/file riêng để kiểm tra, không commit profile và Downloads.

## Thủ tục Chrome thủ công để chạy lại

1. Build, load dist vào profile thử theo README; giữ settings Save As tắt cho baseline này.
2. Chạy fixture server, mở http://127.0.0.1:8173 và tải Direct attachment. Xác nhận nội dung file và đường dẫn Downloads/DownloadRouterTest/Local/sample.txt.
3. Đổi hostname trang sang localhost và tải để kiểm tra no-match: file ở Downloads gốc theo Chrome mặc định. Bài E2E tự kiểm tra thêm nhánh disabled bằng cách sửa config chỉ trong profile thử của nó.
4. Đóng worker DevTools, dừng worker từ công cụ Chrome hoặc chờ nó idle. Bắt đầu một download mới rồi kiểm tra file và trạng thái complete. Ghi rõ cách dừng: bằng chứng hiện có sử dụng CDP stop, chưa kiểm chứng chờ idle tự nhiên.
5. Không dùng thao tác saveAs của test runner để đưa file vào đường dẫn mong đợi. Đường dẫn phải được Chrome ghi thật theo suggestion của extension.
6. Kiểm tra console/CSP và ghi Chrome version, OS, revision, fixture, đường dẫn thực tế. Không ghi dữ liệu URL/token thật vào biên bản.

## Biên bản Phase 0 — 2026-10-15

Môi trường thực thi: Windows x64; Node 24.18.0; pnpm 12.3.4; TypeScript 5.9.3; Vite 8.3.4; Vitest 5.0.4; Playwright 1.64.1; RE2JS 2.8.6 (MIT). Chromium thử nghiệm 149.0.7827.55 headless, profile mới. Không sử dụng profile Chrome cá nhân.

Các lệnh test có loopback/browser được chạy ngoài sandbox mạng hạn chế, vì lần chạy sandbox trả EACCES khi kết nối server 127.0.0.1. Đây là giới hạn môi trường chạy test; không thay server bằng mock để bỏ qua boundary thật.

### Kết quả và asset

| TEST-ID       | Trạng thái | Asset/test node và bằng chứng                                                                                                                            |
| ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-DR-P0-01 | covered    | scripts/phase0-e2e.mjs: load production, mở options/popup, kiểm tra manifest downloads/storage và không worker/page error                                |
| TEST-DR-P0-02 | covered    | E2E xác nhận file thật cho matched, no-match và disabled; config-repository.test.ts kiểm tra seed không overwrite; fixture-server.test.js chạy HTTP thật |
| TEST-DR-P0-03 | covered    | E2E stop worker, quan sát stopped, trigger download, quan sát running và marker global đã mất; report.pdf nằm dưới thư mục rule                          |
| TEST-DR-P0-04 | covered    | download-handler.test.ts: true đồng bộ, completion đúng một lần trên match/no-match/disabled/lỗi; error log không chứa dữ liệu exception                 |
| TEST-DR-P0-05 | covered    | download-handler.test.ts: 999/1.000 ms, late resolve/reject, timer clear trên success                                                                    |
| TEST-DR-P0-06 | covered    | path-builder.test.ts và handler tests: Windows/POSIX basename, Unicode, traversal/absolute/control/reserved names và fallback                            |
| TEST-DR-P0-07 | covered    | regex.test.ts và E2E production regex.js trong MV3/CSP: syntax, unsupported constructs, biên độ dài và nested quantifier                                 |

Standard runner pnpm test khám phá các test node mang TEST-ID trong tests/unit. Tại thời điểm nghiệm thu có 5 test files, 59 test cases đều pass; các TEST-ID chưa thuộc Phase 0 vẫn missing. Không có test asset bị xóa/quarantine hoặc bị đánh giá duplicate/stale.

Evidence E2E được giữ trong docs/evidence/phase0-chromium.json. Report gốc in đường dẫn .test-artifacts của lượt chạy và SHA-256 nội dung file thật. Các lượt thử lỗi trước đó được giữ cục bộ nhưng không được dùng làm bằng chứng covered.

### Kết quả tải thật

| Tình huống                     | File tương đối dưới Downloads của profile thử | Chrome state |
| ------------------------------ | --------------------------------------------- | ------------ |
| Matched 127.0.0.1              | DownloadRouterTest/Local/sample.txt           | complete     |
| No-match localhost             | sample.txt                                    | complete     |
| Disabled                       | report.pdf                                    | complete     |
| First download sau worker stop | DownloadRouterTest/Local/report.pdf           | complete     |

### Lệnh đã chạy

| Lệnh                                     | Exit code/kết quả                                              |
| ---------------------------------------- | -------------------------------------------------------------- |
| pnpm install --frozen-lockfile --offline | 0 sau khi cache/cấu hình store ổn định; lockfile giữ nguyên    |
| pnpm typecheck                           | 0                                                              |
| pnpm lint                                | 0                                                              |
| pnpm test                                | 0; 59/59, 5 files                                              |
| pnpm test:coverage                       | 0; cùng 59 test cases                                          |
| pnpm build                               | 0; worker, pages, regex entry, icons và license nằm trong dist |
| pnpm test:e2e với CHROMIUM_EXECUTABLE    | 0; Chromium 149, native default download behavior              |

pnpm format:check đã đạt (exit 0). Lượt chạy pnpm run test --reporter=json --outputFile=docs/evidence/phase0-unit.json cũng đạt (exit 0), lưu 59 test cases và 0 failures. Coverage snapshot nằm trong docs/evidence/phase0-coverage.json. Hash manifest/background/regex của production build được ghi trong evidence Chromium để đối chiếu đúng artifact; source được bàn giao bằng initial commit trên nhánh main.

Coverage ở lượt đã đo: lines 100% (19/19), statements 100% (20/20), branches 87,87% (29/33), functions 100% (6/6), scope src/core/**/*.ts. Bốn file core đều có trong coverage-summary.json; không exclude file chưa được test để tăng tỷ lệ. Phase 0 chưa áp dụng gate ≥90% của core đầy đủ Phase 1; kết quả hiện tại không chứng minh matcher/filter còn chưa triển khai.

Nested-quantifier nonmatch trong MV3 hoàn tất ở input 129/1.025/8.192 code units. Thời gian đo cụ thể nằm trong report; không dùng kết quả ba input này để khẳng định benchmark hiệu năng của Phase 5 đã đạt.

### Phát hiện trong quá trình chạy và cách xử lý

- pnpm 12 tự install khi store thay đổi, khiến script song song tranh node_modules. Đã chốt store trong workspace và verifyDepsBeforeRun: error; script không được tự sửa dependency trong lúc kiểm tra.
- Browser.setDownloadBehavior allow khiến download đi thẳng vào thư mục gốc và bỏ qua hook filename. Đã chuyển E2E về default và đặt Downloads bằng Preferences trong profile mới; rerun kiểm chứng file thật đạt.
- Chromium có thể tái sử dụng worker targetId sau stop. Assertion đã dựa vào trạng thái stopped → running và JS-global marker mất đi; không bỏ điều kiện worker thật bị dừng.

### Giới hạn bằng chứng

Đã kiểm chứng trên Chromium 149 headless; chưa kiểm tra giao diện toolbar bằng Chrome cài trên máy, natural idle shutdown, Save As hoặc extension conflict. Regex được chứng minh ở trang MV3 bằng production module, chưa route regex trong worker; đây là công việc Phase 1. Chưa triển khai CRUD, filter, serialized mutation queue, import/export hoặc các phase sau.
