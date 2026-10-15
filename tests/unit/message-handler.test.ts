import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMessageHandler,
  handleConfigRequest,
} from '../../src/background/message-handler';
import { requestConfig } from '../../src/storage/config-client';
import { deferred, memoryStorage } from '../fixtures/storage';
import { rule, configWithRules } from '../fixtures/rules';

afterEach(() => vi.unstubAllGlobals());
const sender = {
  id: 'test-extension',
  url: 'chrome-extension://test-extension/options/index.html',
};

describe('TEST-DR-P2-05 message contract at the background boundary', () => {
  it('accepts a JSON create intent and preserves server metadata through updates', async () => {
    const storage = memoryStorage();
    const response = await handleConfigRequest(
      JSON.parse(
        JSON.stringify({
          type: 'rule.create',
          rule: {
            name: 'Created',
            enabled: true,
            match: { type: 'regex', pattern: '^https://' },
            destination: 'New',
            priority: 10,
          },
        }),
      ),
    );
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('Expected successful create');
    const created = response.config.rules[1]!;
    expect(created.id).not.toBe(rule.id);
    expect(created.createdAt).toBeGreaterThan(0);
    const updated = await handleConfigRequest({
      type: 'rule.update',
      id: created.id,
      patch: { enabled: false, conflictAction: 'prompt' },
    });
    expect(updated).toMatchObject({
      ok: true,
      config: {
        rules: [
          rule,
          {
            ...created,
            enabled: false,
            conflictAction: 'prompt',
            updatedAt: expect.any(Number),
          },
        ],
      },
    });
    expect(storage.set).toHaveBeenCalledTimes(2);
  });
  it('rejects prototype and unexpected nested fields before accessing storage', async () => {
    const storage = memoryStorage();
    const poisoned = JSON.parse(
      '{"type":"settings.update","patch":{"__proto__":{"enabled":false}}}',
    );
    expect(await handleConfigRequest(poisoned)).toEqual({
      ok: false,
      error: 'INVALID_MESSAGE',
    });
    expect(
      await handleConfigRequest({
        type: 'rule.create',
        rule: {
          name: 'X',
          enabled: true,
          destination: 'X',
          priority: 1,
          match: { type: 'regex', pattern: '.*', flags: 'i' },
        },
      }),
    ).toEqual({ ok: false, error: 'INVALID_MESSAGE' });
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });
  it.each([
    null,
    'config.get',
    [],
    {},
    { type: 'unknown' },
    { type: 'config.get', config: configWithRules([]) },
    { type: 'config.replace', config: configWithRules([]) },
    { type: 'settings.update', patch: {} },
    { type: 'settings.update', patch: [] },
    { type: 'settings.update', patch: { rules: [] } },
    { type: 'settings.update', patch: { enabled: 'false' } },
    { type: 'settings.update', patch: { defaultConflictAction: 'delete' } },
    { type: 'rule.create', rule },
    { type: 'rule.create', rule: { name: 'Missing fields' } },
    { type: 'rule.update', id: ' ', patch: { name: 'X' } },
    { type: 'rule.update', id: rule.id, patch: [] },
    { type: 'rule.update', id: rule.id, patch: {} },
    { type: 'rule.update', id: rule.id, patch: { id: 'new-id' } },
    { type: 'rule.update', id: rule.id, patch: { createdAt: 123 } },
    { type: 'rule.update', id: rule.id, patch: { destination: '../outside' } },
    { type: 'rule.update', id: rule.id, patch: { priority: '100' } },
    { type: 'rule.update', id: rule.id, patch: { priority: NaN } },
    { type: 'rule.update', id: rule.id, patch: { match: null } },
    { type: 'rule.update', id: rule.id, patch: { match: {} } },
    { type: 'rule.update', id: rule.id, patch: { match: { flags: 'i' } } },
    {
      type: 'rule.update',
      id: rule.id,
      patch: { match: { type: 'regex', pattern: '(?=a)' } },
    },
    { type: 'rule.delete' },
    { type: 'rule.duplicate', id: 1 },
  ])('rejects invalid request before any write: %j', async (message) => {
    const storage = memoryStorage();
    const before = storage.read();
    expect(await handleConfigRequest(message)).toEqual({
      ok: false,
      error: 'INVALID_MESSAGE',
    });
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.read()).toEqual(before);
  });
  it.each([
    {},
    { ...sender, id: 'another-extension' },
    { ...sender, url: 'https://example.com/' },
    {
      ...sender,
      url: 'chrome-extension://test-extension.evil/options/index.html',
    },
  ])('rejects non-extension-page senders: %j', (untrusted) => {
    const storage = memoryStorage();
    const reply = vi.fn();
    expect(
      createMessageHandler()({ type: 'config.get' }, untrusted, reply),
    ).toBe(false);
    expect(reply).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: 'FORBIDDEN',
    });
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });
  it('returns literal true and replies success only after the full write completes', async () => {
    const storage = memoryStorage();
    const gate = deferred<void>();
    const reply = vi.fn();
    storage.set.mockImplementationOnce(async (value) => {
      await gate.promise;
      storage.replace(value.config);
    });
    expect(
      createMessageHandler()(
        { type: 'settings.update', patch: { enabled: false } },
        sender,
        reply,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(reply).not.toHaveBeenCalled();
    gate.resolve();
    await vi.waitFor(() =>
      expect(reply).toHaveBeenCalledExactlyOnceWith({
        ok: true,
        config: {
          ...configWithRules([rule]),
          settings: {
            enabled: false,
            matchRedirectedUrl: true,
            defaultConflictAction: 'uniquify',
          },
        },
        skippedRules: 0,
      }),
    );
  });
  it('surfaces unsupported version and storage failures without private error text', async () => {
    const storage = memoryStorage({ configVersion: 999 });
    expect(await handleConfigRequest({ type: 'config.get' })).toEqual({
      ok: false,
      error: 'INVALID_CONFIG',
    });
    storage.get.mockRejectedValueOnce(new Error('private token'));
    expect(await handleConfigRequest({ type: 'config.get' })).toEqual({
      ok: false,
      error: 'STORAGE_READ_FAILED',
    });
    storage.replace(configWithRules([rule]));
    storage.set.mockRejectedValueOnce(new Error('private token'));
    expect(
      await handleConfigRequest({
        type: 'settings.update',
        patch: { enabled: false },
      }),
    ).toEqual({ ok: false, error: 'STORAGE_WRITE_FAILED' });
  });
  it('keeps committed data when caller closes before reply', async () => {
    const storage = memoryStorage();
    const reply = vi.fn(() => {
      throw new Error('closed');
    });
    createMessageHandler()(
      { type: 'settings.update', patch: { enabled: false } },
      sender,
      reply,
    );
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(storage.read()).toMatchObject({ settings: { enabled: false } });
  });
});

describe('TEST-DR-P2-05 production caller response handling', () => {
  it.each([
    undefined,
    null,
    {},
    { ok: true, config: {}, skippedRules: 0 },
    { ok: false, error: 'secret' },
    { ok: true, config: configWithRules([]), skippedRules: -1 },
  ])(
    'rejects malformed replies without assuming success: %j',
    async (response) => {
      const storage = memoryStorage();
      storage.chromeMock.runtime.sendMessage.mockResolvedValue(response);
      expect(await requestConfig({ type: 'config.get' })).toEqual({
        ok: false,
        error: 'CHANNEL_FAILED',
      });
    },
  );
  it('accepts validated success and explicit failure; never retries a failed channel', async () => {
    const storage = memoryStorage();
    const send = storage.chromeMock.runtime.sendMessage;
    send.mockResolvedValueOnce({
      ok: true,
      config: configWithRules([rule]),
      skippedRules: 0,
    });
    expect(await requestConfig({ type: 'config.get' })).toEqual({
      ok: true,
      config: configWithRules([rule]),
      skippedRules: 0,
    });
    send.mockResolvedValueOnce({ ok: false, error: 'INVALID_CONFIG' });
    expect(await requestConfig({ type: 'config.get' })).toEqual({
      ok: false,
      error: 'INVALID_CONFIG',
    });
    send.mockRejectedValueOnce(new Error('closed'));
    expect(
      await requestConfig({
        type: 'settings.update',
        patch: { enabled: false },
      }),
    ).toEqual({ ok: false, error: 'CHANNEL_FAILED' });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
