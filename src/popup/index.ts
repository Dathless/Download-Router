import '../style.css';
import './popup.css';
import { requestConfig } from '../storage/config-client';
import { readRoutingEvent, ROUTING_EVENT_KEY } from '../storage/routing-event';
import type { ExtensionConfig } from '../models/config';
import type { ConfigError } from '../models/messages';

const get = (id: string) => document.getElementById(id)!;
const toggle = get('toggle') as HTMLButtonElement;
const reload = get('reload') as HTMLButtonElement;
let config: ExtensionConfig | undefined;
let skippedRules = 0;
let busy = false;
let unknownWrite = false;
let configRequest = 0;
let eventRequest = 0;

const errors: Record<ConfigError, string> = {
  STALE_PREVIEW: 'Cấu hình đã đổi. Hãy mở lại preview import trong cài đặt.',
  INVALID_MESSAGE: 'Không thể áp dụng thay đổi này. Hãy đọc lại cấu hình.',
  INVALID_CONFIG: 'Cấu hình có lỗi; không ghi thay đổi để bảo toàn dữ liệu.',
  RULE_NOT_FOUND: 'Rule không còn tồn tại. Hãy đọc lại cấu hình.',
  STORAGE_READ_FAILED: 'Không đọc được cấu hình. Hãy thử đọc lại.',
  STORAGE_WRITE_FAILED:
    'Không lưu được thay đổi. Trạng thái đã lưu vẫn được giữ; hãy thử lại.',
  FORBIDDEN: 'Không có quyền truy cập. Hãy mở lại popup của extension.',
  CHANNEL_FAILED:
    'Mất kết nối; chưa rõ thay đổi đã lưu chưa. Đọc lại để kiểm tra trước khi thao tác tiếp.',
};

function renderConfig() {
  toggle.disabled = busy || !config || skippedRules > 0 || unknownWrite;
  reload.disabled = busy;
  toggle.setAttribute(
    'aria-checked',
    String(config?.settings.enabled ?? false),
  );
  toggle.setAttribute('aria-busy', String(busy));
  if (!config) {
    get('config-status').textContent = 'Chưa đọc được cấu hình.';
    get('rule-count').textContent = 'Chưa biết số rule.';
    return;
  }
  get('config-status').textContent =
    `${config.settings.enabled ? 'Đang bật' : 'Đang tắt'} định tuyến.${skippedRules ? ` Bỏ qua ${skippedRules} rule lỗi; cần kiểm tra trong cài đặt.` : ''}`;
  get('rule-count').textContent = config.rules.length
    ? `${config.rules.filter((rule) => rule.enabled).length}/${config.rules.length} rule đang bật.`
    : '0/0 rule đang bật. Thêm rule trong cài đặt để bắt đầu.';
}

async function refreshConfig() {
  const id = ++configRequest;
  const response = await requestConfig({ type: 'config.get' });
  if (id !== configRequest) return;
  config = response.ok ? response.config : undefined;
  skippedRules = response.ok ? response.skippedRules : 0;
  if (!response.ok) get('error').textContent = errors[response.error];
  renderConfig();
}

async function refreshEvent() {
  const id = ++eventRequest;
  try {
    const event = await readRoutingEvent();
    if (id !== eventRequest) return;
    get('event-details').hidden = !event;
    get('event-status').textContent = event
      ? 'Đã đề xuất đường dẫn:'
      : 'Chưa có đề xuất định tuyến.';
    if (event) {
      get('event-time').textContent = new Date(event.timestamp).toLocaleString(
        'vi-VN',
      );
      get('event-rule').textContent = event.ruleId;
      get('event-basename').textContent = event.basename;
      get('event-destination').textContent = `Downloads/${event.destination}`;
    }
  } catch {
    if (id !== eventRequest) return;
    get('event-details').hidden = true;
    get('event-status').textContent =
      'Không đọc được sự kiện gần nhất. Có thể thử đọc lại; định tuyến không phụ thuộc trạng thái này.';
  }
}

toggle.addEventListener('click', () => {
  if (toggle.disabled || busy || !config) return;
  const restoreFocus = document.activeElement === toggle;
  const enabled = !config.settings.enabled;
  busy = true;
  get('error').textContent = '';
  get('action-status').textContent = 'Đang lưu…';
  renderConfig();
  void requestConfig({ type: 'settings.update', patch: { enabled } }).then(
    async (response) => {
      if (!response.ok) {
        unknownWrite = response.error === 'CHANNEL_FAILED';
        get('error').textContent = errors[response.error];
        get('action-status').textContent = '';
      } else {
        get('action-status').textContent = 'Đã lưu thay đổi.';
        await refreshConfig();
      }
      busy = false;
      renderConfig();
      if (restoreFocus && document.activeElement === document.body)
        (toggle.disabled ? reload : toggle).focus();
    },
  );
});
reload.addEventListener('click', () => {
  if (busy) return;
  unknownWrite = false;
  config = undefined;
  get('error').textContent = '';
  get('action-status').textContent = '';
  renderConfig();
  void refreshConfig();
  void refreshEvent();
});
get('options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage().catch(() => {
    get('error').textContent = 'Không mở được cài đặt. Hãy thử lại.';
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.config) void refreshConfig();
  if (changes[ROUTING_EVENT_KEY]) void refreshEvent();
});
void refreshConfig();
void refreshEvent();
