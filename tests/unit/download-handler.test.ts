import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDownloadHandler } from '../../src/background/download-handler';
import { config, item } from '../fixtures/config';

describe('TEST-DR-P0-04 listener completion', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('returns true synchronously and suggests a relative path once', async () => {
    const suggest = vi.fn();
    const handler = createDownloadHandler(() => Promise.resolve(config));
    expect(handler(item, suggest)).toBe(true);
    expect(suggest).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledExactlyOnceWith({
        filename: 'DownloadRouterTest/Local/sample.txt',
        conflictAction: 'uniquify',
      }),
    );
  });

  it.each([
    'disabled',
    'no match',
    'malformed URL',
    'bad envelope',
    'invalid rule',
    'invalid filename',
    'filtered rule',
  ])('falls back without arguments: %s', async (scenario) => {
    const stored = structuredClone(config);
    const download = { ...item };
    if (scenario === 'disabled') stored.settings.enabled = false;
    if (scenario === 'no match')
      download.url = download.finalUrl = 'https://example.test/file';
    if (scenario === 'malformed URL')
      download.url = download.finalUrl = 'not a URL';
    if (scenario === 'invalid rule')
      stored.rules[0]!.destination = '../outside';
    if (scenario === 'invalid filename')
      download.filename = 'C:\\Downloads\\CON.txt';
    if (scenario === 'filtered rule')
      stored.rules[0]!.match.extensions = ['pdf'];
    const suggest = vi.fn();
    createDownloadHandler(() =>
      Promise.resolve(scenario === 'bad envelope' ? {} : stored),
    )(download, suggest);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledExactlyOnceWith());
  });

  it.each([false, true])(
    'handles async rejection or synchronous throw (sync=%s) without logging private data',
    async (sync) => {
      const suggest = vi.fn();
      const failure = () => {
        if (sync) throw new Error('secret-token');
        return Promise.reject(new Error('secret-token'));
      };
      expect(createDownloadHandler(failure)(item, suggest)).toBe(true);
      await vi.waitFor(() => expect(suggest).toHaveBeenCalledExactlyOnceWith());
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(
        'Download Router: routing failed; using Chrome defaults.',
      );
    },
  );
});

describe('TEST-DR-P0-05 watchdog and late completion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['resolve', 'reject'])(
    'falls back at 1000 ms and ignores late %s',
    async (settlement) => {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: Error) => void;
      const stalled = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const suggest = vi.fn();
      createDownloadHandler(() => stalled)(item, suggest);
      await vi.advanceTimersByTimeAsync(999);
      expect(suggest).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(suggest).toHaveBeenCalledExactlyOnceWith();
      if (settlement === 'resolve') resolve(config);
      else reject(new Error('late error'));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(suggest).toHaveBeenCalledExactlyOnceWith();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('clears the watchdog when processing succeeds', async () => {
    const suggest = vi.fn();
    createDownloadHandler(() => Promise.resolve(config))(item, suggest);
    await vi.advanceTimersByTimeAsync(0);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(suggest).toHaveBeenCalledTimes(1);
  });
});
