import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus } from 'node:os';
import ts from 'typescript';
import pathCorpus from '../../tests/fixtures/path-corpus.json' with { type: 'json' };
import {
  reliabilityConfig,
  percentiles,
} from '../../tests/fixtures/reliability.ts';
import { textFixture, replacementFixture } from '../fixture-server.mjs';

export async function runReliabilityE2E({
  page,
  context,
  fixture,
  download,
  verifyDownload,
  waitFor,
  downloads,
}) {
  const results = [];
  const origin = `chrome-extension://${new URL(page.url()).hostname}`;
  async function request(message) {
    const response = await page.evaluate(
      (value) => chrome.runtime.sendMessage(value),
      message,
    );
    assert.equal(response.ok, true);
    return response.config;
  }
  const configBefore = await request({ type: 'config.get' });
  for (const rule of configBefore.rules)
    await request({ type: 'rule.delete', id: rule.id });
  const created = await request({
    type: 'rule.create',
    rule: {
      name: 'Reliability fixture',
      enabled: true,
      match: { type: 'domain', pattern: '127.0.0.1' },
      destination: 'DownloadRouterTest/Phase5/Paths',
      priority: 1000,
    },
  });
  const ruleId = created.rules[0].id;
  const files = [];
  for (const entry of pathCorpus.valid) {
    await request({
      type: 'rule.update',
      id: ruleId,
      patch: { destination: entry.destination },
    });
    files.push(
      await download(
        fixture.origin,
        '#direct',
        `${entry.destination.replaceAll('\\', '/')}/${entry.filename}`,
        textFixture,
        `/cases/${entry.id}`,
      ),
    );
  }
  results.push({
    id: 'TEST-DR-P5-01',
    status: 'pass',
    sharedCorpus: 'tests/fixtures/path-corpus.json',
    unsafePathsRejectedByUnitCorpus: true,
    actualBasenames: files,
    longestTestedBasenameUnits: Math.max(
      ...pathCorpus.valid.map((entry) => entry.filename.length),
    ),
    longerPlatformPaths: 'not claimed',
  });

  const conflictFiles = [];
  for (const action of ['uniquify', 'overwrite']) {
    const target = `DownloadRouterTest/Phase5/Conflict/${action}`;
    await request({
      type: 'rule.update',
      id: ruleId,
      patch: { destination: target, conflictAction: action },
    });
    const first = await download(
      fixture.origin,
      '#direct',
      `${target}/conflict.txt`,
      textFixture,
      '/conflict/old',
    );
    const nextPath = `${target}/${action === 'uniquify' ? 'conflict (1).txt' : 'conflict.txt'}`;
    const second = await download(
      fixture.origin,
      '#direct',
      nextPath,
      replacementFixture,
      '/conflict/new',
    );
    assert.notEqual(first.downloadId, second.downloadId);
    assert.notEqual(first.sha256, second.sha256);
    assert.equal(
      readFileSync(join(downloads, target, 'conflict.txt'), 'utf8'),
      action === 'uniquify' ? textFixture : replacementFixture,
    );
    conflictFiles.push({
      action,
      first,
      second,
      originalPreserved: action === 'uniquify',
    });
  }
  results.push({
    id: 'PHASE5-CONFLICT-AUTOMATED',
    status: 'pass',
    testId: 'TEST-DR-P5-02',
    saveAsSetting: false,
    files: conflictFiles,
    nativePromptAndSaveAs:
      'Separate scripts/e2e/native-dialogs.mjs + human dialog actions; not inferred from these automated cases.',
  });

  const network = [];
  const observeRequest = (request) => {
    const url = request.url();
    if (/^https?:/u.test(url)) network.push(url);
  };
  context.on('request', observeRequest);
  const worker = context
    .serviceWorkers()
    .find((worker) => worker.url() === `${origin}/background.js`);
  assert.ok(worker);
  await worker.evaluate(() => {
    globalThis.__phase5Warn = console.warn;
    globalThis.__phase5Logs = [];
    console.warn = (...args) => {
      globalThis.__phase5Logs.push(args.map(String));
      globalThis.__phase5Warn(...args);
    };
  });
  await request({
    type: 'rule.update',
    id: ruleId,
    patch: {
      destination: 'DownloadRouterTest/Phase5/Preserved',
      conflictAction: 'uniquify',
    },
  });
  const good = await request({ type: 'config.get' });
  const invalidRule = {
    ...good.rules[0],
    id: 'invalid-private-rule',
    name: 'PHASE5_PRIVATE_TOKEN',
    destination: '../PHASE5_PRIVATE_TOKEN',
    priority: 99999,
  };
  const partiallyInvalid = { ...good, rules: [invalidRule, ...good.rules] };
  await page.evaluate(
    (config) => chrome.storage.local.set({ config }),
    partiallyInvalid,
  );
  const validFile = await download(
    fixture.origin,
    '#direct',
    'DownloadRouterTest/Phase5/Preserved/valid-after-invalid.txt',
    textFixture,
    '/files/valid-after-invalid.txt?token=PHASE5_PRIVATE_TOKEN',
  );
  assert.deepEqual(
    await page.evaluate(
      async () => (await chrome.storage.local.get('config')).config,
    ),
    partiallyInvalid,
  );
  const unsupported = { ...good, configVersion: 999 };
  await page.evaluate(
    (config) => chrome.storage.local.set({ config }),
    unsupported,
  );
  const fallback = await download(
    fixture.origin,
    '#direct',
    'unsupported-phase5.txt',
    textFixture,
    '/files/unsupported-phase5.txt?token=PHASE5_PRIVATE_TOKEN',
  );
  assert.deepEqual(
    await page.evaluate(
      async () => (await chrome.storage.local.get('config')).config,
    ),
    unsupported,
  );
  await worker.evaluate(() => {
    console.warn = (...args) => {
      globalThis.__phase5Logs.push(args.map(String));
      throw new Error('PHASE5_PRIVATE_TOKEN logger failure');
    };
  });
  const loggerFallback = await download(
    fixture.origin,
    '#direct',
    'logger-fallback.txt',
    textFixture,
    '/files/logger-fallback.txt?token=PHASE5_PRIVATE_TOKEN',
  );
  const logs = await worker.evaluate(() => {
    const logs = globalThis.__phase5Logs;
    console.warn = globalThis.__phase5Warn;
    delete globalThis.__phase5Warn;
    delete globalThis.__phase5Logs;
    return logs;
  });
  assert.equal(logs.length, 2);
  assert.ok(
    logs.every(
      (entry) =>
        entry.length === 1 &&
        entry[0] === 'Download Router: routing failed; using Chrome defaults.',
    ),
  );
  await page.evaluate((config) => chrome.storage.local.set({ config }), good);
  await request({
    type: 'settings.update',
    patch: { matchRedirectedUrl: true },
  });
  results.push({
    id: 'TEST-DR-P5-03',
    status: 'pass',
    invalidRulePreserved: true,
    validRuleStillRoutes: true,
    unsupportedEnvelopePreserved: true,
    queueRecovered: true,
    storageQuotaRegressions:
      'TEST-DR-P2-04 and TEST-DR-P4-01 rerun in the same runner',
    files: [validFile, fallback, loggerFallback],
  });
  context.off('request', observeRequest);
  assert.ok(
    network.every((url) => url.startsWith(fixture.origin + '/')),
    'No non-fixture HTTP(S) traffic from tested contexts',
  );
  const event = await page.evaluate(
    async () =>
      (await chrome.storage.local.get('lastRoutingEvent')).lastRoutingEvent,
  );
  assert.ok(!JSON.stringify(event).includes('PHASE5_PRIVATE_TOKEN'));
  assert.deepEqual(Object.keys(event).sort(), [
    'basename',
    'destination',
    'ruleId',
    'timestamp',
  ]);

  const build = resolve('dist');
  const issues = [];
  const localPreloadFetch = [];
  for (const file of readdirSync(build, { recursive: true }).filter(
    (file) => statSync(join(build, file)).isFile() && file.endsWith('.js'),
  )) {
    const code = readFileSync(join(build, file), 'utf8');
    const source = ts.createSourceFile(
      file,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    function inspect(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expression = node.expression;
        if (
          ts.isIdentifier(expression) &&
          ['eval', 'Function', 'WebSocket', 'XMLHttpRequest'].includes(
            expression.text,
          )
        )
          issues.push({ file, callee: expression.text });
        if (ts.isIdentifier(expression) && expression.text === 'fetch') {
          if (
            code.includes('modulepreload') &&
            node.getText(source) === 'fetch(e.href,n)'
          )
            localPreloadFetch.push(file);
          else issues.push({ file, callee: 'fetch' });
        }
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        /^https?:/u.test(node.moduleSpecifier.text)
      )
        issues.push({ file, remoteImport: true });
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  assert.deepEqual(issues, []);
  assert.deepEqual(
    JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8')).permissions,
    ['downloads', 'storage'],
  );
  results.push({
    id: 'TEST-DR-P5-05',
    status: 'pass',
    productionWarnings: logs,
    loggerThrowDidNotBreakDownload: true,
    eventWhitelist: true,
    noNonFixtureHttpRequests: true,
    observedHttpRequests: network.length,
    staticExecutableIssues: issues,
    localModulePreloadPolyfill: localPreloadFetch,
    token: 'Fixture-only sentinel; no personal URLs used.',
  });

  const representative = reliabilityConfig(fixture.origin);
  await page.evaluate(
    (config) => chrome.storage.local.set({ config }),
    representative,
  );
  assert.equal((await request({ type: 'config.get' })).rules.length, 200);
  const measurementSource = await context.newPage();
  const lifecyclePage = await context.newPage();
  const cdp = await context.newCDPSession(lifecyclePage);
  const versions = new Map();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
    for (const version of updates) versions.set(version.versionId, version);
  });
  await cdp.send('ServiceWorker.enable');
  const cold = [],
    warm = [],
    measuredFiles = [];
  for (const mode of ['cold', 'warm']) {
    for (let index = 0; index < (mode === 'cold' ? 5 : 20); index++) {
      if (mode === 'cold') {
        const running = await waitFor(
          () =>
            [...versions.values()].find(
              (version) =>
                version.scriptURL === `${origin}/background.js` &&
                version.runningStatus === 'running',
            ),
          '200-rule worker running',
        );
        for (const candidate of context.pages())
          if (candidate.url().startsWith(origin + '/'))
            await candidate.goto('about:blank');
        await cdp.send('ServiceWorker.stopWorker', {
          versionId: running.versionId,
        });
        await waitFor(
          () => versions.get(running.versionId)?.runningStatus === 'stopped',
          '200-rule worker confirmed stopped',
        );
      }
      const filename = `perf-${mode}-${index}.txt`;
      const path = `DownloadRouterTest/Phase5/Performance/${filename}`;
      await measurementSource.goto(fixture.origin);
      await measurementSource.locator('#direct').evaluate((link, name) => {
        link.href = `/files/${name}`;
      }, filename);
      const started = performance.now();
      await measurementSource.locator('#direct').click();
      await waitFor(
        () =>
          existsSync(join(downloads, path)) &&
          readFileSync(join(downloads, path), 'utf8') === textFixture,
        '200-rule expected file contents',
      );
      (mode === 'cold' ? cold : warm).push(performance.now() - started);
      if (mode === 'cold') await page.goto(`${origin}/options/index.html`);
      measuredFiles.push(await verifyDownload(path, textFixture));
    }
  }
  const timing = {
    measuredAt: new Date().toISOString(),
    browser: context.browser().version(),
    node: process.version,
    platform: process.platform,
    cpu: cpus()[0]?.model,
    rules: 200,
    matcherCounts: { domain: 50, prefix: 50, glob: 50, regex: 50 },
    metric:
      'Click to observed expected file contents, 100 ms polling; not handler CPU time or pure storage latency',
    coldMs: percentiles(cold),
    warmMs: percentiles(warm),
    rawMs: { cold, warm },
    coldMethod:
      'CDP confirmed stop before each first download; no extension page/API until expected file exists',
    watchdogFallbacks: 0,
    watchdogProof:
      'All 25 downloads used the exact rule destination; a watchdog fallback would save at the Chrome default instead.',
    files: measuredFiles,
  };
  mkdirSync('.test-artifacts/benchmarks', { recursive: true });
  writeFileSync(
    '.test-artifacts/benchmarks/chromium.json',
    JSON.stringify(timing, null, 2) + '\n',
  );
  results.push({
    id: 'TEST-DR-P5-04',
    status: 'pass',
    benchmark: timing,
    nodeBenchmark: '.test-artifacts/benchmarks/handler.json',
    adversarialAndBoundaryChecks:
      'tests/unit/reliability.test.ts and TEST-DR-P1-04 rerun',
  });
  await measurementSource.close();
  await lifecyclePage.close();
  // Keep a small usable config in the disposable profile after the performance fixture.
  await page.evaluate((config) => chrome.storage.local.set({ config }), good);
  return results;
}
