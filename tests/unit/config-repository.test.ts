import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, item } from '../fixtures/config';
import {
  initializeConfig,
  parseConfig,
} from '../../src/storage/config-repository';
import { createDownloadHandler } from '../../src/background/download-handler';

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

  it('skips unsupported or invalid individual rules without modifying the input', () => {
    const stored = structuredClone(config);
    stored.rules.push({
      ...stored.rules[0]!,
      id: 'bad',
      destination: '../outside',
    });
    stored.rules.push({
      ...stored.rules[0]!,
      id: 'future',
      match: { type: 'regex', pattern: '.*' },
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
