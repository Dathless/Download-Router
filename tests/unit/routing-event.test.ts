import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownloadHandler } from '../../src/background/download-handler';
import {
  parseRoutingEvent,
  readRoutingEvent,
  saveRoutingEvent,
} from '../../src/storage/routing-event';
import { config, item } from '../fixtures/config';
import { deferred } from '../fixtures/storage';

const event = {
  timestamp: 1,
  ruleId: 'test-rule',
  basename: 'sample.txt',
  destination: 'DownloadRouterTest/Local',
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TEST-DR-P4-03 routing status cannot delay completion', () => {
  it('records only whitelisted fields after suggest, without awaiting the pending status write', async () => {
    const pending = deferred<void>();
    const suggest = vi.fn();
    const record = vi.fn(() => {
      expect(suggest).toHaveBeenCalledTimes(1);
      return pending.promise;
    });
    createDownloadHandler(async () => config, record)(
      { ...item, url: `${item.url}?token=secret`, finalUrl: '' },
      suggest,
    );
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const recorded = record.mock.calls[0] as unknown as [{ timestamp: number }];
    expect(recorded[0]).toEqual({
      ...event,
      ruleId: config.rules[0]!.id,
      timestamp: expect.any(Number),
    });
    expect(JSON.stringify(recorded)).not.toContain('token');
    expect(suggest).toHaveBeenCalledExactlyOnceWith({
      filename: 'DownloadRouterTest/Local/sample.txt',
      conflictAction: 'uniquify',
    });
    pending.resolve();
  });
  it.each(['throw', 'reject'])(
    'isolates a status writer %s without logging private data',
    async (failure) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const suggest = vi.fn();
      const record = vi.fn(() => {
        if (failure === 'throw') throw new Error('private-token');
        return Promise.reject(new Error('private-token'));
      });
      createDownloadHandler(async () => config, record)(item, suggest);
      await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      expect(suggest).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    },
  );
  it.each(['disabled', 'no-match', 'invalid', 'read-error', 'suggest-error'])(
    'does not record a fallback or failed suggest: %s',
    async (scenario) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const record = vi.fn();
      const suggest = vi.fn(() => {
        if (scenario === 'suggest-error') throw new Error('closed');
      });
      const next = structuredClone(config);
      if (scenario === 'disabled') next.settings.enabled = false;
      const download =
        scenario === 'no-match'
          ? { ...item, url: 'https://example.test/x', finalUrl: '' }
          : item;
      createDownloadHandler(async () => {
        if (scenario === 'read-error') throw new Error('private-token');
        return scenario === 'invalid' ? {} : next;
      }, record)(download, suggest);
      await vi.waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
      expect(record).not.toHaveBeenCalled();
    },
  );
  it('never records after a watchdog fallback and late successful read', async () => {
    vi.useFakeTimers();
    const read = deferred<unknown>();
    const suggest = vi.fn();
    const record = vi.fn();
    createDownloadHandler(() => read.promise, record)(item, suggest);
    await vi.advanceTimersByTimeAsync(1000);
    read.resolve(config);
    await vi.advanceTimersByTimeAsync(1000);
    expect(suggest).toHaveBeenCalledExactlyOnceWith();
    expect(record).not.toHaveBeenCalled();
  });
});

describe('TEST-DR-P4-03 isolated single-event storage; TEST-DR-P4-04 privacy', () => {
  it('reads absent, valid and malformed data without changing storage', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ lastRoutingEvent: event })
      .mockResolvedValueOnce({
        lastRoutingEvent: {
          ...event,
          url: 'https://example.com/?token=secret',
        },
      });
    const set = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { get, set } } });
    expect(await readRoutingEvent()).toBeNull();
    expect(await readRoutingEvent()).toEqual(event);
    await expect(readRoutingEvent()).rejects.toThrow('Invalid routing event.');
    expect(get).toHaveBeenCalledWith('lastRoutingEvent');
    expect(set).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { ...event, timestamp: -1 },
    { ...event, timestamp: NaN },
    { ...event, ruleId: '' },
    { ...event, basename: '../bad' },
    { ...event, destination: '../escape' },
    { ...event, mime: 'application/pdf' },
  ])('rejects invalid or extra data: %j', (value) => {
    expect(() => parseRoutingEvent(value)).toThrow('Invalid routing event.');
  });
  it('serializes two status writes, captures input, recovers after rejection and never writes config', async () => {
    const pending = deferred<void>();
    const set = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { set } } });
    const draft = { ...event, destination: 'DownloadRouterTest\\Local' };
    const first = saveRoutingEvent(draft);
    draft.basename = 'changed.txt';
    const second = saveRoutingEvent({ ...event, timestamp: 2 });
    const rejected = expect(first).rejects.toThrow('quota');
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set.mock.calls[0]).toEqual([{ lastRoutingEvent: event }]);
    pending.reject(new Error('quota'));
    await rejected;
    await second;
    expect(set.mock.calls[1]).toEqual([
      { lastRoutingEvent: { ...event, timestamp: 2 } },
    ]);
  });
});
