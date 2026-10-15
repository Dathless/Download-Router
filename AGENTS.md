# Hướng dẫn làm việc cho Download Router

Đọc tài liệu này trước khi sửa dự án. Trao đổi với người dùng bằng tiếng Việt; giữ tên API, symbol và TEST-ID như mã nguồn.

## Nguồn quyết định

- `docs/planning/PLAN.md`: phạm vi v1 và yêu cầu đã được chốt; giữ như tài liệu thiết kế gốc.
- `docs/planning/workingphase.md`: đầu ra, TEST-ID và DoD của các phase v1 đã hoàn thành. Đọc phần liên quan khi sửa hợp đồng đã nghiệm thu.
- `docs/ARCHITECTURE.md`, `docs/RULES.md`, `docs/TESTING.md`: kiến trúc, grammar thực tế và bằng chứng kiểm thử. Đọc file liên quan; không sao chép toàn bộ kế hoạch vào tài liệu khác.
- Chỉ cập nhật phase thành `done` sau khi đủ đầu ra, test và bằng chứng. Giữ các phase sau ở trạng thái thực tế.

## Trước khi thay đổi

- Kiểm tra `git status`; giữ nguyên công việc đang có của người dùng.
- Nếu root có `.codegraph/`, dùng `codegraph_explore` hoặc `codegraph explore` trước khi tìm/đọc code. Không tự index. Nếu chưa có, dùng `rg` / `rg --files`.
- Đọc shared helper và mọi caller trước khi sửa hợp đồng; xác định test, fixture, repository, background và tài liệu bị tác động.
- Chọn skill phù hợp với công việc; đọc `SKILL.md` trước khi áp dụng. Không tạo hệ thống quản trị hay dependency chỉ để đủ hình thức.
- Nhánh mặc định của repository là `dev`. Stage theo danh sách file đã review; không thêm build, cache, profile, raw logs hoặc config riêng vào commit.

## Các hợp đồng phải giữ

- Extension MV3 chạy local, chỉ quyền `downloads` và `storage`. Executable code đóng gói cục bộ; không backend, telemetry, content script, remote script hoặc native messaging trong v1.
- `src/core/` độc lập Chrome/DOM. Background và rule tester phải dùng chung model, validator, URL normalization, filters và pipeline chọn rule.
- Options dùng DOM native và `textContent`, giữ draft khi lưu lỗi; chỉ gửi field thật sự thay đổi qua `createRulePatch`. Tester gọi `core/rule-tester.ts` → cùng `matchRule`; không tự viết matcher/filter để giải thích kết quả. Giữ label, field errors, focus và bàn phím; chạy UI E2E khi sửa luồng form.
- `configVersion: 1` ở root, dữ liệu lưu dưới key `config`. Không reset/xóa config lỗi hoặc version chưa hỗ trợ. Runtime bỏ qua từng rule hỏng trong bộ nhớ; save/import dùng validation nghiêm ngặt.
- UI gọi `requestConfig` và gửi mutation intent theo `src/models/messages.ts`, không ghi trực tiếp storage hoặc gửi config cũ thay toàn bộ. Repository áp dụng patch lên snapshot mới nhất trong queue, strict-validate rồi await một lần set. Xem hợp đồng message trong `docs/ARCHITECTURE.md`; không tự retry mutation khi channel đóng vì write có thể đã commit.
- Export dùng projection canonical, không bỏ rule lỗi hoặc kèm event/log. Import JSON tối đa 16 MiB, reject field lạ và toàn bộ file lỗi bằng validator dùng chung. Chỉ `config.import` được thay toàn bộ sau preview/confirm; kiểm tra SHA-256 snapshot trong cùng writer queue trước một awaited set. Giữ ID/timestamps/order, không clear/reset/merge; stale yêu cầu preview mới, write lỗi giữ candidate/draft.
- Priority là safe integer; cao hơn thắng, hòa giữ thứ tự array. Original/final URL cạnh tranh theo rule; cùng rule match cả hai thì original thắng. Chỉ HTTP(S), bỏ fragment, giữ query order và encoded separator.
- Regex dùng RE2JS đã bundle; không native `RegExp` cho regex người dùng, không fallback native. Giữ giới hạn pattern/input và compile bằng cùng engine ở mọi boundary. Watchdog không ngắt được xử lý đồng bộ.
- Dùng basename Chrome cung cấp, không suy filename/MIME từ URL. Validate destination, basename và toàn relative path; không tự sửa đích nguy hiểm. Chỉ gợi ý thư mục con của Downloads.
- Listener được đăng ký một lần ở module top level; callback trả `true` đồng bộ, hoàn tất đúng một lần, watchdog 1.000 ms, bỏ kết quả muộn. Disabled/no match/lỗi gọi `suggest()` không đối số. Không log URL, token, filename hoặc error object chứa dữ liệu tải xuống.
- Conflict action trên rule ghi đè settings; mặc định khởi tạo `uniquify`. Không dùng file thật để thử overwrite.
- Popup toggle dùng cùng settings.update writer và trạng thái đã commit. Event chỉ ở key lastRoutingEvent, tách config, whitelist timestamp/ruleId/basename/destination; ghi best effort sau suggest. Lỗi/pending event không được kéo dài handler, fallback không tạo event. Không thêm URL/query hoặc mô tả proposal là tải hoàn tất.

## Kiểm chứng và bàn giao

- Node 24.x, pnpm theo `packageManager`/lockfile. Cài bằng `pnpm install --frozen-lockfile`; không sửa dependency khi chạy kiểm tra.
- Chạy `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:coverage`, `pnpm build`. Core line coverage ≥90% từ Phase 1; không loại file khỏi coverage để đạt gate.
- Thay đổi handler/core/build cần chạy lại E2E liên quan bằng `pnpm test:e2e`. Nếu thiếu browser, dùng Chromium thử nghiệm theo README; HTTP fixture cần quyền loopback.
- E2E phải dùng profile và Downloads riêng trong `.test-artifacts/`; kiểm tra file thật, không dùng `download.saveAs` để tạo kết quả giả. Không mở profile Chrome cá nhân.
- Thêm ca hồi quy cho logic có rủi ro; giữ TEST-ID trong tên test. Cập nhật hướng dẫn/evidence trong `docs/TESTING.md`; chỉ cập nhật kế hoạch khi yêu cầu/DoD đổi. Phân biệt mock, browser thật và phần chưa kiểm tra. Raw reports ở `.test-artifacts`; chỉ portable verification và native summary được chọn vào `docs/evidence`.
- Đo latency bằng lệnh benchmark riêng không coverage; không coi số đo dưới profiling là baseline production. Dùng corpus/generator Phase 5 hiện có. Prompt/Save As cần dialog thật và history/file content; không thay bằng download.saveAs. Giữ manual exit cho extension conflict chưa thử, không tự nâng trạng thái thành covered.
- Release Windows dùng `pnpm release:prepare`: source snapshot sạch, frozen install, checks, ZIP/build hashes và build lặp lại. Chỉ sửa version package/manifest đồng bộ; configVersion vẫn 1. Khi thử reload unpacked, profile phải bật Developer mode theo README và mở Options mới sau khi Chrome đóng tab cũ. P5-06 có bằng chứng Phase 7 với addon fixture đối chứng; không suy ra tương thích mọi extension khác.
- Không commit `dist`, `coverage`, browser profile, Downloads, dependency/cache hoặc secrets. Chỉ commit/push khi được người dùng yêu cầu.
- Bàn giao ngắn gọn: thay đổi gì, test nào đạt, artifact liên quan và giới hạn/rủi ro còn lại. Không coi test pass là nghiệm thu các phase chưa làm.
