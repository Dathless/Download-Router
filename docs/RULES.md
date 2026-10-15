# Quy tắc định tuyến — Phase 3

Nguồn chức năng: [PLAN](planning/PLAN.md) §7–16. Model ở `src/models/config.ts`; validator, matcher và pipeline ở `src/core/`. Background và options rule tester dùng cùng pipeline; UI không có matcher/filter riêng.

## Cấu hình và validation

Config có đúng một version ở root: `{ configVersion: 1, settings, rules }`, lưu dưới key `config`. Settings gồm `enabled`, `matchRedirectedUrl`, `defaultConflictAction`. Rule có ID/name không rỗng, enabled boolean, match, destination, priority safe integer, timestamps hữu hạn không âm và conflictAction tùy chọn.

`parseConfig(value, 'strict')` từ chối toàn bộ nếu một rule sai hoặc ID trùng; dùng cùng API này cho save/import về sau. `parseConfig(value)` là chế độ runtime: envelope/settings/version sai thì throw; rule sai hoặc ID trùng bị bỏ qua trong bộ nhớ, giữ rule hợp lệ xuất hiện trước. Không sửa/xóa dữ liệu đã lưu. Cả hai chế độ compile pattern bằng cùng matcher/RE2JS.

`parseDownloadInput` nhận URL gốc, finalUrl tùy chọn, basename hợp lệ và MIME. MIME không được cung cấp trở thành chuỗi rỗng; không đoán từ URL hoặc extension. URL sai cú pháp vẫn được chuyển tới normalizer để một candidate sai không làm mất candidate còn lại. Giá trị sai kiểu hoặc basename sai bị từ chối.

## URL candidates

Chỉ URL HTTP(S) hợp lệ đi vào matching. Dùng `URL` API, hostname/scheme theo canonicalization của API, bỏ fragment. Giữ nguyên thứ tự query và ý nghĩa path; `%2F` vẫn là encoded separator, không decode toàn URL. Default port và dot segments theo semantics chuẩn của `URL`.

Xét original trước. Nếu `matchRedirectedUrl = true`, thêm finalUrl hợp lệ, khác original sau chuẩn hóa. Tắt setting thì chỉ xét original. Một candidate hỏng không loại candidate hợp lệ còn lại. `matchedUrl` trong kết quả là URL đã chuẩn hóa của candidate thắng.

## Bốn matcher

| Type   | Pattern mẫu                                 | Hành vi                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain | `github.com`                                | Exact parsed hostname, không phân biệt hoa/thường; không tự gồm `api.github.com`. Pattern chỉ hostname canonical (ASCII/punycode hoặc IPv6 trong ngoặc vuông), không scheme, port, path hoặc wildcard. Port của candidate không ảnh hưởng domain match. |
| prefix | `https://example.com/releases/`             | Chuẩn hóa pattern như URL rồi so sánh prefix với URL candidate đầy đủ. Path/query phân biệt hoa/thường. Thứ tự query có ý nghĩa; fragment không có ý nghĩa.                                                                                             |
| glob   | `https://*.example.com/files/*.pdf`         | So riêng scheme, hostname, port và path; bỏ query/fragment của candidate. `*` trong host chỉ chạy trong host; `*.example.com` gồm subdomain nhiều cấp, không gồm apex. `*` trong path gồm cả `/` và có thể khớp rỗng.                                   |
| regex  | `^https://example[.]com/releases/.*[.]zip$` | RE2JS `matcher.find()` trên URL chuẩn hóa đầy đủ: tìm substring nếu không có anchor. Không dùng native RegExp cho pattern này.                                                                                                                          |

Glob cần scheme `http://` hoặc `https://` cụ thể, hostname và `/path`. Port nếu có phải là port literal hợp lệ. Không hỗ trợ wildcard scheme/port, userinfo, query hoặc fragment trong pattern, hay backslash. Ngoài `*`, ký tự path được so literal sau URL normalization: `+`, `.`, `[x]`, `{a,b}` không trở thành regex, character class hoặc alternation. `?` không phải glob wildcard. Hai dấu `*` liên tiếp vẫn chỉ là wildcard thường.

Regex dùng **RE2JS 2.8.6**, compile với flags mặc định; v1 không có tham số flags riêng. Cú pháp inline của RE2JS thuộc pattern; không có tùy chọn native `g/i/m` trong model. Lookaround và backreference không hỗ trợ, pattern sai bị từ chối. Không có fallback sang native engine.

Pattern regex dài 1–256 **UTF-16 code units**; phép đo là `String.length`. Candidate URL được đo **sau chuẩn hóa**, tối đa 8.192 code units. URL dài hơn chỉ bỏ qua phép regex tương ứng, vẫn xét candidate khác và các rule khác. Kết quả có `regexInputTooLong: true` nếu có phép regex bị bỏ qua, để rule tester sau này hiển thị lý do. Giới hạn này áp dụng cả khi cuối cùng một rule khác vẫn match.

## Filters

- Extension đọc từ basename Chrome cung cấp; `report.PDF` vẫn qua filter `pdf`, `.pdf` hoặc `..pdf`. Chỉ bỏ các dấu chấm đầu của filter khi so sánh, không sửa config gốc. So suffix đầy đủ, không phân biệt hoa/thường: `tar.gz` khớp `archive.TAR.GZ`, không khớp `archive.notar.gz` hoặc `archive.tar.gz.exe`.
- Extension entry phải là suffix filename hợp lệ, không rỗng sau khi bỏ dấu chấm đầu, không separator/control/ký tự bị cấm. `report.pdf` vẫn có thể đến từ URL `/download/123`.
- MIME so exact không phân biệt hoa/thường. Entry phải là `type/subtype`, không wildcard hoặc parameters. `application/pdf` không khớp MIME thiếu, `text/plain` hay `application/pdf; charset=utf-8`. Không đoán metadata thiếu.
- List thiếu hoặc rỗng không giới hạn. Trong từng list là OR; giữa extension, MIME và URL matcher là AND.

## Chọn winner và conflict action

Chỉ xét rule enabled và hợp lệ. Duyệt theo thứ tự array, giữ một winner có priority lớn nhất; hòa thì giữ rule đứng trước. Priority âm vẫn hợp lệ nếu là safe integer. Original URL không có quyền ưu tiên hơn rule match finalUrl. Nếu cùng một rule match cả hai, trả original làm `matchedUrl`.

`matchRule(input, config)` trả `MatchResult`: `matched: false` kèm engine reason, hoặc `matched: true` kèm `rule`, `matchedUrl`, `conflictAction`; diagnostic regex là tùy chọn. Config truyền vào phải qua validator dùng chung; engine vẫn tự bảo vệ trước từng rule hỏng. Rule tester dùng chính engine này với danh sách chỉ chứa rule đang thử. Failure reason gồm disabled, invalid input/URL/rule, extension filter, MIME filter, URL pattern và regex input quá dài. Với cả danh sách, reason là diagnostic của rule được xét sau cùng (ưu tiên diagnostic oversized regex khi có), không phải trace của mọi rule.

Conflict action lấy từ rule nếu có, nếu không lấy `settings.defaultConflictAction`. Các giá trị hợp lệ: `uniquify`, `overwrite`, `prompt`; seed mới dùng `uniquify`. Core không thao tác filesystem. Chrome quyết định cuối cùng về Save As, conflict và vị trí lưu.

## Destination và basename

`buildPath` chỉ ghép destination hợp lệ với basename hợp lệ, rồi kiểm tra lại toàn bộ relative path. Chuẩn hóa `\` thành `/`; từ chối absolute/drive/UNC/device path, `~` đầu đường dẫn, `.`/`..`, segment rỗng hoặc separator ở cuối. Không trim hay sanitize để âm thầm đổi đích.

Mỗi component dài 1–255 UTF-16 code units. Từ chối control U+0000–001F và U+007F–009F, `< > : " / \ | ? *`, dấu chấm/space cuối, tên thiết bị Windows không phân biệt hoa/thường (kể cả có extension hoặc khoảng trắng trước extension). Ví dụ: `CON`, `NUL.txt`, `COM¹`, `LPT³.log`, `con .txt`. Unicode, space có ý nghĩa, dấu chấm đầu và punctuation hợp lệ được giữ nguyên. Không URL-decode filename.

Đường dẫn đầy đủ phụ thuộc Downloads root và filesystem của Chrome; validator không hứa quyền truy cập tùy ý hay bảo đảm mọi giới hạn filesystem bên ngoài. Khi không tạo được suggestion hợp lệ, handler dùng `suggest()` không đối số.

## Editor và tester trong options

Danh sách giữ thứ tự lưu và thể hiện số thứ tự để giải thích hòa priority. Tạo/nhân bản nối cuối; sửa giữ vị trí/ID/createdAt. Các nút Sửa, Nhân bản, Bật/Tắt và Xóa dùng mutation API của background. Editor inline đủ matcher/pattern, tên, enabled, destination, priority, filters và conflict action kế thừa/override; không có drag-and-drop.

UI tách danh sách filter bằng dấu phẩy, trim khoảng trắng quanh từng entry để nhập thuận tiện. List để trống không giới hạn; entry rỗng bên trong như `pdf,,zip` bị báo lỗi. Destination không trim/sanitize để âm thầm đổi đích. Pattern và filters dùng cùng validator core, lỗi hiển thị gần field; background vẫn kiểm tra lại toàn config trước ghi.

Test trong editor dùng bản sửa chưa lưu và **settings đã lưu**, không thay config hoặc tạo download. Cần basename Chrome để tính relative target. Nếu có MIME filter, thiếu MIME trả incomplete; không suy filename/MIME từ URL. Kết quả match hiển thị normalized matchedUrl, `Downloads/<relative path>`, conflict action; no-match dùng engine reason. Một regex candidate quá dài không ngăn candidate khác match và được báo riêng. Đổi rule/input/settings làm kết quả cũ mất hiệu lực, cần chạy lại.

Save chỉ gửi field thực sự đổi; không chép nguyên snapshot editor cũ để ghi đè các field vừa đổi ở trang khác. Ghi lỗi giữ nguyên draft; Save bị khóa trong lúc pending, Cancel/Escape không ghi. Channel lỗi không đủ chứng minh write chưa commit: UI yêu cầu đọc lại config trước khi lưu lại. Khi trigger focus đã bị xóa, Cancel trở về nút Thêm rule. Markup trong dữ liệu được hiển thị bằng text, không trở thành HTML.

## Rule trong bản sao JSON

Export/import dùng cùng schema `configVersion: 1` và các validator ở trên. Bản sao giữ ID/timestamps, optional filters/conflict action và thứ tự array; không trim pattern/destination hoặc sort lại rule. Import reject toàn bộ nếu có một rule lỗi, ID trùng/rỗng hay field ngoài model (kể cả regex flags). Runtime vẫn bỏ qua từng rule hỏng trong bộ nhớ; đây là chính sách khác với nhập file. Luồng preview/confirm và bảo vệ snapshot: [ARCHITECTURE.md](ARCHITECTURE.md); cách dùng: [README.md](../README.md).

## Nguồn kỹ thuật

- [RE2 syntax](https://github.com/google/re2/wiki/Syntax): nền tảng cú pháp; bản RE2JS cài trong lockfile và các test runtime là căn cứ thực thi của dự án.
- [Windows file naming](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file): reserved characters, device names và trailing dot/space. Dự án còn chủ động từ chối C1 control characters.

Kiểm thử core theo `TEST-DR-P1-01`–`08`, UI/tester theo `TEST-DR-P3-01`–`07`; evidence và giới hạn môi trường nằm trong `docs/TESTING.md`.
