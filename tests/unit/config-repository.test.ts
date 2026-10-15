import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, item } from '../fixtures/config';
import {
  initializeConfig,
  parseConfig,
  loadConfig,
  mutateConfig,
} from '../../src/storage/config-repository';
import { createDownloadHandler } from '../../src/background/download-handler';
import { deferred, memoryStorage } from '../fixtures/storage';
import { rule, configWithRules } from '../fixtures/rules';
import type { RuleDraft } from '../../src/models/messages';

afterEach(() => vi.unstubAllGlobals());

describe('TEST-DR-P0-02 stored sample configuration', () => {
  it('initializes only absent configuration, never overwrites stored values', async () => {
    for (const existing of [undefined, null, { configVersion: 999 }, config]) {
      const set = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('chrome', {
        storage: {
          local: { get: vi.fn().mockResolvedValue({ config: existing }), set },
        },
      });
      await initializeConfig();
      expect(set).toHaveBeenCalledTimes(existing === undefined ? 1 : 0);
      if (existing === undefined) {
        expect(
          parseConfig(set.mock.calls[0]![0].config).rules[0]?.match.pattern,
        ).toBe('127.0.0.1');
      }
    }
  });

  it('skips invalid individual rules without modifying the input', () => {
    const stored = structuredClone(config);
    stored.rules.push({
      ...stored.rules[0]!,
      id: 'bad',
      destination: '../outside',
    });
    stored.rules.push({
      ...stored.rules[0]!,
      id: 'future',
      match: { type: 'regex', pattern: '(?=a)' },
    });
    expect(parseConfig(stored).rules).toHaveLength(1);
    expect(stored.rules).toHaveLength(3);
    expect(() => parseConfig({ ...stored, configVersion: 2 })).toThrow();
  });

  it('uses priority then stored order across original and redirected domains', async () => {
    const stored = structuredClone(config);
    stored.rules.push({
      ...stored.rules[0]!,
      id: 'final',
      priority: 10,
      match: { type: 'domain', pattern: 'cdn.example.test' },
      destination: 'DownloadRouterTest/CDN',
    });
    const suggest = vi.fn();
    createDownloadHandler(() => Promise.resolve(stored))(
      { ...item, finalUrl: 'https://cdn.example.test/file' },
      suggest,
    );
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledExactlyOnceWith({
        filename: 'DownloadRouterTest/CDN/sample.txt',
        conflictAction: 'uniquify',
      }),
    );
  });
});

describe('TEST-DR-P2-01 installation and version preservation', () => {
  it.each(['update', 'chrome_update', 'shared_module_update', 'startup'])(
    'never seeds missing config on %s',
    async (reason) => {
      const storage = memoryStorage(undefined);
      await initializeConfig(reason);
      expect(storage.get).not.toHaveBeenCalled();
      expect(storage.set).not.toHaveBeenCalled();
    },
  );
  it.each([null, {}, { configVersion: 0 }, { configVersion: 2 }, config])(
    'does not reset any existing install value: %j',
    async (existing) => {
      const storage = memoryStorage(existing);
      await initializeConfig('install');
      expect(storage.read()).toEqual(existing);
      expect(storage.set).not.toHaveBeenCalled();
    },
  );
  it('serializes initialization and writes defaults only once', async () => {
    const storage = memoryStorage();
    storage.replace(undefined);
    await Promise.all([
      initializeConfig('install'),
      initializeConfig('install'),
    ]);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(
      parseConfig(storage.read(), 'strict').settings.defaultConflictAction,
    ).toBe('uniquify');
  });
});

describe('TEST-DR-P2-02 reads and failed writes preserve raw data', () => {
  it('loads valid rules while reporting skipped rules and refuses to silently clean them on mutation', async () => {
    const raw = configWithRules([
      { ...rule, id: 'bad', destination: '../outside' },
      rule,
    ]);
    const storage = memoryStorage(raw);
    expect(await loadConfig()).toEqual({
      config: configWithRules([rule]),
      skippedRules: 1,
    });
    await expect(
      mutateConfig({ type: 'settings.update', patch: { enabled: false } }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(storage.read()).toEqual(raw);
    expect(storage.set).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    null,
    {},
    { ...config, configVersion: 0 },
    { ...config, configVersion: 2 },
  ])('rejects invalid envelope without reset: %j', async (raw) => {
    const storage = memoryStorage();
    storage.replace(raw);
    await expect(loadConfig()).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.read()).toEqual(raw);
  });
  it('returns fixed errors for get/set rejections and leaves data intact', async () => {
    const storage = memoryStorage();
    const before = storage.read();
    storage.get.mockRejectedValueOnce(new Error('private-read-token'));
    await expect(loadConfig()).rejects.toMatchObject({
      code: 'STORAGE_READ_FAILED',
      message: 'STORAGE_READ_FAILED',
    });
    storage.set.mockRejectedValueOnce(new Error('private-write-token'));
    await expect(
      mutateConfig({ type: 'settings.update', patch: { enabled: false } }),
    ).rejects.toMatchObject({
      code: 'STORAGE_WRITE_FAILED',
      message: 'STORAGE_WRITE_FAILED',
    });
    expect(storage.read()).toEqual(before);
    expect(storage.clear).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe('TEST-DR-P2-04 serialized mutation intents', () => {
  it('waits for the complete write before reading the next snapshot and preserves unrelated fields', async () => {
    const storage = memoryStorage();
    const gate = deferred<void>();
    storage.set.mockImplementationOnce(async (value) => {
      await gate.promise;
      storage.replace(value.config);
    });
    const edit = mutateConfig({
      type: 'rule.update',
      id: rule.id,
      patch: { destination: 'DownloadRouterTest/Edited' },
    });
    const toggle = mutateConfig({
      type: 'settings.update',
      patch: { enabled: false },
    });
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(parseConfig(storage.read()).rules[0]!.destination).toBe(
      rule.destination,
    );
    gate.resolve();
    const [edited, toggled] = await Promise.all([edit, toggle]);
    expect(edited.settings.enabled).toBe(true);
    expect(toggled).toMatchObject({
      settings: { enabled: false },
      rules: [{ destination: 'DownloadRouterTest/Edited' }],
    });
    expect(storage.get).toHaveBeenCalledTimes(2);
    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(storage.read()).toEqual(toggled);
  });
  it('keeps the queue usable after read or write failure, without committing the failed intent', async () => {
    const storage = memoryStorage();
    storage.set.mockRejectedValueOnce(new Error('quota'));
    const failed = mutateConfig({
      type: 'rule.update',
      id: rule.id,
      patch: { destination: 'Failed' },
    });
    const next = mutateConfig({
      type: 'settings.update',
      patch: { enabled: false },
    });
    await expect(failed).rejects.toMatchObject({
      code: 'STORAGE_WRITE_FAILED',
    });
    expect(await next).toMatchObject({
      settings: { enabled: false },
      rules: [{ destination: rule.destination }],
    });
    storage.get.mockRejectedValueOnce(new Error('read failure'));
    await expect(
      mutateConfig({ type: 'settings.update', patch: { enabled: true } }),
    ).rejects.toMatchObject({ code: 'STORAGE_READ_FAILED' });
    await expect(
      mutateConfig({
        type: 'settings.update',
        patch: { matchRedirectedUrl: false },
      }),
    ).resolves.toMatchObject({
      settings: { enabled: false, matchRedirectedUrl: false },
    });
    expect(storage.clear).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it('captures queued intent and merges nested match edits without losing a toggle or metadata', async () => {
    const storage = memoryStorage();
    const patch = { match: { extensions: ['pdf'] } };
    const edit = mutateConfig({ type: 'rule.update', id: rule.id, patch });
    patch.match.extensions.push('zip');
    const toggle = mutateConfig({
      type: 'rule.update',
      id: rule.id,
      patch: { enabled: false },
    });
    await edit;
    expect((await toggle).rules[0]).toMatchObject({
      id: rule.id,
      createdAt: rule.createdAt,
      enabled: false,
      match: { type: 'domain', pattern: 'example.com', extensions: ['pdf'] },
    });
    expect(storage.set).toHaveBeenCalledTimes(2);
  });
  it('appends create/duplicate, keeps edit order and supports clearing a conflict override', async () => {
    memoryStorage(configWithRules([{ ...rule, conflictAction: 'overwrite' }]));
    const draft: RuleDraft = {
      name: 'New',
      enabled: true,
      match: { ...rule.match },
      destination: 'New',
      priority: 10,
    };
    const created = await mutateConfig({ type: 'rule.create', rule: draft });
    const newRule = created.rules[1]!;
    expect(newRule.id).not.toBe(rule.id);
    expect(newRule.createdAt).toBeGreaterThan(0);
    const duplicate = await mutateConfig({
      type: 'rule.duplicate',
      id: rule.id,
    });
    expect(duplicate.rules).toHaveLength(3);
    expect(new Set(duplicate.rules.map((entry) => entry.id)).size).toBe(3);
    expect(duplicate.rules[2]!.name).toBe(`${rule.name} (copy)`);
    const edited = await mutateConfig({
      type: 'rule.update',
      id: rule.id,
      patch: { conflictAction: null, name: 'Edited' },
    });
    expect(edited.rules.map((entry) => entry.id)).toEqual(
      duplicate.rules.map((entry) => entry.id),
    );
    expect(edited.rules[0]!.conflictAction).toBeUndefined();
    expect(edited.rules[0]!.createdAt).toBe(rule.createdAt);
    expect(
      (await mutateConfig({ type: 'rule.delete', id: newRule.id })).rules.map(
        (entry) => entry.id,
      ),
    ).toEqual([rule.id, duplicate.rules[2]!.id]);
  });
  it('rejects a missing target without writing, then accepts the next request', async () => {
    const storage = memoryStorage();
    await expect(
      mutateConfig({ type: 'rule.delete', id: 'missing' }),
    ).rejects.toMatchObject({ code: 'RULE_NOT_FOUND' });
    expect(storage.set).not.toHaveBeenCalled();
    await mutateConfig({ type: 'settings.update', patch: { enabled: false } });
    expect(storage.set).toHaveBeenCalledTimes(1);
  });
});
