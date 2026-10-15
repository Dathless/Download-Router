# Changelog

## Unreleased

- Chuẩn hoá root docs, chuyển kế hoạch vào `docs/planning`, tóm tắt lịch sử trong `docs/history` và dùng liên kết tương đối cho GitHub.
- Gom browser suites vào `scripts/e2e`, giữ TEST-ID/assertions; đổi report runner thành `e2e-report.json`.
- Giữ raw logs/profiles/benchmark ở `.test-artifacts`, thay bộ report sinh tự động trong tree hiện tại bằng portable verification và native summary có provenance.
- Chuẩn bị repository với nhánh mặc định `dev`; không thay hợp đồng routing, schema, dependency hoặc permissions.

## 1.0.0 — 2026-10-15

- Định tuyến file tải xuống vào thư mục con Downloads bằng domain, prefix, glob và regex RE2JS đóng gói cục bộ; có extension/MIME filters, priority và thứ tự rule khi hòa.
- Options quản lý rule/settings và tester dùng chung pipeline; popup bật/tắt, đếm rule và hiển thị đề xuất gần nhất.
- Config v1 lưu cục bộ, mutation tuần tự, không tự reset dữ liệu lỗi; import/export JSON có preview, xác nhận và kiểm tra stale snapshot trong queue.
- Handler MV3 hoàn tất đúng một lần, watchdog 1.000 ms, fallback về Chrome; validate destination/basename/toàn relative path và cô lập lỗi storage/logger.
- Chỉ quyền downloads/storage; không backend, telemetry, content scripts hoặc mã thực thi từ xa. RE2JS 2.8.6 theo MIT, license kèm artifact.
- Thêm quy trình source snapshot, frozen install, quality checks, browser regression, upgrade/reload, SHA-256, ZIP và đối chiếu build lặp lại cho phát hành cục bộ.

Giới hạn: chỉ thư mục con Downloads; Chrome/Save As/extension khác quyết định tên và vị trí cuối. Event là đề xuất best effort. Xung đột hai listener đã kiểm tra bằng addon fixture cục bộ (P5-06), không phải chứng nhận mọi extension khác. Natural idle shutdown, screen reader, Chrome 120 thực tế và mọi full path dài chưa kiểm chứng. Bốn ca prompt/Save As Windows có bằng chứng lịch sử Phase 5, không được coi là chạy lại trên build 1.0.0.

Đây là phát hành dùng cá nhân/load unpacked. Không có Chrome Web Store publication, tag hoặc push tự động. Bằng chứng, revision/artifact và phần chưa thử: [docs/TESTING.md](docs/TESTING.md).

## 0.1.0 — nền tảng phát triển

Các Phase 0–6 xây dựng nền tảng Chrome/regex, core, persistence, options, popup, hardening và portability. Báo cáo từng phase giữ nguyên provenance; chúng không thay bằng chứng của build 1.0.0.
