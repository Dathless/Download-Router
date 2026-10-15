import '../style.css';
import './options.css';
import { requestConfig } from '../storage/config-client';
import type {
  DownloadRule,
  ExtensionConfig,
  ExtensionSettings,
  MatchFailureReason,
} from '../models/config';
import type {
  ConfigError,
  ConfigMutation,
  ImportPreview,
} from '../models/messages';
import {
  MAX_IMPORT_BYTES,
  parseImportJson,
  serializeConfig,
} from '../core/import-export';
import { testRule } from '../core/rule-tester';
import {
  createRulePatch,
  parseRuleForm,
  previewMetadata,
  type RuleFormErrors,
  type RuleFormValues,
} from './rule-form';

const get = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const field = (id: string) => get<HTMLInputElement>(id);
let config: ExtensionConfig | undefined;
let writable = false;
let busy = false;
let unknownWrite = false;
let settingsDirty = false;
let settingsBaseline: ExtensionSettings | undefined;
let editor: { original: DownloadRule | null; returnFocus: string } | undefined;
let requestId = 0;
let importCandidate: ExtensionConfig | undefined;
let importPreview:
  { config: ExtensionConfig; preview: ImportPreview } | undefined;
let exportUrl: string | undefined;
const errorMessages: Record<ConfigError, string> = {
  STALE_PREVIEW:
    'Cấu hình đã thay đổi sau preview. Hãy xem trước lại trước khi thay thế.',
  INVALID_MESSAGE: 'Dữ liệu không hợp lệ. Hãy kiểm tra các trường đang sửa.',
  INVALID_CONFIG:
    'Cấu hình hiện tại có lỗi. Không ghi thay đổi để tránh mất dữ liệu; hãy kiểm tra bản sao cấu hình.',
  RULE_NOT_FOUND: 'Rule đã bị xóa ở nơi khác. Nội dung đang sửa vẫn được giữ.',
  STORAGE_READ_FAILED: 'Không đọc được cấu hình. Hãy thử đọc lại.',
  STORAGE_WRITE_FAILED:
    'Không lưu được cấu hình. Nội dung đang sửa vẫn được giữ; hãy kiểm tra dung lượng rồi thử lại.',
  FORBIDDEN:
    'Trang này không có quyền thay đổi cấu hình. Hãy mở lại trang cài đặt của extension.',
  CHANNEL_FAILED:
    'Mất kết nối; chưa rõ thay đổi đã được lưu hay chưa. Đọc lại cấu hình và kiểm tra danh sách trước khi lưu lại.',
};

function controls() {
  const disabled = busy || !writable || unknownWrite;
  document
    .querySelectorAll<HTMLButtonElement>('[data-write]')
    .forEach((button) => {
      button.disabled = disabled;
    });
  get<HTMLFieldSetElement>('settings-fields').disabled = disabled;
  get<HTMLFieldSetElement>('rule-fields').disabled = disabled;
  get<HTMLFieldSetElement>('tester-fields').disabled = busy || !config;
  get<HTMLButtonElement>('cancel-rule').disabled = busy;
  get<HTMLButtonElement>('reload-config').disabled = busy;
  get('rule-form').setAttribute('aria-busy', String(busy));
  field('import-file').disabled = busy || unknownWrite;
  get<HTMLButtonElement>('export-config').disabled =
    busy || !writable || unknownWrite;
  get<HTMLButtonElement>('preview-import').disabled =
    busy || unknownWrite || !importCandidate;
  get<HTMLButtonElement>('confirm-import').disabled =
    busy || unknownWrite || !importPreview;
  get<HTMLButtonElement>('cancel-import').disabled =
    busy || (!importCandidate && !field('import-file').value);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function renderRules() {
  const list = get<HTMLOListElement>('rule-list');
  const activeId = list.contains(document.activeElement)
    ? document.activeElement?.id
    : undefined;
  list.replaceChildren();
  get('empty-state').hidden = !config || config.rules.length !== 0;
  config?.rules.forEach((rule, index) => {
    const item = element('li');
    item.className = 'rule-card';
    item.id = `row-${rule.id}`;
    item.dataset.ruleId = rule.id;
    const heading = element('div');
    heading.className = 'section-header';
    heading.append(element('h3', `${index + 1}. ${rule.name}`));
    const badge = element('span', rule.enabled ? 'Đang bật' : 'Đang tắt');
    badge.className = 'badge';
    heading.append(badge);
    const details = element('dl');
    details.className = 'rule-details';
    for (const [name, value] of [
      ['Matcher', `${rule.match.type} · ${rule.match.pattern}`],
      ['Thư mục', `Downloads/${rule.destination}`],
      ['Priority', String(rule.priority)],
      [
        'Conflict',
        rule.conflictAction ??
          `${config!.settings.defaultConflictAction} (kế thừa)`,
      ],
      [
        'Filters',
        `Extension: ${rule.match.extensions?.join(', ') || 'mọi loại'} · MIME: ${rule.match.mimeTypes?.join(', ') || 'mọi loại'}`,
      ],
    ])
      details.append(element('dt', name), element('dd', value));
    const actions = element('div');
    actions.className = 'actions';
    for (const action of [
      {
        key: 'edit',
        label: 'Sửa',
        run: () => openEditor(rule, `edit-${rule.id}`),
      },
      {
        key: 'duplicate',
        label: 'Nhân bản',
        run: () =>
          void commit(
            { type: 'rule.duplicate', id: rule.id },
            () => `duplicate-${rule.id}`,
            'Đã nhân bản rule.',
          ),
      },
      {
        key: 'toggle',
        label: rule.enabled ? 'Tắt' : 'Bật',
        run: () =>
          void commit(
            {
              type: 'rule.update',
              id: rule.id,
              patch: { enabled: !rule.enabled },
            },
            () => `toggle-${rule.id}`,
            'Đã cập nhật trạng thái rule.',
          ),
      },
      {
        key: 'delete',
        label: 'Xóa',
        run: () =>
          void commit(
            { type: 'rule.delete', id: rule.id },
            () => 'add-rule',
            'Đã xóa rule.',
          ),
      },
    ]) {
      const button = element('button', action.label);
      button.type = 'button';
      button.id = `${action.key}-${rule.id}`;
      button.setAttribute('aria-label', `${action.label} rule ${rule.name}`);
      button.dataset.write = '';
      if (action.key === 'delete') button.className = 'danger';
      button.addEventListener('click', action.run);
      actions.append(button);
    }
    item.append(heading, details, actions);
    list.append(item);
  });
  controls();
  if (activeId && !busy) document.getElementById(activeId)?.focus();
}

async function refreshConfig() {
  const current = ++requestId;
  const response = await requestConfig({ type: 'config.get' });
  if (current !== requestId) return;
  if (!response.ok) {
    config = undefined;
    writable = false;
    get('config-status').textContent =
      'Không đọc được cấu hình. Hãy tải lại trang hoặc kiểm tra bản sao cấu hình.';
  } else {
    if (
      editor &&
      JSON.stringify(config?.settings) !==
        JSON.stringify(response.config.settings)
    )
      get('test-result').textContent = 'Cài đặt đã thay đổi. Hãy thử lại.';
    config = response.config;
    writable = response.skippedRules === 0;
    get('config-status').textContent =
      `${config.settings.enabled ? 'Đang bật' : 'Đang tắt'} · ${config.rules.length} rule hợp lệ.${response.skippedRules ? ' Có rule lỗi bị bỏ qua; cần kiểm tra cấu hình trước khi chỉnh sửa.' : ''}`;
    if (!settingsDirty) {
      settingsBaseline = { ...config.settings };
      field('settings-enabled').checked = config.settings.enabled;
      field('settings-redirect').checked = config.settings.matchRedirectedUrl;
      get<HTMLSelectElement>('settings-conflict').value =
        config.settings.defaultConflictAction;
    }
  }
  renderRules();
}

async function commit(
  message: ConfigMutation,
  afterSuccess: () => string | undefined,
  successText: string,
) {
  if (busy || !writable || unknownWrite) return;
  busy = true;
  controls();
  get('save-error').textContent = '';
  get('action-status').textContent = 'Đang lưu…';
  const response = await requestConfig(message);
  let focusId: string | undefined;
  if (response.ok) {
    focusId = afterSuccess();
    await refreshConfig();
    get('action-status').textContent = successText;
  } else {
    if (response.error === 'CHANNEL_FAILED') unknownWrite = true;
    get('action-status').textContent = '';
    get('save-error').textContent = errorMessages[response.error];
  }
  busy = false;
  controls();
  if (focusId) document.getElementById(focusId)?.focus();
}

function values(): RuleFormValues {
  return {
    name: field('rule-name').value,
    enabled: field('rule-enabled').checked,
    type: get<HTMLSelectElement>('rule-type').value,
    pattern: field('rule-pattern').value,
    extensions: field('rule-extensions').value,
    mimeTypes: field('rule-mimeTypes').value,
    destination: field('rule-destination').value,
    priority: field('rule-priority').value,
    conflictAction: get<HTMLSelectElement>('rule-conflictAction').value,
  };
}

function clearErrors() {
  get('rule-form')
    .querySelectorAll('.field-error')
    .forEach((node) => {
      node.textContent = '';
    });
  get('rule-form')
    .querySelectorAll('[aria-invalid]')
    .forEach((node) => node.removeAttribute('aria-invalid'));
}

function showErrors(errors: RuleFormErrors) {
  get('form-status').textContent =
    'Chưa thể lưu hoặc thử rule. Hãy sửa các trường được đánh dấu.';
  for (const [key, error] of Object.entries(errors)) {
    get(`rule-${key}`).setAttribute('aria-invalid', 'true');
    const target = document.getElementById(`rule-${key}-error`);
    if (target) target.textContent = error;
  }
  const first = Object.keys(errors)[0];
  if (first) get(`rule-${first}`).focus();
}

function openEditor(rule: DownloadRule | null, returnFocus: string) {
  if (editor) {
    get('action-status').textContent =
      'Hãy lưu hoặc hủy bản sửa đang mở trước khi chọn rule khác.';
    field('rule-name').focus();
    return;
  }
  editor = { original: rule ? structuredClone(rule) : null, returnFocus };
  get<HTMLFormElement>('rule-form').reset();
  get<HTMLFormElement>('tester-form').reset();
  clearErrors();
  get('save-error').textContent = '';
  get('test-result').textContent = 'Chưa chạy thử.';
  get('editor-heading').textContent = rule ? 'Sửa rule' : 'Thêm rule';
  if (rule) {
    field('rule-name').value = rule.name;
    field('rule-enabled').checked = rule.enabled;
    get<HTMLSelectElement>('rule-type').value = rule.match.type;
    field('rule-pattern').value = rule.match.pattern;
    field('rule-extensions').value = rule.match.extensions?.join(', ') ?? '';
    field('rule-mimeTypes').value = rule.match.mimeTypes?.join(', ') ?? '';
    field('rule-destination').value = rule.destination;
    field('rule-priority').value = String(rule.priority);
    get<HTMLSelectElement>('rule-conflictAction').value =
      rule.conflictAction ?? '';
  }
  get('editor').hidden = false;
  controls();
  field('rule-name').focus();
}

function closeEditor() {
  const returnFocus =
    editor && document.getElementById(editor.returnFocus)
      ? editor.returnFocus
      : 'add-rule';
  editor = undefined;
  get('editor').hidden = true;
  clearErrors();
  return returnFocus;
}

get('add-rule').addEventListener('click', () => openEditor(null, 'add-rule'));
get('cancel-rule').addEventListener('click', () => {
  if (!busy) {
    const id = closeEditor();
    if (id) document.getElementById(id)?.focus();
  }
});
get('editor').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !busy) {
    event.preventDefault();
    get('cancel-rule').click();
  }
});
get('rule-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || !editor) return;
  clearErrors();
  const parsed = parseRuleForm(values());
  if (!parsed.ok) {
    showErrors(parsed.errors);
    return;
  }
  const message: ConfigMutation = editor.original
    ? {
        type: 'rule.update',
        id: editor.original.id,
        patch: createRulePatch(editor.original, parsed.draft),
      }
    : { type: 'rule.create', rule: parsed.draft };
  if (message.type === 'rule.update' && !Object.keys(message.patch).length) {
    const id = closeEditor();
    get('action-status').textContent = 'Không có thay đổi.';
    if (id) document.getElementById(id)?.focus();
    return;
  }
  void commit(message, closeEditor, 'Đã lưu rule.');
});
get('settings-form').addEventListener('input', () => {
  settingsDirty = true;
});
get('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || !settingsBaseline) return;
  const next = {
    enabled: field('settings-enabled').checked,
    matchRedirectedUrl: field('settings-redirect').checked,
    defaultConflictAction: get<HTMLSelectElement>('settings-conflict')
      .value as ExtensionSettings['defaultConflictAction'],
  };
  const patch: Partial<ExtensionSettings> = {};
  if (next.enabled !== settingsBaseline.enabled) patch.enabled = next.enabled;
  if (next.matchRedirectedUrl !== settingsBaseline.matchRedirectedUrl)
    patch.matchRedirectedUrl = next.matchRedirectedUrl;
  if (next.defaultConflictAction !== settingsBaseline.defaultConflictAction)
    patch.defaultConflictAction = next.defaultConflictAction;
  if (!Object.keys(patch).length) {
    get('action-status').textContent = 'Không có thay đổi.';
    return;
  }
  void commit(
    { type: 'settings.update', patch },
    () => {
      settingsDirty = false;
      return 'save-settings';
    },
    'Đã lưu cài đặt.',
  );
});

const failureText: Record<MatchFailureReason, string> = {
  disabled: 'Định tuyến hoặc rule đang tắt.',
  'invalid-input':
    'Basename hoặc dữ liệu thử không hợp lệ; không được dùng đường dẫn đầy đủ.',
  'invalid-url':
    'Không có URL HTTP(S) hợp lệ được cho phép bởi cài đặt redirect.',
  'invalid-rule': 'Rule không hợp lệ.',
  'extension-filter': 'Basename không qua extension filter.',
  'mime-filter': 'MIME không qua MIME filter.',
  'url-pattern': 'URL không khớp pattern.',
  'regex-input-too-long':
    'URL sau chuẩn hóa vượt 8.192 UTF-16 units; bỏ qua phép regex tương ứng.',
};
get('tester-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || !config || !editor) return;
  clearErrors();
  const parsed = parseRuleForm(values());
  if (!parsed.ok) {
    showErrors(parsed.errors);
    get('test-result').textContent =
      'Rule chưa hợp lệ. Hãy sửa các trường được đánh dấu.';
    return;
  }
  const result = testRule(
    { ...parsed.draft, ...previewMetadata },
    {
      url: field('test-url').value,
      finalUrl: field('test-finalUrl').value || undefined,
      filename: field('test-filename').value,
      mime: field('test-mime').value,
    },
    config.settings,
  );
  const warning = ' Một candidate regex quá dài đã được bỏ qua.';
  get('test-result').textContent =
    result.status === 'match'
      ? `MATCH\nURL: ${result.matchedUrl}\nĐích: Downloads/${result.filename}\nConflict: ${result.conflictAction}${result.regexInputTooLong ? warning : ''}`
      : result.status === 'incomplete'
        ? `Chưa đủ dữ liệu: ${result.missing.map((name) => (name === 'filename' ? 'basename Chrome' : 'MIME')).join(', ')}.`
        : result.status === 'invalid'
          ? 'Rule hoặc đường dẫn đích không hợp lệ.'
          : `NO MATCH · ${failureText[result.reason]}`;
});
for (const id of ['rule-form', 'tester-form'])
  get(id).addEventListener('input', () => {
    get('test-result').textContent = 'Dữ liệu đã thay đổi. Hãy thử lại.';
  });
get('reload-config').addEventListener('click', () => {
  unknownWrite = false;
  void refreshConfig().then(() => {
    if (config && writable) {
      get('save-error').textContent = '';
      get('action-status').textContent =
        'Đã đọc lại cấu hình. Hãy kiểm tra danh sách trước khi lưu bản sửa đang mở.';
    }
  });
});

function invalidatePreview() {
  importPreview = undefined;
  get('import-preview').hidden = true;
  controls();
}
function clearImport() {
  importCandidate = undefined;
  field('import-file').value = '';
  get('import-error').textContent = '';
  field('import-file').removeAttribute('aria-invalid');
  invalidatePreview();
}
field('import-file').addEventListener('click', () => {
  clearImport();
  get('import-status').textContent =
    'Chọn file JSON để xem trước; chưa có thay đổi nào được ghi.';
});
field('import-file').addEventListener('cancel', () => {
  clearImport();
  get('import-status').textContent =
    'Đã hủy chọn file. Cấu hình không thay đổi.';
});
field('import-file').addEventListener('change', () => {
  if (busy || unknownWrite) return;
  importCandidate = undefined;
  invalidatePreview();
  get('import-error').textContent = '';
  field('import-file').removeAttribute('aria-invalid');
  const file = field('import-file').files?.[0];
  if (!file) {
    get('import-status').textContent =
      'Chưa chọn file; cấu hình không thay đổi.';
    controls();
    return;
  }
  busy = true;
  controls();
  get('import-status').textContent = 'Đang đọc file…';
  void (async () => {
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('File too large.');
      importCandidate = parseImportJson(await file.text());
      get('import-status').textContent =
        `Đã đọc ${importCandidate.rules.length} rule. Chọn “Xem trước thay thế” để tiếp tục.`;
    } catch {
      field('import-file').setAttribute('aria-invalid', 'true');
      get('import-status').textContent = '';
      get('import-error').textContent =
        'Không đọc được cấu hình JSON v1 hợp lệ (tối đa 16 MiB). Kiểm tra version, settings, ID, rule, regex và đường dẫn; không có dữ liệu nào được ghi.';
    } finally {
      busy = false;
      controls();
      if (document.activeElement === document.body)
        (importCandidate
          ? get('preview-import')
          : field('import-file')
        ).focus();
    }
  })();
});
get('cancel-import').addEventListener('click', () => {
  if (busy) return;
  clearImport();
  get('import-status').textContent =
    'Đã hủy import. Cấu hình và bản sửa hiện tại được giữ nguyên.';
  field('import-file').focus();
});
get('preview-import').addEventListener('click', () => {
  if (busy || unknownWrite || !importCandidate) return;
  const candidate = importCandidate;
  busy = true;
  invalidatePreview();
  get('import-error').textContent = '';
  get('import-status').textContent = 'Đang lấy snapshot để xem trước…';
  void requestConfig({ type: 'config.previewImport', config: candidate }).then(
    (response) => {
      if (response.ok && response.preview) {
        importPreview = { config: response.config, preview: response.preview };
        const current = response.preview;
        get('import-summary').textContent =
          `Thay ${current.currentRuleCount ?? 'số rule chưa xác định'} rule hiện tại bằng ${response.config.rules.length} rule trong file. Giữ nguyên ID, timestamps và thứ tự của file.`;
        const list = get('import-settings');
        list.replaceChildren();
        for (const [key, label] of [
          ['enabled', 'Định tuyến'],
          ['matchRedirectedUrl', 'Xét redirect'],
          ['defaultConflictAction', 'Conflict mặc định'],
        ] as const) {
          const before = current.currentSettings?.[key];
          const after = response.config.settings[key];
          list.append(
            element(
              'li',
              `${label}: ${before === undefined ? 'chưa xác định' : String(before)} → ${String(after)}${before === after ? ' (giữ nguyên)' : ' (thay đổi)'}`,
            ),
          );
        }
        get('import-current-warning').textContent = current.currentValid
          ? ''
          : 'Cấu hình hiện tại thiếu hoặc có lỗi. Xác nhận sẽ thay cả dữ liệu đó; hãy giữ bản sao cũ nếu cần kiểm tra.';
        get('import-preview').hidden = false;
        get('import-status').textContent =
          'Chưa ghi dữ liệu. Kiểm tra preview rồi xác nhận hoặc hủy.';
      } else {
        get('import-status').textContent = '';
        get('import-error').textContent = response.ok
          ? 'Không đọc được preview. Hãy thử lại.'
          : errorMessages[response.error];
      }
      busy = false;
      controls();
      if (importPreview) get('import-preview-heading').focus();
    },
  );
});
get('confirm-import').addEventListener('click', () => {
  if (busy || unknownWrite || !importPreview) return;
  const replacement = importPreview;
  busy = true;
  controls();
  get('import-error').textContent = '';
  get('import-status').textContent = 'Đang thay thế cấu hình…';
  void requestConfig({
    type: 'config.import',
    config: replacement.config,
    expectedSnapshot: replacement.preview.snapshot,
  }).then(async (response) => {
    if (response.ok) {
      closeEditor();
      settingsDirty = false;
      clearImport();
      await refreshConfig();
      get('import-status').textContent =
        'Đã thay thế cấu hình. Các download mới sẽ dùng cấu hình đã nhập.';
    } else {
      if (response.error === 'CHANNEL_FAILED') unknownWrite = true;
      if (response.error === 'STALE_PREVIEW') invalidatePreview();
      get('import-status').textContent = '';
      get('import-error').textContent = errorMessages[response.error];
    }
    busy = false;
    controls();
    if (!response.ok && response.error === 'STALE_PREVIEW')
      get('preview-import').focus();
    else if (response.ok) field('import-file').focus();
  });
});
get('export-config').addEventListener('click', () => {
  if (busy || !writable || unknownWrite) return;
  busy = true;
  controls();
  get('import-error').textContent = '';
  void requestConfig({ type: 'config.export' }).then((response) => {
    if (response.ok) {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      exportUrl = URL.createObjectURL(
        new Blob([serializeConfig(response.config)], {
          type: 'application/json',
        }),
      );
      const link = get<HTMLAnchorElement>('backup-download');
      link.href = exportUrl;
      link.click();
      get('import-status').textContent =
        'Đã bắt đầu tải bản sao JSON từ cấu hình đã lưu.';
    } else get('import-error').textContent = errorMessages[response.error];
    busy = false;
    controls();
    get('export-config').focus();
  });
});
void refreshConfig();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.config) {
    if (importPreview) {
      invalidatePreview();
      get('import-status').textContent =
        'Cấu hình đã đổi. Hãy xem trước lại trước khi thay thế.';
    }
    void refreshConfig();
  }
});
