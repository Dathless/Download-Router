import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, memoryStorage } from '../fixtures/storage';
import { configWithRules, rule } from '../fixtures/rules';

function dom() {
  const elements = new Map<
    string,
    {
      textContent: string;
      disabled: boolean;
      hidden: boolean;
      focus: ReturnType<typeof vi.fn>;
      attributes: Record<string, string>;
      listeners: Record<string, () => void>;
      setAttribute: (name: string, value: string) => void;
      addEventListener: (name: string, handler: () => void) => void;
    }
  >();
  const get = (id: string) => {
    if (!elements.has(id)) {
      const element = {
        textContent: '',
        disabled: false,
        hidden: false,
        focus: vi.fn(),
        attributes: {} as Record<string, string>,
        listeners: {} as Record<string, () => void>,
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
        addEventListener(name: string, handler: () => void) {
          this.listeners[name] = handler;
        },
      };
      elements.set(id, element);
    }
    return elements.get(id)!;
  };
  vi.stubGlobal('document', { getElementById: get });
  return { get, click: (id: string) => get(id).listeners.click!() };
}

async function setup(rules = [rule]) {
  vi.resetModules();
  const storage = memoryStorage(configWithRules(rules));
  const page = dom();
  const openOptionsPage = vi.fn().mockResolvedValue(undefined);
  Object.assign(storage.chromeMock.runtime, { openOptionsPage });
  const { handleConfigRequest } =
    await import('../../src/background/message-handler');
  storage.chromeMock.runtime.sendMessage.mockImplementation(
    handleConfigRequest,
  );
  await import('../../src/popup/index');
  await vi.waitFor(() => expect(page.get('toggle').disabled).toBe(false));
  const change = (changes: Record<string, unknown>, area = 'local') =>
    storage.chromeMock.storage.onChanged.addListener.mock.calls[0]![0](
      changes,
      area,
    );
  return { ...storage, ...page, openOptionsPage, change };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TEST-DR-P4-01 popup saved state and mutations', () => {
  it('handles zero rules and counts only enabled rules', async () => {
    const page = await setup([]);
    expect(page.get('rule-count').textContent).toContain('0/0');
    const next = configWithRules([
      rule,
      { ...rule, id: 'off', enabled: false },
    ]);
    page.replace(next);
    page.change({ config: {} });
    await vi.waitFor(() =>
      expect(page.get('rule-count').textContent).toContain('1/2'),
    );
  });
  it('waits for the real repository commit, blocks repeated input and preserves rules', async () => {
    const page = await setup();
    const write = deferred<void>();
    const original = page.set.getMockImplementation()!;
    page.set.mockImplementationOnce(async (value) => {
      await write.promise;
      await original(value);
    });
    page.click('toggle');
    page.click('toggle');
    await vi.waitFor(() => expect(page.set).toHaveBeenCalledTimes(1));
    expect(page.get('toggle').disabled).toBe(true);
    expect(page.get('toggle').attributes['aria-checked']).toBe('true');
    expect(page.get('action-status').textContent).toBe('Đang lưu…');
    expect(page.read()).toMatchObject({ settings: { enabled: true } });
    write.resolve();
    await vi.waitFor(() => expect(page.get('toggle').disabled).toBe(false));
    expect(page.get('toggle').attributes['aria-checked']).toBe('false');
    expect(page.read()).toMatchObject({
      rules: [rule],
      settings: { enabled: false, matchRedirectedUrl: true },
    });
    expect(
      page.chromeMock.runtime.sendMessage.mock.calls.filter(
        ([message]) => message.type === 'settings.update',
      ),
    ).toEqual([[{ type: 'settings.update', patch: { enabled: false } }]]);
  });
  it('shows a rejected write without success or data loss, then permits retry', async () => {
    const page = await setup();
    page.set.mockRejectedValueOnce(new Error('private-token'));
    page.click('toggle');
    await vi.waitFor(() =>
      expect(page.get('error').textContent).toContain('Không lưu'),
    );
    expect(page.get('toggle').attributes['aria-checked']).toBe('true');
    expect(page.get('action-status').textContent).toBe('');
    expect(page.read()).toEqual(configWithRules([rule]));
    page.click('toggle');
    await vi.waitFor(() =>
      expect(page.get('toggle').attributes['aria-checked']).toBe('false'),
    );
  });
  it('locks an unknown write outcome until reread, without retrying the mutation', async () => {
    const page = await setup();
    const send = page.chromeMock.runtime.sendMessage;
    send.mockRejectedValueOnce(new Error('channel closed'));
    page.click('toggle');
    await vi.waitFor(() =>
      expect(page.get('error').textContent).toContain('chưa rõ'),
    );
    expect(page.get('toggle').disabled).toBe(true);
    page.click('toggle');
    expect(
      send.mock.calls.filter(([message]) => message.type === 'settings.update'),
    ).toHaveLength(1);
    page.click('reload');
    await vi.waitFor(() => expect(page.get('toggle').disabled).toBe(false));
    expect(page.get('error').textContent).toBe('');
  });
});

describe('TEST-DR-P4-02/04 popup refresh and status errors', () => {
  it('ignores stale reads and unrelated storage events; marks unreadable config unavailable', async () => {
    const page = await setup();
    const send = page.chromeMock.runtime.sendMessage;
    const pending = deferred<unknown>();
    send.mockReturnValueOnce(pending.promise);
    page.change({ config: {} });
    page.replace({
      ...configWithRules([rule]),
      settings: { ...configWithRules([]).settings, enabled: false },
    });
    page.change({ config: {} });
    await vi.waitFor(() =>
      expect(page.get('toggle').attributes['aria-checked']).toBe('false'),
    );
    pending.resolve({
      ok: true,
      config: configWithRules([rule]),
      skippedRules: 0,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(page.get('toggle').attributes['aria-checked']).toBe('false');
    const calls = send.mock.calls.length;
    page.change({ config: {} }, 'sync');
    page.change({ other: {} });
    expect(send).toHaveBeenCalledTimes(calls);
    page.replace({ configVersion: 999 });
    page.change({ config: {} });
    await vi.waitFor(() =>
      expect(page.get('config-status').textContent).toContain('Chưa đọc'),
    );
    expect(page.get('toggle').disabled).toBe(true);
    expect(page.get('rule-count').textContent).toBe('Chưa biết số rule.');
  });
  it('blocks mutation of a config with skipped invalid rules', async () => {
    const page = await setup();
    page.replace(
      configWithRules([rule, { ...rule, id: 'bad', destination: '../bad' }]),
    );
    page.change({ config: {} });
    await vi.waitFor(() =>
      expect(page.get('config-status').textContent).toContain('Bỏ qua 1'),
    );
    expect(page.get('toggle').disabled).toBe(true);
  });
  it('handles absent, changed and unreadable event independently from routing config', async () => {
    const page = await setup();
    expect(page.get('event-status').textContent).toContain('Chưa có');
    page.chromeMock.storage.local.get.mockImplementationOnce(async () => ({
      config: undefined,
      lastRoutingEvent: {
        timestamp: 1,
        ruleId: '<b>text</b>',
        basename: 'report.pdf',
        destination: 'PDF',
      },
    }));
    page.change({ lastRoutingEvent: {} });
    await vi.waitFor(() =>
      expect(page.get('event-basename').textContent).toBe('report.pdf'),
    );
    expect(page.get('event-rule').textContent).toBe('<b>text</b>');
    page.chromeMock.storage.local.get.mockRejectedValueOnce(
      new Error('private-token'),
    );
    page.change({ lastRoutingEvent: {} });
    await vi.waitFor(() =>
      expect(page.get('event-status').textContent).toContain('Không đọc'),
    );
    expect(page.get('event-details').hidden).toBe(true);
    expect(page.get('toggle').disabled).toBe(false);
  });
  it('opens options and shows a safe message if opening fails', async () => {
    const page = await setup();
    page.click('options');
    expect(page.openOptionsPage).toHaveBeenCalledTimes(1);
    page.openOptionsPage.mockRejectedValueOnce(new Error('private-token'));
    page.click('options');
    await vi.waitFor(() =>
      expect(page.get('error').textContent).toContain('Không mở'),
    );
    expect(page.get('error').textContent).not.toContain('private-token');
  });
});
