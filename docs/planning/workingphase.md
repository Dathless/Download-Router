# Download Router — Các giai đoạn triển khai

> Kế hoạch triển khai v1 đã hoàn tất. Giữ nội dung gốc để tra cứu yêu cầu và DoD; cấu trúc/hướng dẫn hiện hành ở [README](../../README.md), [ARCHITECTURE](../ARCHITECTURE.md), [TESTING](../TESTING.md). Tên report và đường dẫn sinh trong biên bản cũ là tham chiếu lịch sử; xem [lịch sử bằng chứng](../history/IMPLEMENTATION.md).

Ngày lập: 2026-10-15. Phạm vi: v1.0.0, extension dùng cá nhân trên Chrome/Chromium.

Tài liệu này chuyển [PLAN.md](PLAN.md) thành công việc có thể triển khai và nghiệm thu. PLAN.md là nguồn quyết định về chức năng, mô hình dữ liệu và kiến trúc; tài liệu này quy định thứ tự, đầu ra và bằng chứng hoàn thành. Khi đổi hành vi hoặc phạm vi, cập nhật PLAN.md trước rồi đồng bộ các phase và TEST-ID bị ảnh hưởng.

Hiện trạng khi lập: chỉ có PLAN.md; chưa có mã nguồn, package.json, Git repository hoặc bộ kiểm thử. Việc tạo tài liệu này không có nghĩa là đã thực hiện Phase 0.

Danh mục ban đầu: 52 hạng mục kiểm thử bắt buộc, tất cả missing; 0 test asset hiện hữu, 0 covered, chưa có asset nghi trùng hoặc lỗi thời. Các ca hồi quy tham chiếu lại TEST-ID cũ, không cộng thành test asset mới.

Cập nhật nghiệm thu 2026-10-15: Phase 0–7 done, **52/52 TEST-ID covered** trong boundary đã ghi; không còn TEST-ID missing/unverified. P5-06 được bổ sung kiểm tra hai extension đối chứng ở Phase 7; không suy ra tương thích mọi addon. Có 19 test files, 466 test cases, E2E Chrome/filesystem thật, upgrade 0.1.0→1.0.0, import hai profile và bằng chứng native dialog lịch sử Phase 5. Core lines 100%, branches 98,54%. V1.0.0 có ZIP/SHA-256, source snapshot riêng và build lặp lại khớp hash. Bằng chứng/giới hạn: [docs/TESTING.md](../TESTING.md).

## 1. Quy tắc thực hiện và nghiệm thu

- Thực hiện Phase 0 → 7. Chỉ chuyển phase khi DoD của phase trước đạt; chuẩn bị tài liệu/fixture cho bước sau không được thay cho việc vượt qua điều kiện nghiệm thu.
- Dùng lại mã và fixture của phase trước. Thử nghiệm Phase 0 phải trở thành nền tảng triển khai, không giữ thêm một bản handler hoặc matcher riêng.
- Mỗi thay đổi phải xác định phần bị tác động: caller, model, validator, storage, UI, fixture và test. Sửa một hợp đồng dùng chung phải cập nhật toàn bộ nơi sử dụng.
- Không hoãn an toàn đường dẫn, hoàn tất listener, bảo toàn cấu hình và worker wake-up tới Phase 5. Phase 5 là hồi quy và mở rộng tình huống.
- Chỉ triển khai chức năng v1 trong PLAN.md. Không thêm backend vận hành, content script, telemetry, đồng bộ cloud, migration giả định hoặc Native Messaging.
- Dùng profile Chrome thử nghiệm và thư mục con Downloads/DownloadRouterTest. Chỉ thử overwrite với file giả có thể bỏ; không dùng tài liệu thật để kiểm tra thao tác mất dữ liệu.
- Bug phát hiện trong một phase phải có TEST-ID hiện hữu hoặc ca hồi quy mới tái hiện đúng lỗi. Không xóa/làm yếu assertion chỉ để có kết quả xanh.

### 1.1. Trạng thái

| Đối tượng | Trạng thái | Điều kiện sử dụng |
|---|---|---|
| Phase | not_started | Chưa bắt đầu thực hiện |
| Phase | in_progress | Đang triển khai hoặc kiểm thử |
| Phase | blocked | Có điều kiện bắt buộc chưa thể đáp ứng; ghi nguyên nhân và cách gỡ |
| Phase | done | DoD chung và DoD riêng đều đạt, có bằng chứng |
| TEST-ID | missing | Chưa có test hoặc quy trình manual tương ứng |
| TEST-ID | in progress | Đang xây test/fixture/quy trình |
| TEST-ID | unverified | Đã có test nhưng chưa chạy, chạy lỗi, hoặc bằng chứng chưa đủ |
| TEST-ID | covered | Đã chạy đạt trên revision và môi trường được ghi nhận |
| TEST-ID | not applicable | Có lý do và cơ chế bảo vệ thay thế cụ thể; không dùng để né kiểm thử khó |

Mọi TEST-ID trong tài liệu này khởi tạo ở trạng thái **missing**, chưa có test node hoặc bằng chứng chạy. Các asset/lệnh bên dưới là đích triển khai, không phải file/lệnh đã tồn tại. Khi thêm test, ghi TEST-ID vào tên nhóm test để tìm được bằng standard runner; khi chỉ có kiểm thử manual, ghi TEST-ID trong biên bản tương ứng.

### 1.2. DoD chung cho mọi phase

- [ ] Công việc và đầu ra bắt buộc của phase đã hoàn thành; không còn TODO ảnh hưởng hành vi được nghiệm thu.
- [ ] Typecheck, lint, format check, build và các test liên quan chạy đạt; lưu lệnh thực tế cùng exit code. Chưa có script thì chưa đạt điều kiện này.
- [ ] Ca bắt buộc của phase và ca hồi quy bị tác động có bằng chứng phù hợp. Test giả lập Chrome không thay cho tải thật khi tiêu chí cần Chrome/filesystem thật.
- [ ] Không phát sinh permission ngoài downloads và storage; executable code được đóng gói cục bộ, tuân thủ MV3 CSP.
- [ ] Lỗi extension không cố ý chặn download; không tự xóa/reset cấu hình đang có để che lỗi.
- [ ] Tài liệu mô tả đúng hành vi cuối cùng, TEST-ID và rủi ro còn lại. Không có lỗi còn mở gây mất dữ liệu, chặn download, vượt thư mục đích hoặc chọn rule sai so với đặc tả.
- [ ] Cập nhật bảng tiến độ và biên bản phase; không đánh dấu done chỉ vì đã viết đủ file hoặc coverage cao.

## 2. Tổng quan các phase

| Phase | Mục tiêu | Kết quả bàn giao chính | Phụ thuộc | Trạng thái ban đầu |
|---|---|---|---|---|
| 0 | Chứng minh nền tảng Chrome và regex khả thi | Build load được, một domain rule tải thật, handler fail-safe, quyết định engine | PLAN.md đã chốt | done |
| 1 | Hoàn thiện core | Model/validator, 4 matcher, filter, priority, URL và path; core coverage ≥ 90% | Phase 0 done | done |
| 2 | Tích hợp đầy đủ và bảo vệ dữ liệu | MVP dùng cấu hình lưu bền; ghi tuần tự; worker khởi động lại vẫn hoạt động | Phase 1 done | done |
| 3 | Quản lý rule và settings | Options UI, CRUD, validation, rule tester dùng chung pipeline | Phase 2 done | done |
| 4 | Thao tác nhanh | Popup toggle, số rule, sự kiện routing gần nhất, mở options | Phase 3 done | done |
| 5 | Hồi quy và hardening | Bằng chứng path security, lỗi storage, regex, lifecycle, conflict và quyền riêng tư | Phase 4 done | done |
| 6 | Sao lưu và khôi phục | Export/import thay thế an toàn, bảo toàn thứ tự và hành vi | Phase 5 done | done |
| 7 | Chuẩn bị phát hành | Production artifact, tài liệu, toàn bộ release checklist có bằng chứng | Phase 6 done | done |

### 2.1. Điểm vào kiểm tra cần cung cấp ở Phase 0

Các tên script dưới đây là giao diện làm việc của dự án cần được tạo trong package.json; không yêu cầu script wrapper riêng nếu công cụ đã làm được trực tiếp.

| Lệnh dự kiến | Yêu cầu | Khi dùng |
|---|---|---|
| pnpm typecheck | Kiểm tra TypeScript, không chỉ dựa vào Vite transpile | Mọi phase |
| pnpm lint | ESLint cho phạm vi mã dự án | Mọi phase |
| pnpm format:check | Kiểm tra định dạng bằng Prettier | Mọi phase |
| pnpm test | Vitest chạy một lần rồi kết thúc; unit và integration giả lập cục bộ | Mọi phase |
| pnpm test:coverage | Coverage có phạm vi core được khai báo rõ | Từ Phase 1 |
| pnpm build | Sinh dist load unpacked được; entry khớp manifest | Mọi phase |
| pnpm dev | Build theo dõi thay đổi phục vụ load unpacked; ghi rõ cách reload extension | Khi phát triển |
| pnpm test:fixtures | Chạy HTTP fixture server cục bộ, có hướng dẫn dừng | Kiểm thử Chrome thật |

Phase 0 chốt và ghi phiên bản Node, pnpm, Chrome mục tiêu; commit lockfile. Từ khi có lockfile, dùng pnpm install --frozen-lockfile để kiểm tra cài đặt tái lập. Không coi CI là bắt buộc cho công cụ cá nhân; các lệnh trên phải chạy được cục bộ.

### 2.2. Nhóm kiểm thử và vị trí bằng chứng

| Nhóm | Thành phần chạy thật | Phần được giả lập | Asset dự kiến |
|---|---|---|---|
| U — unit | Core, validator, adapter hoặc handler được import thật | chrome API, timer, promise theo ca | tests/unit/ và fixture dùng chung |
| I — integration | Luồng giữa các module thật, serializer/validator và caller thật | Storage API/messaging ở biên ngoài | tests/integration/; có thể nằm trong suite hiện hữu nếu ranh giới đã rõ |
| C — contract | Payload cấu hình/message qua serializer và runtime validator dùng chung | Transport nếu chưa cần Chrome thật | Suite tương ứng trong tests/unit/ hoặc tests/integration/ |
| E — E2E | Chrome unpacked, worker, options/popup và filesystem thật khi có download | Nguồn tải là HTTP fixture server cục bộ | Quy trình và biên bản trong docs/TESTING.md |
| S — smoke | Production build/package và thao tác cài/load tối thiểu | Không giả lập artifact khi nghiệm thu release | Biên bản trong docs/TESTING.md |

U chủ yếu bảo vệ quy tắc (rule protection); I/C bảo vệ quy tắc và luồng quan trọng (critical path); E/S bảo vệ critical path. Các lần chạy lại TEST-ID sau sửa lỗi là regression protection; ca an toàn/hiệu năng/quyền riêng tư ở Phase 5 là specialized protection. Đây là phân loại mục đích, không phải yêu cầu tạo nhiều framework test.

Tài liệu này là danh mục TEST-ID ban đầu; chưa cần thêm TESTS.md trùng nội dung. docs/TESTING.md sẽ chứa cách chạy và biên bản, tham chiếu TEST-ID thay vì sao chép toàn bộ bảng yêu cầu. Tên file test trong từng phase là dự kiến; nếu triển khai dùng tên khác, cập nhật ánh xạ tại đây.

## Phase 0 — Foundation and Chrome Feasibility

Nguồn: [PLAN §26 — Phase 0](PLAN.md#26-development-phases), [§11 — Download Processing](PLAN.md#11-download-processing), [§8.4 — Regex](PLAN.md#84-regular-expression-matching).

### Điều kiện bắt đầu

PLAN.md là phạm vi được thực hiện. Có thể dùng Chrome profile và thư mục tải thử riêng. Chưa cần toàn bộ matcher hoặc giao diện quản lý.

### Công việc và yêu cầu chi tiết

1. Khởi tạo Git, pnpm, TypeScript, Vite, ESLint, Prettier, Vitest và scripts ở mục 2.1. Chọn phiên bản tương thích, ghi lại môi trường và commit lockfile; không thêm framework UI.
2. Tạo MV3 manifest, icon cơ bản và entry background/options/popup tối thiểu. Chỉ downloads và storage; build entry phải khớp đường dẫn trong dist. Trang options/popup ở phase này chỉ cần mở được.
3. Dựng fixture server cục bộ với tải trực tiếp, redirect và /download/123 có Content-Disposition đặt tên report.pdf. Ghi cổng, cách chạy/dừng và thư mục output; không đưa server thành thành phần vận hành extension.
4. Lưu một cấu hình mẫu và thực hiện domain rule tối thiểu: hostname chính xác → basename do Chrome cung cấp → validate toàn bộ đường dẫn tương đối → suggest. Không bật overwrite mặc định.
5. Đăng ký đúng một listener ở module top level, trước mọi await. Callback thường trả literal true khi xử lý bất đồng bộ; mỗi invocation chỉ hoàn tất một lần. Nhánh disabled, không khớp, dữ liệu lỗi, storage rejection và exception đều dùng suggest() không đối số.
6. Thêm watchdog 1.000 ms cho công việc bất đồng bộ, hủy timer sau hoàn tất và bỏ qua kết quả muộn. Timer không phải cơ chế ngắt regex đồng bộ.
7. Thử engine regex không backtracking được bundle cục bộ. Ghi package/version/license, tập cú pháp được hỗ trợ, cách build và kết quả chạy thật trong MV3/CSP. Không dùng native RegExp cho pattern người dùng khi thử nghiệm thất bại.

### Đầu ra bắt buộc

- Project build được và dist load unpacked được; README có hướng dẫn cài và reload.
- Một domain rule lưu trong storage, download handler có validation và fallback; tái sử dụng trong Phase 1–2.
- tests/unit/download-handler.test.ts, các fixture cần thiết và kiểm thử adapter basename/path tối thiểu.
- docs/TESTING.md bắt đầu có thủ tục Chrome thật; docs/ARCHITECTURE.md ghi quyết định regex và bằng chứng. Không cần tạo thêm hồ sơ kiến trúc riêng.

### Hạng mục kiểm thử

| TEST-ID | Cấp/nhóm | Nguồn PLAN | Đầu vào/thao tác | Kết quả cần chứng minh |
|---|---|---|---|---|
| TEST-DR-P0-01 | smoke/S | §4, §21, §26 | Build sạch, load dist, mở options/popup tối thiểu | Worker khởi động; mọi entry tồn tại; không lỗi CSP hoặc permission thừa |
| TEST-DR-P0-02 | E2E/E | §11, §25 | Tải từ domain rule mẫu; tải không khớp; tắt routing rồi tải | File khớp nằm dưới thư mục thử; hai nhánh còn lại theo Chrome mặc định |
| TEST-DR-P0-03 | E2E/E | §11 | Đóng worker DevTools, xác nhận worker dừng, bắt đầu download mới | Download đầu tiên đánh thức worker và dùng rule đã lưu; ghi đường dẫn file thật |
| TEST-DR-P0-04 | unit/U | §11 | Gọi listener với match, no match, disabled, storage reject và exception | Callback trả true đồng bộ; mỗi nhánh gọi suggest đúng một lần, fallback không có đối số |
| TEST-DR-P0-05 | unit/U | §11 | Promise storage treo; tăng fake timer tới 999 rồi 1.000 ms; resolve/reject sau đó | Trước hạn chưa fallback, đúng hạn fallback một lần, kết quả muộn không gọi lại; đường thành công hủy timer |
| TEST-DR-P0-06 | unit/U | §12–13 | Filename Windows/POSIX, Unicode, basename rỗng hoặc không hợp lệ | Chỉ basename hợp lệ xuất hiện trong relative path; lỗi quay về mặc định, không suy tên từ URL |
| TEST-DR-P0-07 | integration/I, E2E/E | §8.4, §21 | Engine được chọn xử lý pattern thường, syntax sai, construct không hỗ trợ và nested quantifier trên input tăng dần | Unsupported bị từ chối; pattern hợp lệ không backtracking vô hạn; bundle chạy trong MV3/CSP thật, không fallback native |

Asset cho P0-04–06: download-handler.test.ts và path adapter tests; P0-07: regex engine test trong tests/unit/ cùng biên bản MV3. P0-01–03 dùng biên bản Chrome thật. Mọi đường dẫn asset nằm dưới thư mục dự án.

### DoD và điều kiện chuyển phase

- [x] DoD chung đạt; TEST-DR-P0-01–07 có bằng chứng tương ứng, không chỉ mock API.
- [x] Đã quan sát download thật sau worker termination khi DevTools đóng.
- [x] Đã có quyết định RE2JS 2.8.6 và test production module trong MV3/CSP; xem biên bản nghiệm thu.
- [x] Mã domain/handler đã đặt ở vị trí tái sử dụng; chưa xây thêm matcher và CRUD UI ngoài phạm vi Phase 0.

## Phase 1 — Core Domain and Rule Engine

Nguồn: [PLAN §7–10 — Model và matching](PLAN.md#7-domain-model), [§12–13 — Path và filename](PLAN.md#12-destination-handling), [§24 — Testing](PLAN.md#24-testing-strategy).

### Điều kiện bắt đầu

Phase 0 done, engine đã chọn, hợp đồng listener/path cơ bản có test. Phát triển tiếp trên mã đó.

### Công việc và yêu cầu chi tiết

1. Hoàn thiện ExtensionConfig, ExtensionSettings, DownloadRule, DownloadInput và MatchResult cùng runtime validator. configVersion nằm ở root; core không gọi chrome API hoặc DOM. Dùng đúng model và validator cho mọi caller về sau.
2. Chuẩn hóa URL bằng URL API: hostname không phân biệt hoa/thường; giữ ý nghĩa path và encoded separator; prefix/regex giữ query nguyên thứ tự; loại fragment. Chỉ HTTP(S); một candidate hỏng không loại candidate hợp lệ còn lại.
3. Hoàn thiện domain, prefix, glob và regex theo PLAN §8. Glob phân biệt phần hostname/path; không lấy hostname nằm trong path làm domain thật. Không tự mở rộng cú pháp ngoài đặc tả.
4. Regex dùng engine Phase 0 cho save/import/load/runtime. Pattern tối đa 256 ký tự; candidate URL dài hơn 8.192 ký tự bỏ qua riêng đánh giá regex trên candidate đó, vẫn xét rule/candidate khác; v1 không có regex flags. Định nghĩa và dùng chung phép đo độ dài trong code và fixtures.
5. Filter extension dựa trên basename, không dựa vào URL; hỗ trợ suffix kép tar.gz và không phân biệt hoa/thường. MIME exact không phân biệt hoa/thường; giá trị thiếu không qua filter MIME khác rỗng. Trong danh sách là OR, giữa các nhóm filter là AND.
6. Duyệt theo thứ tự lưu, giữ rule match có priority lớn nhất; priority là safe integer. Hòa thì rule đứng trước thắng. Original/finalUrl không tự có quyền ưu tiên hơn rule; cùng rule match cả hai thì matchedUrl là original.
7. Hoàn thiện path builder/validator dùng chung: chặn absolute/traversal/control/reserved component; xử lý separator; không âm thầm sửa đường dẫn nguy hiểm sang đích khác. Chỉ ghép destination hợp lệ và basename hợp lệ, rồi kiểm tra toàn bộ kết quả.
8. Resolve conflictAction bằng giá trị trên rule nếu có, ngược lại settings.defaultConflictAction. Core không tự thực hiện filesystem overwrite.

### Đầu ra bắt buộc

- Model, validator và module core theo PLAN §6; helper chỉ tách khi thực sự được dùng.
- Các suite rule-matcher, rule-engine, url-normalizer, path-builder, path-validator và config validator; fixture hợp lệ/lỗi dùng lại được cho UI và integration.
- Báo cáo coverage core; docs/RULES.md mô tả đúng grammar, filter, tie-break, redirect và giới hạn regex.

### Hạng mục kiểm thử

| TEST-ID | Cấp/nhóm | Nguồn PLAN | Đầu vào/thao tác | Kết quả cần chứng minh |
|---|---|---|---|---|
| TEST-DR-P1-01 | unit/U | §8.1 | github.com, GITHUB.COM, notgithub.com và api.github.com | Exact hostname và chuẩn hóa đúng; không tự bao gồm subdomain |
| TEST-DR-P1-02 | unit/U | §8.2, §10 | Prefix releases so với assets; query đảo thứ tự, fragment, %2F, URL hỏng và scheme ngoài HTTP(S) | Giữ đúng semantics; fragment bị bỏ, encoded slash không bị decode thành separator; lỗi không crash |
| TEST-DR-P1-03 | unit/U | §8.3 | Glob *.example.com với subdomain, apex, hostname giả nằm trong path, wildcard path và ký tự literal | Khớp theo từng phần URL, không nhầm host/path; query không ảnh hưởng glob |
| TEST-DR-P1-04 | unit/U | §8.4 | Pattern ở mốc 256/257; URL normalized ở mốc 8.192/8.193; syntax sai, lookaround/backreference, nested quantifier | Chấp nhận/từ chối đúng biên; URL quá dài chỉ bỏ qua phép regex tương ứng; không dùng native fallback |
| TEST-DR-P1-05 | unit/U | §13 | report.PDF, archive.tar.gz, URL /download/123, MIME thiếu/khác/đúng, list rỗng và nhiều entry | Filter đọc basename thật; OR trong list và AND giữa nhóm đúng; không đoán MIME |
| TEST-DR-P1-06 | unit/U | §9–10 | Priority khác nhau, hòa priority, disabled, original match thấp hơn finalUrl, candidate hỏng | Winner đúng priority rồi array order; cùng rule match hai URL trả original; không early-return sai |
| TEST-DR-P1-07 | unit/U | §12–13 | ../, backslash traversal, drive path, UNC, control character, tên Windows bị cấm, Unicode hợp lệ | Đích nguy hiểm bị từ chối; relative destination hợp lệ được ghép đúng, không silent sanitization gây đổi đích |
| TEST-DR-P1-08 | unit/U, contract/C | §7, §14, §18–19 | Config hợp lệ; enum sai, priority NaN/Infinity/số không an toàn, conflictAction thiếu/override | Validator bắt lỗi runtime; inheritance conflictAction đúng; root schema không trôi giữa các caller |

Asset dự kiến: P1-01/03/04/05 trong rule-matcher.test.ts, P1-02 trong url-normalizer.test.ts, P1-06 trong rule-engine.test.ts, P1-07 trong path-builder.test.ts/path-validator.test.ts, P1-08 trong validator và rule-engine tests. Khi ghi JSON fixture, dùng cả sai kiểu từ dữ liệu parse được; NaN/Infinity được kiểm tra thêm ở boundary đối tượng runtime.

### DoD và điều kiện chuyển phase

- [x] DoD chung đạt; toàn bộ P1-01–08 covered và chạy lại P0-04–07 bị tác động. Xem biên bản Phase 1 trong docs/TESTING.md.
- [x] Line coverage core ≥ 90%, tính toàn bộ module core kể cả file chưa được import bởi test; báo cáo thêm branch/function coverage để thấy nhánh còn thiếu. Kết quả: lines/statements/functions 100%, branches 98,82%; gate lines 90% được thực thi bằng Vitest.
- [x] Core chạy độc lập Chrome/DOM; rule tester về sau có thể import cùng pipeline.
- [x] Hòa priority, URL candidates, filename và regex boundary đã có assertion kết quả, không chỉ assertion gọi hàm.

## Phase 2 — Full Chrome Integration and Reliability

Nguồn: [PLAN §11 — Handler](PLAN.md#11-download-processing), [§18–19 — Persistence](PLAN.md#18-persistence), [§22 — Error handling](PLAN.md#22-error-handling).

### Điều kiện bắt đầu

Phase 1 done. Có core dùng chung, schema/validator và handler Phase 0 đã kiểm chứng.

### Công việc và yêu cầu chi tiết

1. Thay phần domain tối thiểu bằng core đầy đủ; giữ nguyên listener top-level, completion guard, watchdog và fallback. Mỗi download đọc một snapshot cấu hình hiện hành, không dùng cache tồn tại qua giả định vòng đời worker.
2. Hoàn thiện ConfigRepository lưu một ExtensionConfig dưới key config. Tạo defaults chỉ khi config chưa có ở lần cài mới; không reset khi restart/update hoặc gặp schema không hỗ trợ.
3. Runtime load: rule riêng bị lỗi được bỏ qua khi routing nhưng dữ liệu gốc không bị ghi đè; envelope/version sai thì routing fallback và báo lỗi có thể xử lý. Import ở Phase 6 sẽ dùng chính validator nhưng chính sách là reject cả import nếu có lỗi.
4. Tạo luồng mutation message tối thiểu cho caller thực tế. Validate loại thao tác và payload ở background; áp dụng mutation intent lên snapshot mới nhất bên trong hàng đợi. Không cho options/popup gửi bản config cũ để thay thế ngầm.
5. Ghi toàn bộ config đã validate bằng một storage.local.set được await. Không clear trước ghi, không báo thành công trước khi ghi xong; một thao tác lỗi không được làm treo các mutation sau. Không tạo migration framework khi chưa có schema thứ hai.
6. Kiểm tra worker dừng/khởi động lại, nhiều download gần nhau, toggle và thay đổi rule giữa các download. Download đã nhận snapshot dùng snapshot đó; download tiếp theo nhìn thấy cấu hình đã ghi xong.

### Đầu ra bắt buộc

- MVP routing đủ matcher/filter/priority, cấu hình lưu bền và fail-safe.
- ConfigRepository, message handlers và runtime validators; caller có kết quả success/error rõ ràng.
- config-repository.test.ts, integration tests cho handler + core và message contract; quy trình tái hiện cold worker trong docs/TESTING.md.

### Hạng mục kiểm thử

| TEST-ID | Cấp/nhóm | Nguồn PLAN | Đầu vào/thao tác | Kết quả cần chứng minh |
|---|---|---|---|---|
| TEST-DR-P2-01 | unit/U, integration/I | §18–19 | Fresh install không config; config đã có; version thiếu/cũ/mới; update/restart | Chỉ fresh install tạo defaults; cấu hình khác không bị tự reset hoặc downgrade |
| TEST-DR-P2-02 | integration/I | §18, §22 | Rule A sai, B đúng; envelope sai; storage get/set rejection | B vẫn route khi envelope hợp lệ; envelope/read lỗi fallback; không viết lại dữ liệu gốc để che lỗi |
| TEST-DR-P2-03 | integration/I | §11, §18 | Download A lấy snapshot, mutate và ghi xong, rồi download B | A nhất quán với snapshot của nó; B dùng cấu hình mới, không state stale |
| TEST-DR-P2-04 | integration/I | §18 | Queue edit rule và toggle khác field; một set thất bại rồi thêm mutation hợp lệ | Không mất thay đổi không liên quan; lỗi được trả về; queue còn hoạt động; không clear/default reset |
| TEST-DR-P2-05 | contract/C, integration/I | §7, §18, §21 | Message malformed, op không biết, destination lỗi, priority sai kiểu | Boundary từ chối trước ghi; payload hợp lệ đi qua cùng validator; không chỉ tin TypeScript phía UI |
| TEST-DR-P2-06 | E2E/E | §11, §18, §25 | Lưu rule/settings, restart Chrome, tải; thay cấu hình rồi dừng worker và tải lại | Cấu hình tồn tại và download đầu tiên dùng dữ liệu mới; không reinitialize ghi đè |
| TEST-DR-P2-07 | integration/I, E2E/E | §8–11, §25 | Tải thật theo từng matcher, filter, redirect, priority và nhiều download gần nhau | File thật nằm đúng thư mục theo winner; no-match/disabled theo mặc định; các invocation độc lập |

Asset dự kiến: P2-01–04 trong config-repository.test.ts và handler integration suite; P2-05 trong message contract suite; P2-06–07 có biên bản Chrome thật. Chạy lại TEST-DR-P0-02–07 và P1-05–08; không tạo bản test handler trùng chỉ để đổi mã phase.

### DoD và điều kiện chuyển phase

- [x] DoD chung đạt; P2-01–07 covered, cold-worker và persistence có bằng chứng thật. Xem biên bản Phase 2 trong docs/TESTING.md.
- [x] Đủ bằng chứng một snapshot/download, mutation tuần tự, lỗi ghi không xóa dữ liệu và queue phục hồi; có cả quota rejection thật trong Chromium.
- [x] Mọi nhánh handler và race với watchdog vẫn hoàn tất đúng một lần; hồi quy full suite 302/302 đạt.
- [x] Đây là MVP kỹ thuật. Chưa gọi hoàn thành trải nghiệm sử dụng khi quản lý rule vẫn cần fixture/JSON.

## Phase 3 — Rule Management UI

Nguồn: [PLAN §15–16 — Options và tester](PLAN.md#15-options-page), [§7 — Model](PLAN.md#7-domain-model), [§18 — Mutation](PLAN.md#18-persistence).

### Điều kiện bắt đầu

Phase 2 done; options dùng được mutation API có validate và trạng thái ghi rõ ràng.

### Công việc và yêu cầu chi tiết

1. Tạo danh sách rule có enabled, tên, type/pattern, destination và priority; hiển thị thứ tự đang dùng để phân xử khi hòa. Có trạng thái danh sách rỗng và lỗi đọc cấu hình.
2. Tạo/edit/delete/duplicate/enable/disable qua UI. Edit giữ ID và vị trí; duplicate có ID mới, timestamp phù hợp và nối cuối list; rule mới nối cuối. Không thêm drag-and-drop v1.
3. Editor đủ field theo model: match type/pattern, extensions, MIME, destination, priority, enabled, conflictAction hoặc kế thừa global. Có thể sửa settings matchRedirectedUrl và defaultConflictAction; mặc định conflict là uniquify.
4. UI validation hiển thị lỗi gần field; background vẫn validate lại trước ghi. Disable thao tác lặp khi đang chờ ghi; lỗi ghi phải giữ nội dung đang sửa và cho thử lại, không thông báo success giả.
5. Rule tester nhận original URL, finalUrl tùy chọn, basename và MIME tùy chọn. Dùng cùng DownloadInput, normalizer, matcher/filter/path validator như background. Thiếu input của filter đang bật thì báo chưa đủ dữ liệu; không đoán từ URL.
6. Tester cho biết rule được chọn match hay không, matchedUrl, relative target hoặc lý do fail; không hứa đây là winner của cả danh sách khi chỉ đang test một rule.
7. Dùng label cho form, bàn phím để đi hết thao tác, focus rõ và thông báo lỗi đọc được; render dữ liệu rule như text, không thực thi HTML trong tên/pattern/destination.

### Đầu ra bắt buộc

- Options UI dùng được mà không sửa JSON; quản lý rule/settings đầy đủ.
- Rule tester dùng pipeline chung; suite parity dùng lại fixture core/background.
- Quy trình CRUD, validation, save failure và keyboard trong docs/TESTING.md; docs/RULES.md phản ánh đúng UI.

### Hạng mục kiểm thử

| TEST-ID | Cấp/nhóm | Nguồn PLAN | Đầu vào/thao tác | Kết quả cần chứng minh |
|---|---|---|---|---|
| TEST-DR-P3-01 | E2E/E | §15–16, §9 | Tạo, edit, duplicate, disable/enable, delete rồi reload options và tải | Dữ liệu bền; ID/order đúng; download phản ánh thay đổi đã lưu |
| TEST-DR-P3-02 | integration/I, E2E/E | §8, §12, §16, §21 | Pattern/destination/priority lỗi; tên rule chứa markup | Có lỗi rõ; không ghi cấu hình sai; markup hiển thị như text |
| TEST-DR-P3-03 | unit/U, integration/I | §7, §16 | Cùng fixture filename/MIME/redirect chạy qua tester và background pipeline | Kết quả match, matchedUrl và relative path giống nhau với input đầy đủ |
| TEST-DR-P3-04 | E2E/E | §16 | Chỉ nhập URL /download/123 khi filter PDF/MIME đang bật, sau đó bổ sung report.pdf và application/pdf | Ban đầu báo input thiếu; sau bổ sung cho kết quả đúng; không đoán basename/MIME |
| TEST-DR-P3-05 | integration/I, E2E/E | §18, §22 | Save bị reject, bấm Save lặp, Cancel bản sửa chưa lưu | Không success giả hoặc ghi trùng; dữ liệu đã lưu không mất; nội dung sửa được giữ khi lỗi và Cancel không mutate |
| TEST-DR-P3-06 | E2E/E | §15–16 | Đi form bằng Tab/Shift+Tab, thao tác nút bằng bàn phím, nhập field sai | Focus/label rõ; lỗi nhận biết được; CRUD không bắt buộc dùng chuột |
| TEST-DR-P3-07 | integration/I, E2E/E | §7, §10, §14–16 | Đổi redirect setting/global conflict; rule kế thừa và rule override | UI và download áp dụng đúng setting; override không bị global thay thế |

Asset dự kiến: tests/unit/rule-tester.test.ts, options integration suite nếu có logic lưu/trạng thái phức tạp, và biên bản E2E cho UI thật. Không bắt buộc viết unit test soi từng thẻ DOM; ưu tiên parity và luồng ghi có lỗi.

### DoD và điều kiện chuyển phase

- [x] DoD chung đạt; P3-01–07 covered; các mutation dùng writer Phase 2.
- [x] Toàn bộ CRUD/settings dùng được qua UI; không cần sửa storage thủ công.
- [x] Tester parity có assertion tự động; keyboard, render dữ liệu và tải theo rule mới có kiểm tra Chrome thật.
- [x] Hiển thị rõ việc list order phân xử hòa priority; core coverage không bị giảm bởi thêm UI.

Nghiệm thu 2026-10-15: 331/331 tests, 15 files; core lines 100%, branches 98,27%; Chromium 149 headless đạt CRUD/settings, tester, quota rejection, double submit, keyboard và conflict trên file thật. Review Phase 2 không có lỗi production chặn chuyển phase; helper E2E được sửa để yêu cầu download ID mới khi overwrite. Evidence và giới hạn: docs/TESTING.md, docs/evidence/phase3-*.json.

## Phase 4 — Popup and User Experience

Nguồn: [PLAN §17 — Popup](PLAN.md#17-popup), [§18 — Persistence](PLAN.md#18-persistence), [§23 — Logging](PLAN.md#23-logging).

### Điều kiện bắt đầu

Phase 3 done; rule/settings hoạt động qua UI và có cơ chế phản ánh storage thay đổi.

### Công việc và yêu cầu chi tiết

1. Popup có toggle global, số rule enabled/tổng số, routing event gần nhất và nút mở options; không thêm editor rule vào popup.
2. Đọc trạng thái đã lưu khi mở; cập nhật khi storage thay đổi từ options hoặc mutation khác. Toggle dùng writer hiện hữu, phản ánh lỗi ghi và không để trạng thái UI khẳng định thành công trước khi ghi xong.
3. Lưu tối đa một event gần nhất bằng dữ liệu cục bộ tách khỏi config: thời điểm, rule ID, basename và relative destination đủ cho trạng thái. Không lưu full URL/query/MIME payload tùy tiện; event này không nằm trong export config.
4. Ghi event sau khi đã hoàn tất suggest, không để ghi trạng thái kéo dài/chặn handler hoặc gây suggest lần hai. Event mô tả đề xuất routing, không xác nhận file tải hoàn tất hoặc vị trí cuối cùng khi Chrome/người dùng/extension khác ghi đè lựa chọn.
5. Xử lý trạng thái chưa có event, chưa có rule, đọc lỗi và worker chưa hoạt động; nút Manage Rules và toggle dùng được bằng bàn phím.

### Đầu ra bắt buộc

- Popup dùng được, đồng bộ với options và cấu hình đã lưu.
- Luồng ghi event tối thiểu không ảnh hưởng download; tài liệu giải thích ý nghĩa event.
- Test trạng thái/toggle/event ở mức có logic và biên bản Chrome cho popup thật.

### Hạng mục kiểm thử

| TEST-ID | Cấp/nhóm | Nguồn PLAN | Đầu vào/thao tác | Kết quả cần chứng minh |
|---|---|---|---|---|
| TEST-DR-P4-01 | integration/I, E2E/E | §17–18 | 0 rule, nhiều rule có enabled khác nhau; toggle thành công và set reject | Count đúng; toggle phản ánh cấu hình đã ghi; lỗi không giả thành công |
| TEST-DR-P4-02 | E2E/E | §17–18 | Đổi rule/settings từ options khi popup mở; đóng/mở popup và dừng worker | Popup nhìn thấy dữ liệu hiện hành, không lệ thuộc state JS cũ |
| TEST-DR-P4-03 | unit/U, integration/I | §11, §17, §23 | Route thành công; fallback; ghi event bị lỗi | Chỉ route mới cập nhật event; handler đã hoàn tất một lần trước ghi event; lỗi event không ảnh hưởng download |
| TEST-DR-P4-04 | E2E/E | §17, §21, §23 | Tải URL có query token rồi xem event; chưa có event; mở lại popup | Không lộ token/full URL; trạng thái rỗng rõ; event không bị mô tả là file đã hoàn tất |
| TEST-DR-P4-05 | E2E/E | §17 | Mở Manage Rules và thao tác toggle bằng bàn phím | Mở đúng options; điều khiển có label/focus và thao tác được |

Asset dự kiến: popup integration suite và event tests cạnh download-handler.test.ts; E2E ghi trong docs/TESTING.md. Chạy lại P2-04 khi thêm toggle/event storage để chứng minh không ghi đè config.

### DoD và điều kiện chuyển phase

- [x] DoD chung đạt; P4-01–05 covered; không thêm permission hoặc framework.
- [x] Popup/Options đồng bộ sau thao tác đã ghi; lỗi trạng thái không cản tải.
- [x] Event tối thiểu tách cấu hình, không chứa full URL và không khẳng định tải thành công.

Nghiệm thu 2026-10-15: 358/358 tests, 17 files; core lines 100%, branches 98,27%. Chromium 149 headless đạt popup document và action popup thật qua API/CDP, toggle/count/sync, quota rejection thật, keyboard/focus và popup wake worker đã dừng. Event chỉ bốn field, ghi sau suggest, pending/lỗi không giữ handler. Evidence và giới hạn: docs/TESTING.md, docs/evidence/phase4-*.json.

## Phase 5 — Reliability Regression and Hardening

Nguồn: [PLAN §12–14 — Path/conflict](PLAN.md#12-destination-handling), [§21–25 — Security và testing](PLAN.md#21-security-requirements), [§29 — Risks](PLAN.md#29-risks-and-mitigations).

### Điều kiện bắt đầu

Phase 4 done; các điều kiện reliability ở Phase 0–2 đã đạt. Có UI hoàn chỉnh để chạy hồi quy xuyên suốt.

### Công việc và yêu cầu chi tiết

1. Chạy lại TEST-ID cũ cho completion guard/watchdog, worker cold start, rule/filter/priority, queue mutation, UI parity và popup. Ghi revision mới; không dựa trên kết quả trước khi UI tích hợp.
2. Mở rộng corpus đường dẫn/tên file: slash/backslash, absolute/UNC/drive-relative, traversal, control/NUL, reserved Windows names, Unicode, tên dài và phần mở rộng kép. Tên không được Chrome/platform chấp nhận phải fallback an toàn, không hứa hỗ trợ độ dài chưa kiểm chứng.
3. Thử conflict uniquify/overwrite/prompt và Save As bật/tắt trong profile riêng; dùng nội dung file giả để xác nhận có hay không thay thế. Khi người dùng chọn vị trí khác/hủy, ghi đúng hành vi Chrome.
4. Kiểm tra config envelope hỏng, một rule hỏng, version không hỗ trợ, storage rejection và queue sau lỗi; giữ dữ liệu gốc. Khôi phục bằng import sau Phase 6 sẽ được kiểm tra tiếp, không đánh dấu đã kiểm chứng ở bước này.
5. Thử regex adversarial và tải liên tiếp với bộ dữ liệu đại diện 200 rule, URL/pattern trong giới hạn. Ghi thời gian cold/warm, số lượt, p50/p95/max, môi trường, có hay không fallback watchdog. Download bình thường trong fixture không được cần watchdog để hoàn tất; timer không phải bằng chứng regex đã được ngắt.
6. Rà production bundle/runtime: không remote executable/eval, không request mạng phục vụ routing, không telemetry, không log full URL/token. Log/error không được trở thành nguyên nhân handler không hoàn tất.
7. Kiểm tra tương tác với extension đổi tên file khác nếu có môi trường thử; ghi giới hạn tương thích. Nếu chưa thử được, ghi unverified, không tự cài extension ngoài phạm vi hoặc coi giới hạn đó là đã đạt.

### Đầu ra bắt buộc

- Corpus regression dùng chung, ca test cho lỗi thực phát hiện, báo cáo Chrome/conflict và hiệu năng trong docs/TESTING.md.
- Log production giới hạn WARN/ERROR; dữ liệu nhạy cảm được loại bỏ. Chưa cần ring buffer/history 50–100 event nếu không phục vụ yêu cầu v1.
- Danh sách known limitations phân biệt giới hạn platform đã quan sát và hành vi còn chưa kiểm chứng; không mở thêm migration framework.

### Hạng mục kiểm thử

| TEST-ID | Cấp/nhóm | Nguồn PLAN | Đầu vào/thao tác | Kết quả cần chứng minh |
|---|---|---|---|---|
| TEST-DR-P5-01 | unit/U, E2E/E | §12–13, §21 | Corpus path/filename nguy hiểm và Unicode/tên dài hợp lệ trên OS mục tiêu | Không vượt Downloads; trường hợp từ chối fallback; file hợp lệ có đúng basename và thư mục |
| TEST-DR-P5-02 | E2E/E | §14, §25 | File giả trùng tên/nội dung khác; lần lượt uniquify, overwrite, prompt và Save As | Uniquify giữ file cũ; overwrite chỉ với rule đã chọn; prompt/user cancel và Save As có bằng chứng đúng thực tế |
| TEST-DR-P5-03 | integration/I, E2E/E | §18–19, §22 | Config hỏng/unknown version, nhiều download, lỗi ghi rồi mutation tiếp theo | Không auto reset; valid rule còn hoạt động nếu envelope hợp lệ; lỗi không lan sang invocation/queue sau |
| TEST-DR-P5-04 | unit/U, integration/I | §8.4, §9, §24 | Adversarial regex, 200 rule; input ở biên; chạy cold/warm trên máy được ghi nhận | Engine và giới hạn chặn công việc không giới hạn; có số đo; fixture bình thường không phải chờ watchdog |
| TEST-DR-P5-05 | integration/I, E2E/E | §21, §23 | URL có token, validation error có dữ liệu nhạy cảm, routing và popup trong production build | Không full URL/token trong log/event; không network/telemetry phục vụ routing; handler không chờ logger |
| TEST-DR-P5-06 | E2E/E | §25, §29 | Save As và extension khác cùng đề xuất filename, hoặc ghi rõ môi trường không có extension đó | UI/tài liệu không hứa final location do extension kiểm soát tuyệt đối; phần chưa thử giữ unverified và có manual exit |

Asset: mở rộng path/regex/repository tests đã có; thêm suite integration cho production privacy nếu cần; Chrome/conflict ghi biên bản. Chạy lại P0-02–07, P1-01–08, P2-01–07, P3-03/05/07 và P4-01–04; đây là hồi quy các TEST-ID cũ, không tạo test code trùng.

### DoD và điều kiện chuyển phase

- [x] DoD chung đạt; P5-01–05 covered và hồi quy liên quan đạt trên revision hiện tại.
- [x] P5-06 có bằng chứng hoặc manual exit rõ giới hạn chưa xác minh, cách kiểm tra và nơi tài liệu hóa; không ghi covered cho nhánh chưa chạy.
- [x] Có kiểm tra Chrome/filesystem thật cho conflict và basename; coverage không thay cho việc này.
- [x] Mỗi lỗi mới có ca hồi quy; không còn lỗi gây mất dữ liệu, treo download hoặc định tuyến sai chưa xử lý.
- [x] Báo cáo hiệu năng có số đo, không chỉ ghi “nhanh”; nếu workload đại diện liên tục timeout thì chưa done.

Nghiệm thu 2026-10-15: 401/401 tests, 18 files; core lines 100%, branches 98,27%. Chromium 149 đạt regression Phase 0–5, corpus basename và uniquify/overwrite nội dung khác nhau. Bốn ca prompt/Save As do người dùng thao tác, script kiểm chứng history/content/hash và Cancel trả USER_CANCELED. 200-rule Node warm p95 6,56 ms (mixed) / 272,73 ms (200 adversarial regex); Chromium 5 cold + 20 warm đúng đích, không watchdog fallback. Logger throw được cô lập và có ca hồi quy. P5-06 vẫn unverified với manual exit cho extension khác; không coi đó là covered. Evidence: docs/TESTING.md, docs/evidence/phase5-*.json, .test-artifacts/benchmarks/phase5-*.json.

## Phase 6 — Configuration Portability

Nguồn: [PLAN §18–20 — Cấu hình và import/export](PLAN.md#18-persistence), [§9 — Thứ tự rule](PLAN.md#9-matching-pipeline).

### Điều kiện bắt đầu

Phase 5 done; writer tuần tự, schema và dữ liệu hiện hành có test bảo toàn. Có profile/config thử để kiểm tra thay thế mà không động dữ liệu thật.

### Công việc và yêu cầu chi tiết

1. Export trực tiếp canonical ExtensionConfig với root configVersion: 1. Không thêm version thứ hai, metadata envelope, event/log hoặc dữ liệu browsing. Dùng một snapshot nhất quán cho mỗi export.
2. Import JSON tối đa 16 MiB UTF-8, kiểm tra File.size trước đọc và byte size trước parse. Qua schema và rule validator dùng chung: kiểm tra settings, version, mọi rule, ID không rỗng/không trùng, pattern/regex limit, destination, priority, timestamp và enum; reject field lạ. Bất kỳ entry sai thì reject toàn bộ import, khác chính sách bỏ qua rule hỏng khi runtime load.
3. Import v1 là thay thế toàn bộ settings/rules sau preview và xác nhận rõ. Preview thể hiện số rule sẽ thay và setting thay đổi; cancel không ghi gì. Không merge, không tự sửa version hoặc migrate format chưa hỗ trợ.
4. Giữ nguyên rule ID, timestamp và array order. Config export/import phải cho cùng quyết định routing, gồm tie-break và conflict inheritance.
5. Khi confirm, đưa kiểm tra snapshot preview và thao tác ghi vào cùng hàng đợi mutation. Nếu config đã đổi, yêu cầu preview mới; không dùng lần kiểm tra bên ngoài queue làm bảo đảm duy nhất.
6. Commit bằng một set được await; không clear/reset trước, không báo success sớm. Write reject phải giữ cấu hình cũ usable và hiện lỗi cho người dùng.
7. Sau commit, options/popup cập nhật; download mới dùng snapshot mới. Kiểm tra thay thế trên config đang tồn tại và khôi phục từ profile thử sạch; không dùng reset/remove như một bước của implementation import.

### Đầu ra bắt buộc

- Export/import UI, preview/cancel/confirm và kết quả lỗi rõ ràng.
- tests/unit/import-export.test.ts, contract test cho serialized config và integration test stale-preview/write failure.
- Cấu hình fixture round-trip và hướng dẫn backup/restore trong README/docs/TESTING.md.

### Hạng mục kiểm thử

| TEST-ID | Cấp/nhóm | Nguồn PLAN | Đầu vào/thao tác | Kết quả cần chứng minh |
|---|---|---|---|---|
| TEST-DR-P6-01 | unit/U, contract/C | §7, §18–20 | Export rồi import config có equal-priority rules, timestamps, rule inheritance/override | Schema storage/export giống nhau; ID/order/timestamp/settings và routing decisions tương đương |
| TEST-DR-P6-02 | unit/U | §19–20 | JSON hỏng, version thiếu/cũ/mới, field sai kiểu, enum/priority/timestamp lỗi | Reject trước ghi; không migrate/downgrade/ghi defaults |
| TEST-DR-P6-03 | unit/U, integration/I | §8.4, §12, §20 | Một rule invalid, duplicate/empty ID, regex unsupported, destination nguy hiểm | Toàn import bị từ chối; không âm thầm loại rule để nhận phần còn lại |
| TEST-DR-P6-04 | integration/I, E2E/E | §20 | Xem preview, cancel, chọn file khác rồi cancel | Không mutation; old config và download behavior giữ nguyên |
| TEST-DR-P6-05 | integration/I | §18, §20 | Preview A; queue toggle/edit làm đổi config trước commit; confirm A | Kiểm tra trong queue bắt stale snapshot, không overwrite; yêu cầu preview mới |
| TEST-DR-P6-06 | integration/I | §18, §20 | Storage set reject khi import đã confirm | UI báo lỗi; old config usable; không clear/reset, không thông báo thành công |
| TEST-DR-P6-07 | E2E/E | §20, §25 | Export từ UI, sửa config thử, import replacement; tải lại; lặp trên profile thử sạch | Khôi phục chính xác, options/popup đồng bộ và file thật đi theo rule đã khôi phục |

Asset: P6-01–06 trong tests/unit/import-export.test.ts (core, message, repository integration cùng Chrome mock boundary); fixture tests/fixtures/portable-config.json. scripts/import-export-e2e.mjs kiểm tra P6-01–07 trên Chrome thật và filesystem, gồm profile sạch. Đã chạy lại P1-06/08, P2-04/05, P3-05 và P4-01/02 trong full regression.

### DoD và điều kiện chuyển phase

- [x] DoD chung đạt; P6-01–07 covered, gồm biên bản export/import UI thật.
- [x] Round-trip được kiểm tra cả shape dữ liệu và quyết định routing; không chỉ so số rule.
- [x] Preview/cancel/stale-preview/write failure không làm mất dữ liệu cũ.
- [x] Không export event/log, không merge hoặc migration giả định; docs khớp chính sách thay thế v1.

Nghiệm thu 2026-10-15: 466/466 tests, 19 files; core lines 100%, branches 98,54%. Chromium 149 đạt regression Phase 0–6, export JSON thật, cancel không đổi hành vi tải, actual quota rejection giữ config usable và explicit retry thành công; mất reply sau commit không tự retry. Backup khôi phục exact settings/ID/timestamps/order và tải thật trong profile hiện hữu lẫn mới; popup đồng bộ. Preview SHA-256 được kiểm tra trong shared queue sau writer đang pending. Evidence docs/evidence/phase6-*.json và biên bản docs/TESTING.md. P5-06 giữ manual exit/unverified; Phase 7 chưa thực hiện.

## Phase 7 — Release Preparation

Nguồn: [PLAN §26 — Phase 7](PLAN.md#26-development-phases), [§28 — Definition of Done](PLAN.md#28-definition-of-done), [§29 — Risks](PLAN.md#29-risks-and-mitigations).

### Điều kiện bắt đầu

Phase 0–6 done, các manual exit được ghi rõ. Có revision ứng viên phát hành và profile thử dùng riêng.

### Công việc và yêu cầu chi tiết

1. Từ checkout sạch ở revision ứng viên, cài theo lockfile, chạy toàn bộ quality commands và build production. Khi chưa được yêu cầu commit, dùng source snapshot riêng không chứa build/dependency/cache, lưu danh sách SHA-256 và base commit để xác định đúng revision chưa commit. Không nghiệm thu dựa vào dist cũ hoặc file sửa tay sau build.
2. Load đúng artifact production vào profile mới; thực hiện luồng tạo rule → download → worker cold start → toggle → export/import → download lại. Đối chiếu actual saved path/content bằng fixture thật.
3. Kiểm tra upgrade/reload extension ở profile thử đã có dữ liệu: rule/settings không reset, schema được bảo toàn. Backup config trước khi thử; không kiểm tra bằng dữ liệu thật.
4. Hoàn thiện README, docs/ARCHITECTURE.md, docs/RULES.md, docs/TESTING.md và CHANGELOG.md: cài/reload, cấu hình, giới hạn Downloads, cú pháp regex được chọn, Save As/extension conflict, backup/restore và cách chạy test.
5. Rà manifest, dist, dependency/license của engine và tài nguyên đóng gói: executable code cục bộ, không token/secrets/test payload riêng tư; không đưa fixture server/node_modules thành thành phần extension vận hành.
6. Chốt v1.0.0, giữ artifact cùng commit/build info và ghi release checklist đã đối chiếu từng mục PLAN §28. Không bắt buộc Chrome Web Store, publish, tag hay push trong công việc chuẩn bị phát hành này.

### Đầu ra bắt buộc

- Production dist có thể load unpacked trên môi trường đã ghi nhận, gắn với revision và phiên bản v1.0.0.
- Bộ tài liệu sử dụng/kiến trúc/quy tắc/kiểm thử/changelog đầy đủ; known limitations có bằng chứng hoặc trạng thái chưa kiểm chứng rõ ràng.
- Biên bản release chứa lệnh/exit code, coverage core, kết quả E2E, TEST-ID, manual exit và rủi ro còn lại. Không có giá trị pass giả hoặc placeholder được coi là bằng chứng.

### Hạng mục kiểm thử

| TEST-ID | Cấp/nhóm | Nguồn PLAN | Đầu vào/thao tác | Kết quả cần chứng minh |
|---|---|---|---|---|
| TEST-DR-P7-01 | smoke/S, E2E/E | §26–28 | Cài/build từ checkout sạch; load production artifact trong profile mới | Lệnh chạy đạt, entry/CSP/permission đúng; thao tác chính không lệ thuộc dev server |
| TEST-DR-P7-02 | E2E/E | §11, §15–20, §28 | Luồng tạo rule → tải → cold worker → toggle → export/import → tải lại | Trải nghiệm v1 dùng được không sửa JSON; file thật và config đúng đặc tả |
| TEST-DR-P7-03 | E2E/E | §18–19, §28 | Reload/update bản unpacked trong profile thử có rule/settings | Dữ liệu không reset; routing sau reload nhất quán; config cũ còn usable |
| TEST-DR-P7-04 | smoke/S | §21, §26, §28 | Kiểm tra manifest/dist/license và làm lại hướng dẫn README từ đầu | Chỉ quyền yêu cầu, không remote code/secrets/runtime backend; hướng dẫn cài và giới hạn đúng artifact |
| TEST-DR-P7-05 | integration/I, smoke/S | §24, §28 | Đối chiếu release checklist với TEST-ID và evidence ở revision phát hành | Mọi chức năng bắt buộc có bằng chứng; coverage core ≥ 90%; phần chưa thử không bị ghi covered |

Asset: standard suite đã có; không thêm một suite test trùng toàn bộ logic chỉ vì release. P7-01–04 có biên bản trên artifact production, P7-05 là đối chiếu có lưu kết quả trong docs/TESTING.md.

### DoD và điều kiện phát hành

- [x] DoD chung và toàn bộ checklist v1 trong PLAN §28 đạt trên artifact ứng viên.
- [x] P7-01–05 covered; regression của các module bị sửa sau Phase 6 đã chạy lại.
- [x] Người dùng cài và quản lý rule/backup bằng UI theo tài liệu; không cần môi trường phát triển để extension hoạt động sau build.
- [x] Không còn lỗi có thể gây mất dữ liệu, chặn download, path không an toàn hoặc routing trái đặc tả; giới hạn platform được ghi rõ.
- [x] Revision, artifact, kết quả kiểm thử, dependency decision và known limitations đã liên kết được với nhau. Việc upload/publish là bước riêng nếu sau này được yêu cầu.

Nghiệm thu 2026-10-15: v1.0.0; `pnpm release:prepare` exit 0 từ source snapshot sạch được định danh bằng base commit + source SHA-256, không tự commit working tree. Frozen install/lockfile unchanged, typecheck/lint/format/466 tests/coverage/build/Chromium Phase 0–7 đều đạt. UI workflow, reload và nâng cấp artifact 0.1.0 trong cùng profile bảo toàn exact config và actual download. P5-06 có baseline và hai lượt concurrent suggest bằng addon fixture thật, không hứa winner. ZIP chỉ production files, giải nén khớp hash; build lần hai tái lập đúng mọi file. Evidence `docs/evidence/phase7-*.json`; packagePath/hash và source provenance ở phase7-release.json. Giới hạn: Chrome 120 binary, natural idle, screen reader, mọi path dài, addon bên thứ ba thực tế và native Save As trên 1.0.0 chưa thử; bằng chứng native Phase 5 được giữ lịch sử. Không publish/tag/push.

## 3. Mẫu biên bản bàn giao một phase

Ghi trong docs/TESTING.md khi bắt đầu có triển khai; có thể dùng một mục cho mỗi phase thay vì tạo nhiều file quản trị.

| Trường | Nội dung cần điền khi thực hiện |
|---|---|
| Phase / revision | Số phase; commit hoặc mô tả working tree nếu chưa commit |
| Người thực hiện / ngày | Tên người thực hiện, ngày và múi giờ |
| Môi trường | OS, Chrome, Node, pnpm; profile/thư mục tải thử |
| Phạm vi | Yêu cầu PLAN và TEST-ID đã xử lý; caller/module chịu tác động |
| Đầu ra | File/module và artifact thực tế; khác biệt với dự kiến nếu có |
| Test tự động | TEST-ID, test file/node, lệnh thật, exit code, assertion quan trọng và nơi lưu output |
| Test Chrome/manual | TEST-ID, bước tái hiện, fixture, đường dẫn/content file thật, ảnh/output quan sát nếu cần |
| Coverage/hiệu năng | Metric, phạm vi file/workload, ngưỡng áp dụng và số đo; chưa đo phải ghi chưa đo |
| Gap/manual exit | TEST-ID, phần chưa kiểm chứng, lý do, giới hạn, bước kiểm tra tiếp và người chịu trách nhiệm |
| Lỗi và hồi quy | Lỗi mới, TEST-ID bảo vệ và bằng chứng trước/sau sửa nếu có |
| Kết luận | done khi mọi điều kiện đạt; nếu không, in_progress/blocked cùng việc còn lại |

## 4. Ánh xạ bảy rủi ro đã review

| Rủi ro/điểm thiếu | Phase xử lý đầu tiên | TEST-ID bảo vệ chính |
|---|---|---|
| Listener bất đồng bộ không hoàn tất hoặc gọi lặp | 0 | TEST-DR-P0-04, TEST-DR-P0-05 |
| Regex hợp lệ gây nghẽn | 0, hoàn thiện ở 1 | TEST-DR-P0-07, TEST-DR-P1-04, TEST-DR-P5-04 |
| Ghép absolute filename vào destination | 0, hoàn thiện ở 1 | TEST-DR-P0-06, TEST-DR-P1-07, TEST-DR-P5-01 |
| Worker cold start được kiểm tra quá muộn | 0 | TEST-DR-P0-03, TEST-DR-P2-06 |
| Hòa priority/URL nguồn không rõ | 1 | TEST-DR-P1-06, TEST-DR-P6-01 |
| Schema và import có nguy cơ mất dữ liệu | 1–2, import ở 6 | TEST-DR-P1-08, TEST-DR-P2-04, TEST-DR-P6-01–06 |
| Rule tester thiếu filename/MIME/finalUrl | 3 | TEST-DR-P3-03, TEST-DR-P3-04 |

## 5. Cách cập nhật tiến độ

Khi bắt đầu phase, đổi đúng một dòng trong bảng tiến độ thành in_progress. Khi thêm test, cập nhật ánh xạ asset và trạng thái TEST-ID trong biên bản; không đổi toàn bộ test sang covered theo trạng thái phase. Khi hoàn tất, đính kèm biên bản có bằng chứng và kiểm lại DoD trước khi đổi done. Nếu thay đổi một hợp đồng đã nghiệm thu, chạy lại TEST-ID bị tác động ở các phase sau và cập nhật bằng chứng cho revision mới.

Tại thời điểm tạo tài liệu chưa có phase nào được nghiệm thu. Cập nhật cuối 2026-10-15: Phase 0–7 hoàn tất cho v1.0.0 dùng cá nhân/load unpacked; 52/52 TEST-ID covered trong boundary nêu rõ, 466 tests, core lines 100%, release ZIP và source/build hashes có bằng chứng. P5-06 trước đây manual exit được bổ sung fixture concurrent-extension thật ở Phase 7; native dialog Phase 5 không bị đổi provenance thành lần chạy mới. Các giới hạn môi trường và khả năng chưa kiểm chứng nằm trong docs/TESTING.md. Publish hay chức năng v2 là công việc riêng khi được yêu cầu.
