# Lịch sử triển khai v1

Download Router được triển khai theo tám phase, hoàn tất ngày 2026-10-15. Yêu cầu và DoD gốc nằm trong [PLAN](../planning/PLAN.md) và [workingphase](../planning/workingphase.md); cách làm việc hiện hành nằm trong [TESTING](../TESTING.md) và [ARCHITECTURE](../ARCHITECTURE.md).

## Các mốc kiểm chứng

| Phase | Tests đạt tại mốc | Test files | Core line coverage |
| ----- | ----------------- | ---------- | ------------------ |
| 0     | 59                | 5          | 100%               |
| 1     | 222               | 10         | 100%               |
| 2     | 302               | 13         | 100%               |
| 3     | 331               | 15         | 100%               |
| 4     | 358               | 17         | 100%               |
| 5     | 401               | 18         | 100%               |
| 6     | 466               | 19         | 100%               |
| 7     | 466               | 19         | 100%               |

Đây là kết quả lịch sử tại từng mốc, không phải tám lần chạy trên code hiện tại. Evidence mới nhất được chọn trong [v1.0.0.json](../evidence/v1.0.0.json); raw logs/JSON/profiles giữ cục bộ trong .test-artifacts và không thuộc cây source hiện tại. Không coi raw report cũ là nguồn trạng thái dự án đang chạy.

## Quyết định giữ lại

- Chọn RE2JS 2.8.6 đóng gói local, không native regex fallback hoặc remote executable; license MIT đi cùng artifact.
- Giữ duy nhất schema configVersion 1 và writer queue; runtime có thể bỏ qua từng rule lỗi trong memory, save/import phải strict. Không reset config lỗi hay version chưa hỗ trợ.
- Chrome download behavior trong E2E dùng default; automation allow/allowAndName đã bỏ qua filename hook trong thực nghiệm.
- Cold worker dùng CDP stopped-state và file thật; không suy việc worker restart từ target ID vì Chromium có thể tái sử dụng ID.
- Preview/import kiểm tra SHA-256 raw snapshot trong cùng queue, một awaited set; mất phản hồi không tự retry vì write có thể đã commit.
- Release có source/build/ZIP hashes, kiểm tra giải nén và build lặp lại; không gọi working tree chưa commit là clean Git commit.

## Bằng chứng native và xung đột extension

[Bốn ca native](../evidence/native-dialogs-2026-10-15.json) do người dùng thao tác Save As/Cancel trên profile thử; script kiểm tra complete hoặc USER_CANCELED, content/hash và bảo toàn file cũ. Công cụ điều khiển cửa sổ không đọc được owner mapping nên không tuyên bố đã tự động điều khiển Windows dialog. Ca prompt-choose có chọn thư mục fixture của lượt cũ; đã recheck độc lập và giữ review note.

P5-06 ban đầu có manual exit vì chưa có extension thứ hai. Phase 7 bổ sung addon fixture cục bộ với hai listener suggest thật, baseline và hai requested load orders; Chrome tải hoàn tất và filename cuối thay đổi theo lượt. Điều này đóng boundary fixture, không chứng nhận mọi addon bên thứ ba. Native evidence vẫn thuộc build cũ; không đổi provenance thành lần chạy mới trên 1.0.0.

## Chuẩn hoá repository — 2026-10-15

- Chuyển kế hoạch vào docs/planning; giữ root cho entry docs/config. Đổi runner Phase 0 thành scripts/e2e.mjs và gom kịch bản browser trong scripts/e2e. TEST-ID và assertion được giữ.
- Rút tài liệu kiểm thử về quy trình, boundary và kết quả có thể tái lập; dùng liên kết tương đối để đọc trên GitHub.
- Raw suite JSON, log máy và benchmark sinh tự động được chuyển khỏi cây source vào .test-artifacts. Chỉ giữ portable verification và native summary có source/build fingerprints; không bỏ test hoặc giảm coverage để dọn repository.
- Các script/report tên cũ, .ecc/benchmarks và root PLAN.md/workingphase.md không nên được tạo lại; dùng cấu trúc mới. Raw archive không được dựng lại như source.

## Giới hạn

Chưa kiểm chứng binary Chrome 120, natural idle shutdown, screen reader, mọi full path dài, addon thực tế ngoài fixture và native Save As trên build hiện tại. Test pass không biến các nhánh này thành covered. Không có Chrome Web Store publication hoặc schema migration trong phạm vi v1.
