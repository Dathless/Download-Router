import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPath, getBasename } from '../../src/core/path-builder';
import { parseConfig } from '../../src/core/config-validator';
import { matchRule } from '../../src/core/rule-engine';
import { createDownloadHandler } from '../../src/background/download-handler';
import { readConfig } from '../../src/storage/config-repository';
import { reliabilityConfig, percentiles } from '../fixtures/reliability';
import { config, item } from '../fixtures/config';
import { memoryStorage } from '../fixtures/storage';

const corpus = JSON.parse(
  readFileSync(
    new URL('../fixtures/path-corpus.json', import.meta.url),
    'utf8',
  ),
) as {
  valid: { id: string; filename: string; destination: string }[];
  invalidDestinations: string[];
  invalidBasenames: string[];
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TEST-DR-P5-01 shared path regression corpus', () => {
  it.each(corpus.valid)(
    'preserves $id basename and normalizes separators',
    ({ filename, destination }) => {
      expect(buildPath(destination, filename)).toBe(
        `${destination.replaceAll('\\', '/')}/${filename}`,
      );
      for (const prefix of ['C:\\Downloads\\', '/home/test/Downloads/'])
        expect(getBasename(prefix + filename)).toBe(filename);
    },
  );
  it.each(corpus.invalidDestinations)(
    'never repairs unsafe destination %j',
    (value) => expect(buildPath(value, 'safe.txt')).toBeNull(),
  );
  it.each(corpus.invalidBasenames)('rejects unsafe basename %j', (value) =>
    expect(buildPath('DownloadRouterTest/Phase5', value)).toBeNull(),
  );
  it('falls back safely for a component beyond the accepted 255 UTF-16 units', async () => {
    const suggest = vi.fn();
    createDownloadHandler(async () => config)(
      { ...item, filename: `${'a'.repeat(256)}.txt` },
      suggest,
    );
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledExactlyOnceWith());
  });
});

describe('TEST-DR-P5-03 config preservation and independent invocations', () => {
  it('does not persist repairs when a valid rule follows an invalid one', async () => {
    const raw = structuredClone(config);
    raw.rules.unshift({
      ...raw.rules[0]!,
      id: 'bad',
      destination: '../escape',
      priority: 10000,
    });
    const storage = memoryStorage(raw);
    const suggest = vi.fn();
    createDownloadHandler(readConfig)(item, suggest);
    await vi.waitFor(() =>
      expect(suggest).toHaveBeenCalledExactlyOnceWith({
        filename: 'DownloadRouterTest/Local/sample.txt',
        conflictAction: 'uniquify',
      }),
    );
    expect(storage.read()).toEqual(raw);
    expect(storage.set).not.toHaveBeenCalled();
  });
});

describe('TEST-DR-P5-04 reproducible 200-rule handler baseline', () => {
  it('records cold first invocation and warm percentiles with the complete shared pipeline', async () => {
    const benchmark = process.env.DOWNLOAD_ROUTER_BENCHMARK === '1';
    const normal = reliabilityConfig();
    const adversarial = structuredClone(normal);
    adversarial.rules.forEach((rule) => {
      rule.match = {
        type: 'regex',
        pattern: '^http://127[.]0[.]0[.]1:8173/files/(a+)+$',
      };
    });
    const prefix = 'http://127.0.0.1:8173/files/';
    const longInput = {
      ...item,
      url: prefix + 'a'.repeat(8192 - prefix.length - 1) + '!',
      finalUrl: '',
      filename: 'bench.txt',
    };
    const reports = [];
    for (const workload of [
      {
        name: 'mixed-200',
        config: normal,
        input: {
          ...item,
          url: 'http://127.0.0.1:8173/files/bench.txt',
          finalUrl: '',
        },
        matched: true,
        warm: benchmark ? 100 : 0,
      },
      {
        name: 'adversarial-regex-200-input-8192',
        config: adversarial,
        input: longInput,
        matched: false,
        warm: benchmark ? 20 : 0,
      },
    ]) {
      expect(parseConfig(workload.config, 'strict').rules).toHaveLength(200);
      const samples: number[] = [];
      const handler = createDownloadHandler(async () =>
        structuredClone(workload.config),
      );
      for (let index = 0; index <= workload.warm; index++) {
        const start = performance.now();
        const suggestion = await new Promise<
          chrome.downloads.FilenameSuggestion | undefined
        >((resolve) => handler(workload.input, resolve));
        samples.push(performance.now() - start);
        if (workload.matched)
          expect(suggestion?.filename).toBe(
            'DownloadRouterTest/Phase5/Performance/sample.txt',
          );
        else expect(suggestion).toBeUndefined();
        // Profiling changes latency; enforce the performance gate only in the dedicated unprofiled run.
        if (benchmark) expect(samples.at(-1)).toBeLessThan(1000);
      }
      expect(
        matchRule(
          { ...workload.input, filename: 'sample.txt' },
          workload.config,
        ).matched,
      ).toBe(workload.matched);
      reports.push({
        workload: workload.name,
        rules: 200,
        inputLength: workload.input.url.length,
        coldFirstInvocationMs: samples[0],
        warmMs: benchmark ? percentiles(samples.slice(1)) : null,
        rawMs: samples,
        storageBoundary:
          'in-memory async snapshot clone; no Chrome storage timing',
        watchdogThresholdMs: 1000,
      });
    }
    if (benchmark) {
      mkdirSync('.test-artifacts/benchmarks', { recursive: true });
      writeFileSync(
        '.test-artifacts/benchmarks/handler.json',
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            node: process.version,
            platform: platform(),
            arch: arch(),
            cpu: cpus()[0]?.model,
            measurementMode:
              'Dedicated Vitest run without coverage; async in-memory storage boundary',
            reports,
          },
          null,
          2,
        ) + '\n',
      );
    }
  }, 30000);
});

describe('TEST-DR-P5-05 logging cannot break completion or leak data', () => {
  it('isolates a throwing logger from a failed config read', async () => {
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('logger failed');
    });
    const suggest = vi.fn();
    createDownloadHandler(async () => {
      throw new Error('https://private.test/?token=secret');
    })(item, suggest);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledExactlyOnceWith());
    expect(logger).toHaveBeenCalledExactlyOnceWith(
      'Download Router: routing failed; using Chrome defaults.',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
