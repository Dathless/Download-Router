import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalConfig,
  MAX_IMPORT_BYTES,
  parseImportedConfig,
  parseImportJson,
  serializeConfig,
} from '../../src/core/import-export';
import { matchRule } from '../../src/core/rule-engine';
import {
  handleConfigRequest,
  createMessageHandler,
} from '../../src/background/message-handler';
import {
  mutateConfig,
  previewImport,
  exportConfig,
} from '../../src/storage/config-repository';
import { requestConfig } from '../../src/storage/config-client';
import { parseImportPreview } from '../../src/core/message-validator';
import { memoryStorage, deferred } from '../fixtures/storage';
import { invalidRules, rule, configWithRules } from '../fixtures/rules';
import type { ExtensionConfig } from '../../src/models/config';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/portable-config.json', import.meta.url),
    'utf8',
  ),
) as ExtensionConfig;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TEST-DR-P6-01 canonical export/import and routing equivalence', () => {
  it('preserves IDs, timestamps, list order, filters, inherited conflict and overrides', () => {
    const encoded = serializeConfig(fixture);
    const decoded = parseImportJson(encoded);
    expect(decoded).toEqual(fixture);
    expect(JSON.parse(encoded)).toEqual(fixture);
    expect(Object.keys(decoded)).toEqual([
      'configVersion',
      'settings',
      'rules',
    ]);
    const input = {
      url: 'http://127.0.0.1:8173/files/archive.txt',
      finalUrl: 'https://example.com/',
      filename: 'archive.txt',
      mime: 'text/plain',
    };
    expect(matchRule(input, decoded)).toEqual(matchRule(input, fixture));
    expect(matchRule(input, decoded)).toMatchObject({
      matched: true,
      rule: { id: 'portable-first' },
      conflictAction: 'uniquify',
    });
    const reversed = {
      ...decoded,
      rules: [decoded.rules[1]!, decoded.rules[0]!],
    };
    expect(matchRule(input, reversed)).toMatchObject({
      matched: true,
      rule: { id: 'portable-second' },
      conflictAction: 'overwrite',
    });
  });
  it('exports a field whitelist and takes independent copies of optional filter lists', () => {
    const raw = {
      ...fixture,
      lastRoutingEvent: { url: 'private' },
      version: 999,
      rules: fixture.rules.map((entry) => ({
        ...entry,
        privateUrl: 'private',
        match: { ...entry.match, flags: 'private' },
      })),
    };
    const exported = canonicalConfig(raw);
    expect(exported).toEqual(fixture);
    expect(serializeConfig(raw)).not.toContain('private');
    exported.rules[0]!.match.extensions!.push('pdf');
    expect(raw.rules[0]!.match.extensions).toEqual(['txt']);
    expect(
      canonicalConfig(
        configWithRules([
          { ...rule, match: { ...rule.match, extensions: [], mimeTypes: [] } },
        ]),
      ).rules[0]!.match,
    ).toMatchObject({ extensions: [], mimeTypes: [] });
  });
  it('exports one strict committed snapshot without writing or dropping invalid rules', async () => {
    const storage = memoryStorage(fixture);
    expect(await exportConfig()).toEqual(fixture);
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storage.set).not.toHaveBeenCalled();
    storage.replace({
      ...fixture,
      rules: [...fixture.rules, { ...rule, destination: '../bad' }],
    });
    await expect(exportConfig()).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
    expect(storage.set).not.toHaveBeenCalled();
  });
});

describe('TEST-DR-P6-02/03 reject the entire invalid file before writes', () => {
  it.each(['', '{', 'null', '[]', '{}', '{"configVersion":2}'])(
    'rejects JSON/envelope %j',
    (text) => expect(() => parseImportJson(text)).toThrow(),
  );
  it.each([undefined, 0, 2, 999])(
    'rejects unsupported/missing version %j',
    (version) =>
      expect(() =>
        parseImportedConfig({ ...fixture, configVersion: version }),
      ).toThrow(),
  );
  it.each(invalidRules)(
    'rejects one bad entry instead of keeping its valid neighbours: %j',
    (invalid) =>
      expect(() =>
        parseImportedConfig({ ...fixture, rules: [fixture.rules[0], invalid] }),
      ).toThrow(),
  );
  it.each([
    { ...fixture, settings: { ...fixture.settings, enabled: 'yes' } },
    { ...fixture, settings: { ...fixture.settings, matchRedirectedUrl: 1 } },
    {
      ...fixture,
      settings: { ...fixture.settings, defaultConflictAction: 'replace' },
    },
    { ...fixture, rules: [fixture.rules[0], fixture.rules[0]] },
    { ...fixture, rules: [{ ...rule, id: '' }] },
    { ...fixture, events: [] },
    { ...fixture, settings: { ...fixture.settings, unknown: true } },
    { ...fixture, rules: [{ ...rule, unknown: true }] },
    { ...fixture, rules: [{ ...rule, match: { ...rule.match, flags: 'i' } }] },
    JSON.parse(
      '{"configVersion":1,"settings":{"enabled":true,"matchRedirectedUrl":true,"defaultConflictAction":"uniquify"},"rules":[],"__proto__":{"polluted":true}}',
    ),
  ])(
    'rejects duplicate metadata, wrong settings and unknown fields without storage access: %j',
    async (value) => {
      const storage = memoryStorage(fixture);
      expect(() => parseImportedConfig(value)).toThrow();
      expect(
        await handleConfigRequest({
          type: 'config.previewImport',
          config: value,
        }),
      ).toEqual({ ok: false, error: 'INVALID_MESSAGE' });
      expect(storage.get).not.toHaveBeenCalled();
      expect(storage.set).not.toHaveBeenCalled();
    },
  );
  it('checks UTF-8 file size, not only JS string length', () => {
    expect(() => parseImportJson(' '.repeat(MAX_IMPORT_BYTES + 1))).toThrow(
      '16 MiB',
    );
    expect(() => parseImportJson('é'.repeat(MAX_IMPORT_BYTES / 2 + 1))).toThrow(
      '16 MiB',
    );
  });
});

describe('TEST-DR-P6-04/05 preview, cancellation and queue-bound stale check', () => {
  it('preview/cancel does not write and reports settings/count for a replacement', async () => {
    const storage = memoryStorage(configWithRules([rule]));
    const result = await previewImport(fixture);
    expect(result).toMatchObject({
      config: fixture,
      preview: {
        currentRuleCount: 1,
        currentValid: true,
        currentSettings: configWithRules([]).settings,
      },
    });
    expect(result.preview.snapshot).toMatch(/^[a-f0-9]{64}$/u);
    expect(storage.read()).toEqual(configWithRules([rule]));
    expect(storage.set).not.toHaveBeenCalled();
  });
  it('checks the latest snapshot after a pending toggle inside the same queue', async () => {
    const storage = memoryStorage(configWithRules([rule]));
    const first = await previewImport(fixture);
    const pending = deferred<void>();
    const original = storage.set.getMockImplementation()!;
    storage.set.mockImplementationOnce(async (value) => {
      await pending.promise;
      await original(value);
    });
    const toggle = mutateConfig({
      type: 'settings.update',
      patch: { enabled: false },
    });
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    const imported = mutateConfig({
      type: 'config.import',
      config: fixture,
      expectedSnapshot: first.preview.snapshot,
    });
    const rejected = expect(imported).rejects.toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect(storage.get).toHaveBeenCalledTimes(2);
    pending.resolve();
    await toggle;
    await rejected;
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.read()).toMatchObject({
      settings: { enabled: false },
      rules: [rule],
    });
    const refreshed = await previewImport(fixture);
    expect(
      await mutateConfig({
        type: 'config.import',
        config: fixture,
        expectedSnapshot: refreshed.preview.snapshot,
      }),
    ).toEqual(fixture);
    expect(storage.set.mock.calls[1]).toEqual([{ config: fixture }]);
  });
  it('captures intents before queueing and serializes import followed by an edit on the new config', async () => {
    const storage = memoryStorage(configWithRules([rule]));
    const preview = await previewImport(fixture);
    const candidate = structuredClone(fixture);
    const imported = mutateConfig({
      type: 'config.import',
      config: candidate,
      expectedSnapshot: preview.preview.snapshot,
    });
    candidate.rules.reverse();
    candidate.rules[0]!.name = 'Changed outside queue';
    const edit = mutateConfig({
      type: 'rule.update',
      id: 'portable-first',
      patch: { enabled: false },
    });
    expect(await imported).toEqual(fixture);
    await edit;
    expect((storage.read() as ExtensionConfig).rules[0]).toMatchObject({
      id: 'portable-first',
      enabled: false,
      name: 'First tie winner',
    });
    expect(storage.clear).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    null,
    { configVersion: 999 },
    { ...fixture, rules: [{ ...rule, destination: '../bad' }] },
  ])(
    'explicit preview can replace invalid/absent stored data %j',
    async (raw) => {
      const storage = memoryStorage(raw);
      if (raw === undefined) storage.replace(undefined);
      const preview = await previewImport(fixture);
      expect(preview.preview.currentValid).toBe(false);
      expect(storage.read()).toEqual(raw);
      expect(storage.set).not.toHaveBeenCalled();
      await mutateConfig({
        type: 'config.import',
        config: fixture,
        expectedSnapshot: preview.preview.snapshot,
      });
      expect(storage.read()).toEqual(fixture);
      expect(storage.set).toHaveBeenCalledExactlyOnceWith({ config: fixture });
    },
  );
});

describe('TEST-DR-P6-06 atomic failure, caller/sender and preview boundaries', () => {
  it('keeps old config on a rejected import, then accepts retry without a clear/reset', async () => {
    const storage = memoryStorage(configWithRules([rule]));
    const { preview } = await previewImport(fixture);
    storage.set.mockRejectedValueOnce(new Error('secret URL/token'));
    const command = {
      type: 'config.import' as const,
      config: fixture,
      expectedSnapshot: preview.snapshot,
    };
    expect(await handleConfigRequest(command)).toEqual({
      ok: false,
      error: 'STORAGE_WRITE_FAILED',
    });
    expect(storage.read()).toEqual(configWithRules([rule]));
    expect(await handleConfigRequest(command)).toMatchObject({
      ok: true,
      config: fixture,
    });
    expect(storage.clear).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it('awaits import commit before replying, and rejects unauthorized senders before reading', async () => {
    const storage = memoryStorage(fixture);
    const { preview } = await previewImport(fixture);
    const blocked = deferred<void>();
    const original = storage.set.getMockImplementation()!;
    storage.set.mockImplementationOnce(async (value) => {
      await blocked.promise;
      await original(value);
    });
    const reply = vi.fn();
    const handler = createMessageHandler();
    const command = {
      type: 'config.import',
      config: fixture,
      expectedSnapshot: preview.snapshot,
    };
    expect(
      handler(command, { id: 'outside', url: 'https://evil.test' }, reply),
    ).toBe(false);
    expect(reply).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: 'FORBIDDEN',
    });
    reply.mockClear();
    handler(
      command,
      {
        id: 'test-extension',
        url: 'chrome-extension://test-extension/options/index.html',
      },
      reply,
    );
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(reply).not.toHaveBeenCalled();
    blocked.resolve();
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0]?.[0]).toMatchObject({ ok: true });
  });
  it('validates preview responses; does not accept missing/malformed summaries as success', async () => {
    const storage = memoryStorage(fixture);
    const result = await previewImport(fixture);
    const send = storage.chromeMock.runtime.sendMessage;
    for (const preview of [
      undefined,
      {},
      { ...result.preview, snapshot: 'x' },
      { ...result.preview, currentRuleCount: -1 },
      { ...result.preview, currentValid: 'true' },
      { ...result.preview, currentSettings: {} },
      { ...result.preview, currentValid: true, currentRuleCount: null },
      { ...result.preview, currentValid: true, currentSettings: null },
    ]) {
      send.mockResolvedValueOnce({
        ok: true,
        config: fixture,
        skippedRules: 0,
        preview,
      });
      expect(
        await requestConfig({ type: 'config.previewImport', config: fixture }),
      ).toEqual({ ok: false, error: 'CHANNEL_FAILED' });
    }
    send.mockResolvedValueOnce({
      ok: true,
      config: fixture,
      skippedRules: 0,
      preview: result.preview,
    });
    expect(
      await requestConfig({ type: 'config.previewImport', config: fixture }),
    ).toMatchObject({ ok: true, preview: result.preview });
    expect(
      parseImportPreview({
        snapshot: 'a'.repeat(64),
        currentValid: false,
        currentRuleCount: null,
        currentSettings: null,
      }).currentValid,
    ).toBe(false);
  });
  it.each([
    { type: 'config.export', extra: true },
    {
      type: 'config.previewImport',
      config: fixture,
      expectedSnapshot: 'a'.repeat(64),
    },
    { type: 'config.import', config: fixture },
    { type: 'config.import', config: fixture, expectedSnapshot: 'x' },
    { type: 'config.import', config: fixture, expectedSnapshot: 42 },
  ])('rejects invalid portability intents %j', async (command) => {
    const storage = memoryStorage(fixture);
    expect(await handleConfigRequest(command)).toEqual({
      ok: false,
      error: 'INVALID_MESSAGE',
    });
    expect(storage.get).not.toHaveBeenCalled();
  });
});
