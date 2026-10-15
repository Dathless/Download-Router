import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownloadHandler } from '../../src/background/download-handler';
import { readConfig, mutateConfig } from '../../src/storage/config-repository';
import { item } from '../fixtures/config';
import { configWithRules, rule } from '../fixtures/rules';
import { deferred, memoryStorage } from '../fixtures/storage';
import type { MatchType } from '../../src/models/config';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('TEST-DR-P2-02 handler, repository and full core', () => {
  it('routes through valid rule B while preserving invalid rule A in storage', async () => {
    const raw = configWithRules([
      { ...rule, id: 'invalid', destination: '../escape', priority: 100 },
      rule,
    ]);
    const storage = memoryStorage(raw);
    const suggest = vi.fn();
    createDownloadHandler(readConfig)(
      {
        ...item,
        url: 'https://example.com/download/123',
        finalUrl: '',
        filename: 'C:\\Downloads\\report.PDF',
        mime: 'application/pdf',
      },
      suggest,
    );
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledExactlyOnceWith({
        filename: `${rule.destination}/report.PDF`,
        conflictAction: 'uniquify',
      }),
    );
    expect(storage.read()).toEqual(raw);
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.get).toHaveBeenCalledTimes(1);
  });
  it.each(['bad envelope', 'read rejection'])(
    'falls back once without resetting data: %s',
    async (scenario) => {
      const storage = memoryStorage(
        scenario === 'bad envelope'
          ? { configVersion: 999 }
          : configWithRules([rule]),
      );
      const before = storage.read();
      const suggest = vi.fn();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      if (scenario === 'read rejection')
        storage.get.mockRejectedValueOnce(new Error('private-token'));
      createDownloadHandler(readConfig)(item, suggest);
      await vi.waitFor(() => expect(suggest).toHaveBeenCalledExactlyOnceWith());
      expect(storage.read()).toEqual(before);
      expect(storage.set).not.toHaveBeenCalled();
    },
  );
});

describe('TEST-DR-P2-03 one snapshot per download', () => {
  it('keeps A on its captured snapshot while B observes a completed mutation', async () => {
    const storage = memoryStorage(
      configWithRules([
        { ...rule, match: { type: 'domain', pattern: '127.0.0.1' } },
      ]),
    );
    const captured = deferred<void>();
    const release = deferred<void>();
    let count = 0;
    const handler = createDownloadHandler(async () => {
      const snapshot = await readConfig();
      if (++count === 1) {
        captured.resolve();
        await release.promise;
      }
      return snapshot;
    });
    const a = vi.fn();
    const b = vi.fn();
    handler(item, a);
    await captured.promise;
    await mutateConfig({
      type: 'rule.update',
      id: rule.id,
      patch: { destination: 'DownloadRouterTest/New' },
    });
    handler(item, b);
    await vi.waitFor(() =>
      expect(b).toHaveBeenCalledExactlyOnceWith({
        filename: 'DownloadRouterTest/New/sample.txt',
        conflictAction: 'uniquify',
      }),
    );
    release.resolve();
    await vi.waitFor(() =>
      expect(a).toHaveBeenCalledExactlyOnceWith({
        filename: `${rule.destination}/sample.txt`,
        conflictAction: 'uniquify',
      }),
    );
    expect(count).toBe(2);
    expect(storage.get).toHaveBeenCalledTimes(3);
    expect(storage.set).toHaveBeenCalledTimes(1);
  });
});

describe('TEST-DR-P2-07 full matcher integration and concurrent downloads', () => {
  it.each([
    ['domain', '127.0.0.1'],
    ['prefix', 'http://127.0.0.1/files/'],
    ['glob', 'http://127.0.0.1/files/*.txt'],
    ['regex', '^http://127[.]0[.]0[.]1/files/.*[.]txt$'],
  ] as [MatchType, string][])(
    'routes %s with filters through the production handler',
    async (type, pattern) => {
      memoryStorage(
        configWithRules([
          {
            ...rule,
            match: {
              type,
              pattern,
              extensions: ['txt'],
              mimeTypes: ['TEXT/PLAIN'],
            },
          },
        ]),
      );
      const suggest = vi.fn();
      createDownloadHandler(readConfig)(item, suggest);
      await vi.waitFor(() =>
        expect(suggest).toHaveBeenCalledExactlyOnceWith({
          filename: `${rule.destination}/sample.txt`,
          conflictAction: 'uniquify',
        }),
      );
    },
  );
  it('keeps close downloads independent with one read and one suggestion each', async () => {
    const storage = memoryStorage(
      configWithRules([
        { ...rule, match: { type: 'domain', pattern: '127.0.0.1' } },
      ]),
    );
    const handler = createDownloadHandler(readConfig);
    const suggestions = Array.from({ length: 8 }, () => vi.fn());
    suggestions.forEach((suggest, i) =>
      handler({ ...item, filename: `file-${i}.txt` }, suggest),
    );
    await vi.waitFor(() =>
      suggestions.forEach((suggest, i) =>
        expect(suggest).toHaveBeenCalledExactlyOnceWith({
          filename: `${rule.destination}/file-${i}.txt`,
          conflictAction: 'uniquify',
        }),
      ),
    );
    expect(storage.get).toHaveBeenCalledTimes(8);
    expect(storage.set).not.toHaveBeenCalled();
  });
});
