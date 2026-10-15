# Kiến trúc — v1.0.0

Nguồn yêu cầu: [PLAN.md](planning/PLAN.md), [workingphase.md](planning/workingphase.md).

## Luồng đang có

| Trách nhiệm                                        | Vị trí                                                   |
| -------------------------------------------------- | -------------------------------------------------------- |
| Model cấu hình và message                          | [src/models](../src/models)                              |
| Validation, matcher, pipeline, path và portability | [src/core](../src/core)                                  |
| Chrome listener và message dispatch                | [src/background](../src/background)                      |
| Config writer, client và event storage             | [src/storage](../src/storage)                            |
| Form/settings/tester và popup                      | [src/options](../src/options), [src/popup](../src/popup) |
| Regression và fixture                              | [tests](../tests), [scripts/e2e](../scripts/e2e)         |

```text
onDeterminingFilename (listener đồng bộ ở module top level)
  → đọc config mới từ storage.local
  → validator core kiểm tra envelope/version, lọc rule hợp lệ và compile matcher
  → lấy basename Chrome cung cấp; chuẩn hóa HTTP(S) candidates theo setting
  → xét extension/MIME filters và domain/prefix/glob/RE2JS matcher
  → chọn priority cao nhất, hòa giữ rule đứng trước
  → MatchResult với rule, matchedUrl chuẩn hóa và conflictAction đã resolve
  → validate destination + basename + toàn relative path
  → suggest({ filename, conflictAction })
  → fire-and-forget lưu lastRoutingEvent riêng, không await trong handler

disabled / no match / invalid / exception / watchdog
  → suggest() không đối số
```

Callback trả true đồng bộ. Mỗi invocation có completion guard và watchdog 1.000 ms riêng; promise hoàn tất muộn không route lại. Log lỗi dùng thông báo cố định, không log URL hoặc error object có dữ liệu tải xuống.

Hai chỗ WARN ở routing/install đều cô lập exception từ console.warn. Lỗi logger không tạo unhandled rejection hoặc gọi lại suggest; không thêm logger framework. Phase 5 có ca hồi quy logger ném lỗi ở unit và worker production thật.

Config dùng model canonical với configVersion: 1 ở root, lưu dưới key config. onInstalled chỉ khởi tạo khi reason là install và key chưa tồn tại. Load rule lỗi chỉ bỏ qua trong memory, không xóa dữ liệu đã lưu. Worker khởi động lại không reset cấu hình. Initialization và mutations dùng chung queue trong ConfigRepository; handler download vẫn đọc một snapshot độc lập cho mỗi invocation.

`core/config-validator.ts` là validator chung cho cấu hình và DownloadInput. Runtime bỏ qua từng rule hỏng/ID trùng, giữ bản hợp lệ đầu tiên; chế độ strict từ chối cả cấu hình nếu có rule lỗi, dùng cho mutation và import. Repository đọc/seed/serialize mutations và re-export validator để giữ caller Phase 0 tương thích. `prepareRule` kiểm tra metadata/path/filter và trả matcher đã compile; engine bỏ qua từng rule hỏng độc lập mà không gọi Chrome.

`rule-matcher.ts` tạo matcher cho từng pattern. Glob dùng so sánh string theo các phần phân cách bởi `*`, không biên dịch glob người dùng thành native regex; hostname/path được so riêng. `rule-engine.ts` giữ duy nhất winner, xét tối đa hai URL candidates cho mỗi rule. `MatchResult` phân biệt matched/no-match ở type level và có diagnostic khi regex bỏ qua URL quá dài. Grammar và boundary cụ thể: [RULES.md](RULES.md).

Module core không gọi Chrome/DOM. API Chrome tập trung trong background, storage và UI caller. Vite có root src, output dist; background.js ổn định để manifest tham chiếu; options/popup HTML có script local. CSP chỉ cho script-src self và object-src none. Hai quyền duy nhất là downloads, storage.

## Persistence và mutation API

`src/storage/config-repository.ts` là module ConfigRepository, không tạo abstraction hoặc migration framework khác. `readConfig()` trả một snapshot raw từ storage cho handler; `loadConfig()` runtime-validate và trả `{ config, skippedRules }` cho caller. Đọc không chờ pending mutation: download đã lấy snapshot tiếp tục dùng snapshot đó; download sau một write đã hoàn tất đọc dữ liệu mới. Không cache config qua download hay worker restart.

Một Promise queue ở background chạy từng mutation: capture intent → đọc snapshot mới nhất → strict-validate dữ liệu hiện hữu → áp dụng patch → strict-validate toàn config → await `storage.local.set({ config })` → trả success. Đuôi queue hấp thụ rejection để request tiếp theo vẫn chạy, trong khi request bị lỗi vẫn nhận error. Không clear/remove, không ghi defaults để phục hồi lỗi. Nếu dữ liệu hiện hữu có rule hỏng, routing vẫn bỏ qua riêng rule đó nhưng CRUD trả `INVALID_CONFIG`, giữ nguyên raw data. Import là ngoại lệ thay thế rõ ràng sau preview/confirm, có thể phục hồi dữ liệu lỗi hoặc version chưa hỗ trợ bằng file v1 hợp lệ.

Schema tại `src/models/messages.ts`; shape/allowed fields được kiểm tra ở `core/message-validator.ts`, semantic validation của patch được áp dụng trên snapshot mới nhất trước khi ghi. Whole-config replacement chỉ có qua `config.import` với candidate strict và snapshot từ preview.

| Message type         | Payload                                   | Hành vi                                                                                           |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| config.get           | không có field khác                       | Config runtime hợp lệ và số rule bị bỏ qua                                                        |
| config.export        | không có field khác                       | Một raw snapshot strict, projection canonical; không ghi, không bỏ rule lỗi                       |
| config.previewImport | config candidate hợp lệ                   | Vào writer queue, trả candidate và preview snapshot/count/settings; không ghi                     |
| config.import        | config candidate, expectedSnapshot        | Cùng queue kiểm tra hash mới nhất rồi strict-validate và await một set; stale trả lỗi             |
| settings.update      | patch chứa các field settings thực sự đổi | Merge field, không ghi đè rules/settings khác                                                     |
| rule.create          | rule draft không ID/timestamps            | Background tạo UUID/timestamps, append cuối                                                       |
| rule.update          | id, patch                                 | Giữ ID, createdAt và vị trí; cập nhật updatedAt. match là patch từng field, không thay toàn match |
| rule.delete          | id                                        | Xóa đúng rule, ID không tồn tại trả lỗi                                                           |
| rule.duplicate       | id                                        | UUID/timestamps mới, tên thêm `(copy)`, append cuối                                               |

Patch rule chỉ cho name/enabled/match/destination/priority/conflictAction; match chỉ cho type/pattern/extensions/mimeTypes. Đặt `conflictAction: null` để bỏ override và kế thừa settings. Clear filter bằng list rỗng. Không cho client sửa ID/timestamps hay truyền field lạ. Nếu hai intent sửa cùng field thì request vào queue sau thắng; serialization bảo vệ field không liên quan, không phải editor conflict resolution.

Message listener được đăng ký đồng bộ ở module top level, chỉ nhận sender có runtime ID đúng và URL thuộc trang extension của chính nó. Không content script hay externally-connectable API. Callback trả literal `true`, gọi sendResponse sau khi operation hoàn tất để hỗ trợ Chrome mục tiêu 120. Caller đóng trước reply không rollback một write đã commit.

Response là `{ ok: true, config, skippedRules }` hoặc `{ ok: false, error }`; riêng preview thêm `preview: { snapshot, currentRuleCount, currentSettings, currentValid }`, config là candidate sẽ thay. Count/settings không xác định trả null; currentValid false cảnh báo người dùng dữ liệu hiện hữu có lỗi. Error cố định: `INVALID_MESSAGE`, `INVALID_CONFIG`, `RULE_NOT_FOUND`, `STALE_PREVIEW`, `STORAGE_READ_FAILED`, `STORAGE_WRITE_FAILED`, `FORBIDDEN`. `requestConfig` tại `storage/config-client.ts` kiểm tra config và preview response, chuyển lỗi transport/malformed reply thành `CHANNEL_FAILED`, không tự retry mutation khi không biết write đã commit hay chưa. Không gửi raw exception/URL/token trong lỗi.

Options là caller thực tế của read/mutation API và `storage.onChanged`, dùng request ID để bỏ response cũ và `textContent` để render. CRUD/settings controls dùng writer này. Tests E2E P0–P2 gửi mutation qua message API production; raw storage writes chỉ dùng cho fault injection và khôi phục fixture sau đó. P3 thực hiện thao tác sản phẩm qua DOM options thật.

## Options và rule tester

Options dùng HTML/CSS/TypeScript native, không framework hay dependency UI mới. `options/rule-form.ts` đọc giá trị form, dùng compileMatcher/path/filter validators chung để tạo field errors, rồi validate toàn draft bằng prepareRule. `createRulePatch` chỉ gửi field thay đổi so với bản mở editor; arrays rỗng và kế thừa conflict được so theo semantics, clear override gửi null. Editing giữ ID/createdAt/order; create/duplicate do background cấp metadata. List hiển thị thứ tự thật, không sort theo priority làm mất tie-break.

Một busy guard trong page chặn mọi thao tác ghi lặp, disable controls cho tới response. Storage updates chỉ refresh list/settings sạch, không reset editor hoặc settings draft đang sửa. Save thất bại giữ nguyên draft; Cancel/Escape không mutate và phục hồi focus. CHANNEL_FAILED không được coi là chắc chắn thất bại: UI khóa write cho tới khi người dùng đọc lại config để kiểm tra khả năng đã commit. Snapshot chưa commit không được dùng để thông báo success.

`core/rule-tester.ts` kiểm tra rule/input và gọi matchRule với danh sách một rule, dùng buildPath chung. MatchResult có engine failure reason; không có matcher/filter thứ hai để giải thích kết quả. Thiếu basename/MIME cần thiết trả incomplete trước matching. MIME không filter có thể để trống. Test không lưu cấu hình, không tải file và không hứa winner của cả list; settings đã lưu (kể cả enabled) được áp dụng.

Form có labels/aria-describedby/aria-invalid, field errors, status/alert, native controls và focus rõ. Editor inline, không phải modal; Escape/Cancel phục hồi focus, fallback về Add nếu trigger đã bị xóa. Layout reflow trên viewport 390px. Markup từ name/pattern/destination chỉ là text. Chưa tuyên bố audit screen reader/WCAG đầy đủ.

## Export/import thay thế

`core/import-export.ts` dùng parseConfig strict và validator matcher/path hiện hữu. `canonicalConfig` tạo root/settings/rules projection chỉ gồm field model, copy filter arrays và giữ metadata/order. Export lấy một raw snapshot, từ chối rule lỗi và không runtime-filter; serialize JSON compact với newline cuối. Không có event/log/metadata envelope, schema phụ hoặc dependency mới. Unknown fields có thể tồn tại ở raw data cũ nhưng không được đưa vào bản sao.

`parseImportJson` chặn quá 16 MiB UTF-8 trước JSON.parse; UI kiểm tra File.size trước file.text. `parseImportedConfig` kiểm tra toàn bộ config và reject unknown fields ở root/settings/rule/match, gồm flags/prototype payload. Không merge, sửa pattern/path, đổi version hoặc bỏ entry lỗi. Kích thước này là giới hạn đọc file; quota storage thật vẫn có thể từ chối write.

Preview chạy sau các mutation đã vào queue trước nó. Snapshot là SHA-256 của JSON serialization `{ config: raw }`, gồm cả dữ liệu hiện hữu lỗi/field lạ; absent và null khác nhau. Token không chứa raw config; không phải chứng thực người dùng hay chữ ký backup. Confirm capture candidate, vào cùng queue, đọc/hash raw mới nhất và so token ngay trước validate/set. Nếu đã đổi trả STALE_PREVIEW, không ghi. Queue bảo vệ mọi writer sản phẩm; không hứa atomic compare-and-swap trước raw writes từ DevTools/extension khác bỏ qua queue. Đổi rồi quay lại cùng snapshot có thể xác nhận vì nội dung được thay giống preview.

Options dùng file input → preview → confirm hoặc cancel. Preview liệt kê count và từng setting trước/sau, cảnh báo cả trường hợp dữ liệu hiện hữu lỗi và việc đóng bản nháp sau success. Chọn lại file/cancel hoặc storage.onChanged xóa preview cũ; kiểm tra trong background vẫn là bảo đảm cuối. Write reject giữ candidate/preview để explicit retry và draft chưa lưu. Lost reply khóa mutation đến explicit reread. UI chỉ báo success sau awaited set, rồi refresh options/popup; download mới đọc snapshot mới. Các status/error dùng textContent, file có label/error/focus, layout reflow 360 px.

Export tạo Blob URL và kích hoạt anchor download native. Giữ URL mới nhất tới export tiếp theo/page lifetime để Save As đang mở không mất nguồn; trình duyệt thu hồi khi document đóng. UI chỉ nói bắt đầu tải, không hứa download đã hoàn tất. Test dùng Chrome history và nội dung file thật; setInputFiles/DOM cancel chỉ tự động hóa biên chọn file, không tuyên bố đã thao tác Windows picker.

## Popup và sự kiện gần nhất

Popup native HTML/CSS/TypeScript chỉ có global toggle, enabled/total count, một event và mở options. Toggle là native button role switch với aria-checked từ config đã đọc; không đổi trạng thái trước commit. Gửi duy nhất settings.update patch enabled qua writer hiện hữu, chặn double click và CHANNEL_FAILED tới explicit reread. storage.onChanged/config và request generation giữ đồng bộ khi Options đổi trạng thái; read lỗi vô hiệu toggle thay vì hiển thị số liệu cũ như hiện hành. Khi disable chờ ghi làm mất focus, completion trả focus về toggle hoặc nút đọc lại; không giành focus khi người dùng đã chuyển sang control khác.

`models/routing-event.ts` chứa RoutingEvent, không nằm trong ExtensionConfig. `storage/routing-event.ts` validate và đọc key local `lastRoutingEvent`; mỗi write thay đúng một key bằng snapshot chỉ gồm timestamp/ruleId/basename/destination. Queue riêng tuần tự hóa các event và phục hồi sau rejection, không chờ queue config hoặc giữ download mở. Không history array, URL/query/MIME, telemetry hay log filename. Metadata rule/filename chỉ render qua textContent.

Handler nhận writer qua tham số thứ hai, production entry truyền saveRoutingEvent. Sau route hợp lệ và suggest trả về, handler mới tạo snapshot và lên microtask gọi writer, nuốt lỗi riêng khỏi đường routing. Disabled/no-match/invalid/exception/watchdog và kết quả muộn không tạo event. Writer pending hoặc throw/reject không thể gọi suggest lần hai. Event write là best effort: bản ghi cũ còn lại nếu ghi mới lỗi hoặc worker bị dừng trước khi ghi xong; popup hiển thị timestamp và chỉ gọi đó là đề xuất. Read event độc lập khỏi config, lỗi event không khóa toggle. Config không chứa key event nên export canonical ở Phase 6 không bao gồm nó.

## Quyết định engine regex

Chọn **re2js 2.8.6**, MIT, dependency runtime duy nhất. Package là JavaScript thuần, không native binary/WASM, không yêu cầu tải executable code từ mạng hay thêm CSP unsafe-eval. Giữ bản license trong artifact.

- compileRegex dùng RE2JS.compile; không chuyển pattern người dùng sang native RegExp và không có fallback native.
- matchesRegex dùng matcher.find để giữ semantics tìm kiếm substring khi pattern không tự anchor.
- Cú pháp theo RE2JS với flags mặc định; lookahead/lookbehind và backreference trong corpus thử bị từ chối. Không bật LOOKBEHINDS hoặc cung cấp tham số flags.
- Pattern có 1–256 UTF-16 code units (String.length); input tối đa 8.192 code units. Input dài hơn trả false cho lần kiểm tra đó; core tiếp tục xét candidate/rule khác và cung cấp lý do cho tester.
- Các RegExp literal trong path validation là pattern cố định do dự án viết, không phải thực thi pattern người dùng.

regex.js là entry build dùng để kiểm chứng helper thực tế trong trang extension MV3 bằng dynamic import local. Engine Phase 1 dùng lại đúng helper này trong worker; Vite tách dependency dùng chung thành local asset. Không thêm test hook vào background hay cấu hình regex UI. E2E đã route file PDF bằng regex cùng extension/MIME filters trong service worker thật.

Bằng chứng hiện tại: unit kiểm tra syntax và biên; production regex.js chạy trong trang MV3 thật, CSP script-src self. Nested quantifier ^(a+)+$ với input không khớp dài 129/1.025/8.192 code units hoàn tất; ghi thời gian từng trường hợp trong evidence E2E. Đây là phép thử khả thi, không phải chứng minh mọi workload hay benchmark 200 rule của Phase 5.

Validation và engine hiện compile độc lập khi load và khi chọn rule; chưa có cache cross-download. Benchmark/caching chỉ thực hiện khi cần dựa trên số đo ở phase reliability/hardening; watchdog không phải cơ chế ngắt phần xử lý đồng bộ.

## Quyết định kiểm thử browser

Dùng Playwright với persistent context riêng và Chromium headless. Tạo Preferences cho Downloads nằm trong workspace. Sau khi khởi tạo context, chuyển Browser.setDownloadBehavior về default: chế độ automation allow/allowAndName bỏ qua hook đặt tên của extension trên môi trường đã thử.

Cold worker được stop bằng ServiceWorker.stopWorker, quan sát runningStatus stopped rồi mới bấm tải. Một marker trong JS global do bài test đặt trước đó phải biến mất sau restart. Không dựa vào targetId phải đổi, vì Chromium đã tái sử dụng targetId trong thực nghiệm. Không mở cửa sổ worker DevTools. File đúng thư mục và download history complete xác nhận đường đi thực tế; không dùng download.saveAs để tự di chuyển file rồi coi là extension route thành công.

Phase 2 đóng/mở hẳn persistent context trên cùng profile thử, xác nhận file đầu tiên trước khi mở extension page/API. Ở phép thử cold worker tiếp theo, mọi extension page được đóng để tránh status message đánh thức worker; chỉ mở lại sau khi file đúng đích đã xuất hiện. Thử quota bằng một create intent vượt `storage.local.QUOTA_BYTES` trong profile bỏ được; error, config không đổi và mutation tiếp theo thành công đều được assert. Không monkeypatch Chrome API trong phép thử quota này.

Phase 5 dùng corpus path JSON chung cho unit và HTTP fixtures cố định; server không nhận đường dẫn filesystem từ request. Conflict old/new trả cùng basename nhưng nội dung khác để chứng minh uniquify giữ bản cũ và overwrite thay nội dung thật. Prompt/Save As chạy headful với native dialog do người dùng thao tác, history/filesystem/hash kiểm tra bằng script; không chuyển file bằng Playwright saveAs. Report giữ rõ provenance khi resume các case trên cùng build.

Baseline 200 rule dùng `tests/fixtures/reliability.ts` chung cho Node và browser: 50 rule mỗi matcher, filters, last rule thắng; thêm 200 regex nested quantifier với URL 8.192 units ở Node. Đo latency riêng không profiling; standard coverage chỉ kiểm tra correctness cùng workload. Chromium đo 5 first-download sau worker stop và 20 warm download, tách số đo quan sát file/I/O khỏi CPU time. Chưa có bằng chứng cần cache hoặc thay thuật toán nên giữ implementation hiện có. Xem metrics/giới hạn trong docs/TESTING.md và .test-artifacts/benchmarks.

## Build và phát hành cục bộ

Package và manifest là 1.0.0, model vẫn configVersion 1. Fresh install có rule Local example (127.0.0.1); update/reload không seed lại hoặc đổi tên rule đã lưu. README/CHANGELOG mô tả đúng cách dùng và recovery cùng schema.

`scripts/prepare-release.mjs` nhận source candidate từ Git file inventory (gồm uncommitted/untracked source), copy vào snapshot riêng sạch build/dependency và hash từng file cùng base commit. Dùng frozen offline install từ package cache đã chuẩn bị; không biến working tree bẩn thành một clean commit giả. Quality commands/build/browser chạy trong snapshot với cùng lockfile. Vì full-path Windows là một boundary riêng, browser artifacts được đặt ở thư mục mới trực tiếp dưới `.test-artifacts` của workspace qua DOWNLOAD_ROUTER_E2E_ARTIFACTS; runner kiểm tra đúng parent name và không reuse thư mục cũ.

Release E2E dùng UI production để tạo/sửa/toggle/export/import, stop worker thật rồi kiểm tra download trước mở lại extension page. Reload phải bật Developer mode trong profile thử theo README, quan sát tab extension đóng và mở tab mới. Upgrade giữ artifact 0.1.0 đã kiểm chứng, cùng đường dẫn extension/profile và backup JSON, thay bằng production 1.0.0 rồi đối chiếu raw config và file thật. Addon counterpart fixture riêng xác nhận hai listener suggest thật không treo download ở hai requested load orders; không đưa addon đó vào artifact.

Sau checks, script whitelist inventory/manifest/CSP/license/sentinel, đóng ZIP bằng .NET ZipFile, giải nén và so mọi file SHA với dist đã load. Build lần hai phải tái lập đúng hash. Raw report giữ source/build hashes, command logs, coverage và browser details trong `.test-artifacts`; `verification.json` chỉ chọn các kết quả cần chia sẻ, dùng đường dẫn tương đối và có kiểm tra không chứa đường dẫn máy. Bản pass được review trước khi copy vào `docs/evidence/v<version>.json`. Không thêm CI/backend/dependency cho quy trình này; script không tự commit/tag/push/publish.

## Giới hạn có chủ đích

- Domain/prefix/glob/regex, filters, options CRUD/settings/tester, popup và import/export đã kiểm tra. Không có history/ring buffer hoặc cache.
- Đã kiểm tra uniquify/overwrite; prompt/Save As chọn tên mới/hủy có bằng chứng Windows lịch sử Phase 5. Phase 7 kiểm tra hai listener suggest thực sự bằng một extension đối chứng cục bộ trong profile riêng, không bảo đảm tương thích mọi addon. Reload 1.0.0 và update từ artifact 0.1.0 giữ exact config và routing đã được chạy. Chưa kiểm tra natural idle shutdown, screen reader, Chrome 120 thực tế hoặc mọi full path dài. Cold worker được stop chủ động qua CDP; không chạy lại dialog native trên 1.0.0.
- Chrome/Chromium có quyền quyết định cuối cùng về filename/destination; routing là gợi ý tương đối dưới Downloads.

## Nguồn tham khảo đã dùng

- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads#event-onDeterminingFilename)
- [RE2JS: tài liệu của tác giả](https://github.com/le0pard/re2js#readme)
- [Playwright: Chrome extensions](https://playwright.dev/docs/chrome-extensions)
- [Playwright issue về download behavior và hook filename](https://github.com/microsoft/playwright/issues/19885)
- [pnpm: verifyDepsBeforeRun](https://pnpm.io/settings/build#verifydepsbeforerun)
- [Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome Storage API/quota](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [MDN: file input và cancel event](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
- [MDN: Blob URL lifecycle](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob)
- [MDN: SubtleCrypto.digest](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
