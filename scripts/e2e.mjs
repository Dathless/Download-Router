import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { runOptionsE2E } from './e2e/options.mjs';
import { runPopupE2E } from './e2e/popup.mjs';
import { runReliabilityE2E } from './e2e/reliability.mjs';
import { runImportExportE2E } from './e2e/portability.mjs';
import { runReleaseE2E } from './e2e/release.mjs';
import {
  startFixtureServer,
  textFixture,
  pdfFixture,
} from './fixture-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
assert.ok(existsSync(join(dist, 'manifest.json')), 'Run pnpm build first.');
const artifacts = process.env.DOWNLOAD_ROUTER_E2E_ARTIFACTS
  ? resolve(process.env.DOWNLOAD_ROUTER_E2E_ARTIFACTS)
  : join(
      root,
      '.test-artifacts',
      new Date().toISOString().replaceAll(/[:.]/g, '-'),
    );
assert.equal(basename(dirname(artifacts)), '.test-artifacts');
assert.ok(
  !existsSync(artifacts),
  'Use a new disposable E2E artifact directory.',
);
const profile = join(artifacts, 'profile');
const downloads = join(artifacts, 'Downloads');
mkdirSync(downloads, { recursive: true });
mkdirSync(join(profile, 'Default'), { recursive: true });
writeFileSync(
  join(profile, 'Default', 'Preferences'),
  JSON.stringify({
    download: { default_directory: downloads, prompt_for_download: false },
    extensions: { ui: { developer_mode: true } },
  }),
);

async function waitFor(check, label, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

const fixture = await startFixtureServer(0);
let context;
const report = {
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  headless: true,
  artifacts,
  distSha256: Object.fromEntries(
    readdirSync(dist, { recursive: true })
      .filter((name) => statSync(join(dist, name)).isFile())
      .sort()
      .map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(join(dist, name)))
          .digest('hex'),
      ]),
  ),
  results: [],
};
const browserOptions = {
  ...(process.env.CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
    : { channel: 'chromium' }),
  headless: true,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
};
try {
  context = await chromium.launchPersistentContext(profile, browserOptions);
  context.setDefaultTimeout(15_000);
  report.browser = context.browser().version();
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).hostname;
  report.extensionId = extensionId;
  const pageErrors = [];
  const trackPage = (page) =>
    page.on('pageerror', (error) => pageErrors.push(error.message));
  context.on('page', trackPage);
  let options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  assert.equal(await options.title(), 'Download Router — Cài đặt');
  await options.waitForFunction(
    async () => (await chrome.storage.local.get('config')).config !== undefined,
  );
  const seededConfig = await options.evaluate(
    async () => (await chrome.storage.local.get('config')).config,
  );
  async function request(message) {
    const response = await options.evaluate(
      (value) => chrome.runtime.sendMessage(value),
      message,
    );
    assert.equal(
      response?.ok,
      true,
      `Mutation/read failed: ${JSON.stringify(response)}`,
    );
    return response.config;
  }
  const manifest = await options.evaluate(() => chrome.runtime.getManifest());
  assert.deepEqual(manifest.permissions, ['downloads', 'storage']);
  assert.equal(manifest.background.type, 'module');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await popup
    .locator('#event-status')
    .filter({ hasText: 'Chưa có đề xuất' })
    .waitFor();
  assert.equal(await popup.locator('#event-details').isHidden(), true);
  await popup.getByRole('button', { name: 'Mở cài đặt' }).click();
  await popup.close();
  report.results.push({
    id: 'TEST-DR-P0-01',
    status: 'pass',
    permissions: manifest.permissions,
  });

  const cdp = await context.newCDPSession(options);
  // Playwright's allow/allowAndName bypasses extension filename hooks; use native Chrome preferences.
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'default',
    eventsEnabled: true,
  });
  const workerVersions = new Map();
  const workerErrors = [];
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const version of versions)
      workerVersions.set(version.versionId, version);
  });
  cdp.on('ServiceWorker.workerErrorReported', ({ errorMessage }) =>
    workerErrors.push(errorMessage),
  );
  await cdp.send('ServiceWorker.enable');
  let source = await context.newPage();
  const savedFiles = [];
  const verifiedDownloadIds = new Set();
  async function verifyDownload(relativePath, content) {
    const filename = join(downloads, relativePath);
    await waitFor(() => existsSync(filename), relativePath);
    const history = await waitFor(async () => {
      const entries = await options.evaluate(() => chrome.downloads.search({}));
      const fresh = entries.find(
        (entry) =>
          entry.filename === filename &&
          entry.state === 'complete' &&
          !verifiedDownloadIds.has(entry.id),
      );
      if (fresh) verifiedDownloadIds.add(fresh.id);
      return fresh;
    }, `Chrome completion: ${relativePath}`);
    await waitFor(
      () => readFileSync(filename, 'utf8') === content,
      `file contents: ${relativePath}`,
    );
    const saved = {
      downloadId: history.id,
      relativePath,
      state: history.state,
      sha256: createHash('sha256').update(readFileSync(filename)).digest('hex'),
    };
    savedFiles.push(saved);
    return saved;
  }
  async function download(origin, selector, relativePath, content, href) {
    await source.goto(origin);
    if (href)
      await source.locator(selector).evaluate((link, value) => {
        link.href = value;
      }, href);
    await source.locator(selector).click();
    return verifyDownload(relativePath, content);
  }

  await download(
    fixture.origin,
    '#direct',
    'DownloadRouterTest/Local/sample.txt',
    textFixture,
  );
  await download(
    fixture.origin.replace('127.0.0.1', 'localhost'),
    '#direct',
    'sample.txt',
    textFixture,
  );
  await request({ type: 'settings.update', patch: { enabled: false } });
  await options.getByRole('status').filter({ hasText: 'Đang tắt' }).waitFor();
  await download(fixture.origin, '#pdf', 'report.pdf', pdfFixture);
  await request({ type: 'settings.update', patch: { enabled: true } });
  await options.getByRole('status').filter({ hasText: 'Đang bật' }).waitFor();
  report.results.push({
    id: 'TEST-DR-P0-02',
    status: 'pass',
    files: [...savedFiles],
  });

  const running = await waitFor(
    () =>
      [...workerVersions.values()].find(
        (version) =>
          version.scriptURL === worker.url() &&
          version.runningStatus === 'running',
      ),
    'running worker version',
  );
  await worker.evaluate(() => {
    globalThis.__phase0WorkerLifetime = true;
  });
  await cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId });
  await waitFor(
    () => workerVersions.get(running.versionId)?.runningStatus === 'stopped',
    'confirmed stopped worker',
  );
  const stopped = { ...workerVersions.get(running.versionId) };
  // Do not evaluate an extension API between stopping the worker and triggering the download.
  const coldFile = await download(
    fixture.origin,
    '#pdf',
    'DownloadRouterTest/Local/report.pdf',
    pdfFixture,
  );
  const restarted = await waitFor(
    () =>
      [...workerVersions.values()].find(
        (version) =>
          version.scriptURL === running.scriptURL &&
          version.runningStatus === 'running',
      ),
    'worker restarted by download',
  );
  const restartedWorker = context
    .serviceWorkers()
    .find((candidate) => candidate.url() === running.scriptURL);
  assert.ok(restartedWorker);
  // Chromium may reuse target IDs; a cleared JS-global marker proves a new worker lifetime.
  const retainedGlobal = await restartedWorker.evaluate(() =>
    Object.hasOwn(globalThis, '__phase0WorkerLifetime'),
  );
  assert.equal(
    retainedGlobal,
    false,
    'Worker globals must not survive termination.',
  );
  report.results.push({
    id: 'TEST-DR-P0-03',
    status: 'pass',
    stopped: {
      versionId: stopped.versionId,
      runningStatus: stopped.runningStatus,
      targetId: stopped.targetId,
    },
    restarted: {
      versionId: restarted.versionId,
      runningStatus: restarted.runningStatus,
      targetId: restarted.targetId,
    },
    retainedGlobal,
    file: coldFile,
    devtoolsWindowOpen: false,
  });

  const regexProof = await options.evaluate(async () => {
    const { compileRegex, matchesRegex } = await import(
      chrome.runtime.getURL('regex.js')
    );
    const unsupported = [
      '[',
      '(?=a)',
      '(?!a)',
      '(?<=a)',
      '(?<!a)',
      '(a)\\1',
      'a'.repeat(257),
    ];
    const rejected = unsupported.map((pattern) => {
      try {
        compileRegex(pattern);
        return false;
      } catch {
        return true;
      }
    });
    const pattern = compileRegex('^(a+)+$');
    const timings = [128, 1_024, 8_191].map((size) => {
      const started = globalThis.performance.now();
      const matched = matchesRegex(pattern, `${'a'.repeat(size)}!`);
      return {
        size: size + 1,
        matched,
        elapsedMs: globalThis.performance.now() - started,
      };
    });
    return {
      ordinary: matchesRegex(
        compileRegex('example[.]test'),
        'https://example.test/file',
      ),
      rejected,
      timings,
      atLimit: matchesRegex(compileRegex('^a+$'), 'a'.repeat(8_192)),
      overLimit: matchesRegex(compileRegex('^a+$'), 'a'.repeat(8_193)),
    };
  });
  assert.equal(regexProof.ordinary, true);
  assert.ok(regexProof.rejected.every(Boolean));
  assert.ok(regexProof.timings.every(({ matched }) => matched === false));
  assert.equal(regexProof.atLimit, true);
  assert.equal(regexProof.overLimit, false);
  report.results.push({
    id: 'TEST-DR-P0-07',
    status: 'pass',
    engine: 're2js@2.8.6',
    realm: 'MV3 extension page, production bundle, script-src self',
    ...regexProof,
  });
  const phase1Files = [];
  for (const scenario of [
    {
      type: 'prefix',
      pattern: `${fixture.origin}/files/`,
      selector: '#redirect',
      name: 'sample.txt',
      content: textFixture,
    },
    {
      type: 'glob',
      pattern: `${fixture.origin}/files/*.txt`,
      selector: '#direct',
      name: 'sample.txt',
      content: textFixture,
    },
    {
      type: 'regex',
      pattern: '^http://127[.]0[.]0[.]1:[0-9]+/download/123$',
      selector: '#pdf',
      name: 'report.pdf',
      content: pdfFixture,
      extensions: ['.PDF'],
      mimeTypes: ['APPLICATION/PDF'],
    },
  ]) {
    await options.evaluate(async ({ type, pattern, extensions, mimeTypes }) => {
      const { config } = await chrome.storage.local.get('config');
      const base = config.rules[0];
      config.rules = [
        {
          ...base,
          id: 'invalid',
          priority: 100,
          match: { type: 'regex', pattern: '(?=a)' },
        },
        {
          ...base,
          id: type,
          match: { type, pattern, extensions, mimeTypes },
          destination: `DownloadRouterTest/Phase1/${type}`,
        },
      ];
      await chrome.storage.local.set({ config });
    }, scenario);
    await options
      .getByRole('status')
      .filter({ hasText: 'Có rule lỗi bị bỏ qua' })
      .waitFor();
    phase1Files.push(
      await download(
        fixture.origin,
        scenario.selector,
        `DownloadRouterTest/Phase1/${scenario.type}/${scenario.name}`,
        scenario.content,
      ),
    );
  }
  report.results.push({
    id: 'PHASE1-ROUTING-SMOKE',
    status: 'pass',
    files: phase1Files,
    checks: [
      'prefix on redirected URL',
      'glob on URL components',
      'RE2JS regex in service worker',
      'basename extension and exact MIME filters',
      'invalid high-priority rule isolated',
    ],
  });

  // Restore the fixture after Phase 1's deliberately invalid raw-storage data.
  await options.evaluate(
    (config) => chrome.storage.local.set({ config }),
    seededConfig,
  );
  const sampleId = seededConfig.rules[0].id;
  await Promise.all([
    request({
      type: 'rule.update',
      id: sampleId,
      patch: { destination: 'DownloadRouterTest/Phase2/Persist' },
    }),
    request({ type: 'settings.update', patch: { matchRedirectedUrl: false } }),
  ]);
  const beforeRestart = await request({ type: 'config.get' });
  assert.equal(
    beforeRestart.rules[0].destination,
    'DownloadRouterTest/Phase2/Persist',
  );
  assert.equal(beforeRestart.settings.matchRedirectedUrl, false);
  await context.close();
  context = await chromium.launchPersistentContext(profile, browserOptions);
  context.setDefaultTimeout(15_000);
  context.on('page', trackPage);
  assert.ok(
    context
      .pages()
      .every((page) => !page.url().startsWith('chrome-extension://')),
    'No extension page restored before first post-restart download',
  );
  options = await context.newPage();
  const lifecycle = await context.newCDPSession(options);
  await lifecycle.send('Browser.setDownloadBehavior', {
    behavior: 'default',
    eventsEnabled: true,
  });
  const versions = new Map();
  lifecycle.on(
    'ServiceWorker.workerVersionUpdated',
    ({ versions: updates }) => {
      for (const version of updates) versions.set(version.versionId, version);
    },
  );
  lifecycle.on('ServiceWorker.workerErrorReported', ({ errorMessage }) =>
    workerErrors.push(errorMessage),
  );
  await lifecycle.send('ServiceWorker.enable');
  source = await context.newPage();
  // Before the first download after browser restart, do not open any extension page/API.
  await source.goto(fixture.origin);
  await source.locator('#direct').evaluate((link) => {
    link.href = '/files/persist.txt';
  });
  await source.locator('#direct').click();
  const persistedPath = 'DownloadRouterTest/Phase2/Persist/persist.txt';
  await waitFor(
    () => existsSync(join(downloads, persistedPath)),
    'first download after browser restart',
  );
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  const persistedFile = await verifyDownload(persistedPath, textFixture);
  assert.deepEqual(await request({ type: 'config.get' }), beforeRestart);
  await options.getByRole('status').filter({ hasText: 'Đang bật' }).waitFor();

  await request({
    type: 'rule.update',
    id: sampleId,
    patch: { destination: 'DownloadRouterTest/Phase2/Cold' },
  });
  const activeVersion = await waitFor(
    () =>
      [...versions.values()].find(
        (v) => v.scriptURL === worker.url() && v.runningStatus === 'running',
      ),
    'Phase 2 running worker',
  );
  const activeWorker = context
    .serviceWorkers()
    .find((candidate) => candidate.url() === activeVersion.scriptURL);
  assert.ok(activeWorker);
  await activeWorker.evaluate(() => {
    globalThis.__phase2Lifetime = true;
  });
  // Keep the CDP target alive while closing extension pages that can send status requests.
  const lifecyclePage = await context.newPage();
  const coldCDP = await context.newCDPSession(lifecyclePage);
  const coldVersions = new Map();
  coldCDP.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
    for (const version of updates) coldVersions.set(version.versionId, version);
  });
  coldCDP.on('ServiceWorker.workerErrorReported', ({ errorMessage }) =>
    workerErrors.push(errorMessage),
  );
  await coldCDP.send('ServiceWorker.enable');
  for (const page of context.pages())
    if (page.url().startsWith('chrome-extension://')) await page.close();
  await coldCDP.send('ServiceWorker.stopWorker', {
    versionId: activeVersion.versionId,
  });
  const coldStopped = await waitFor(() => {
    const version = coldVersions.get(activeVersion.versionId);
    return version?.runningStatus === 'stopped' ? { ...version } : false;
  }, 'Phase 2 confirmed stopped worker');
  await source.goto(fixture.origin);
  await source.locator('#direct').evaluate((link) => {
    link.href = '/files/cold.txt';
  });
  await source.locator('#direct').click();
  const coldPath = 'DownloadRouterTest/Phase2/Cold/cold.txt';
  await waitFor(
    () => existsSync(join(downloads, coldPath)),
    'first download with new config after worker stop',
  );
  options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  const newColdFile = await verifyDownload(coldPath, textFixture);
  const coldRunning = await waitFor(
    () =>
      [...coldVersions.values()].find(
        (v) =>
          v.scriptURL === activeVersion.scriptURL &&
          v.runningStatus === 'running',
      ),
    'Phase 2 worker restarted',
  );
  const newWorker = context
    .serviceWorkers()
    .find((candidate) => candidate.url() === activeVersion.scriptURL);
  assert.ok(newWorker);
  assert.equal(
    await newWorker.evaluate(() =>
      Object.hasOwn(globalThis, '__phase2Lifetime'),
    ),
    false,
  );
  report.results.push({
    id: 'TEST-DR-P2-06',
    status: 'pass',
    browserRestarted: true,
    storedConfigEqualAfterRestart: true,
    noExtensionPageBeforeFirstDownload: true,
    stopped: {
      versionId: coldStopped.versionId,
      runningStatus: coldStopped.runningStatus,
    },
    restarted: {
      versionId: coldRunning.versionId,
      runningStatus: coldRunning.runningStatus,
    },
    retainedGlobal: false,
    files: [persistedFile, newColdFile],
  });

  const priorityConfig = await request({
    type: 'rule.create',
    rule: {
      name: 'Final URL priority',
      enabled: true,
      match: {
        type: 'prefix',
        pattern: `${fixture.origin}/files/`,
        extensions: ['txt'],
      },
      destination: 'DownloadRouterTest/Phase2/Priority',
      priority: 100,
    },
  });
  const priorityId = priorityConfig.rules.at(-1).id;
  await request({
    type: 'settings.update',
    patch: { matchRedirectedUrl: true },
  });
  const priorityFile = await download(
    fixture.origin,
    '#redirect',
    'DownloadRouterTest/Phase2/Priority/sample.txt',
    textFixture,
  );
  await request({
    type: 'settings.update',
    patch: { matchRedirectedUrl: false },
  });
  const originalFile = await download(
    fixture.origin,
    '#redirect',
    'DownloadRouterTest/Phase2/Cold/sample.txt',
    textFixture,
  );
  await request({ type: 'rule.delete', id: priorityId });
  await request({
    type: 'rule.update',
    id: sampleId,
    patch: {
      destination: 'DownloadRouterTest/Phase2/Batch',
      match: {
        type: 'glob',
        pattern: `${fixture.origin}/files/*.txt`,
        extensions: ['txt'],
        mimeTypes: ['TEXT/PLAIN'],
      },
    },
  });
  const batchFiles = await Promise.all(
    [0, 1, 2].map(async (index) => {
      const page = await context.newPage();
      try {
        await page.goto(fixture.origin);
        await page.locator('#direct').evaluate((link, value) => {
          link.href = value;
        }, `/files/batch-${index}.txt`);
        await page.locator('#direct').click();
        return await verifyDownload(
          `DownloadRouterTest/Phase2/Batch/batch-${index}.txt`,
          textFixture,
        );
      } finally {
        await page.close();
      }
    }),
  );
  await request({ type: 'settings.update', patch: { enabled: false } });
  const disabledFile = await download(
    fixture.origin,
    '#direct',
    'disabled.txt',
    textFixture,
    '/files/disabled.txt',
  );
  await request({ type: 'settings.update', patch: { enabled: true } });
  const noMatchFile = await download(
    fixture.origin.replace('127.0.0.1', 'localhost'),
    '#direct',
    'no-match.txt',
    textFixture,
    '/files/no-match.txt',
  );
  report.results.push({
    id: 'TEST-DR-P2-07',
    status: 'pass',
    files: [
      priorityFile,
      originalFile,
      ...batchFiles,
      disabledFile,
      noMatchFile,
    ],
    concurrentDownloads: 3,
    checks: [
      'full matcher/filter routing with Phase 0–1 regressions',
      'final URL priority',
      'redirect opt-out',
      'new config visible without reload',
      'independent concurrent downloads',
      'disabled/no-match defaults',
    ],
  });

  const beforeFailure = await request({ type: 'config.get' });
  const invalidReply = await options.evaluate(
    (id) =>
      chrome.runtime.sendMessage({
        type: 'rule.update',
        id,
        patch: { destination: '../escape' },
      }),
    sampleId,
  );
  assert.deepEqual(invalidReply, { ok: false, error: 'INVALID_MESSAGE' });
  assert.deepEqual(await request({ type: 'config.get' }), beforeFailure);
  const quotaProof = await options.evaluate(async () => {
    const quotaBytes = chrome.storage.local.QUOTA_BYTES;
    const response = await chrome.runtime.sendMessage({
      type: 'rule.create',
      rule: {
        name: 'x'.repeat(quotaBytes + 1024),
        enabled: true,
        match: { type: 'domain', pattern: '127.0.0.1' },
        destination: 'DownloadRouterTest/Quota',
        priority: 0,
      },
    });
    return { quotaBytes, response };
  });
  assert.deepEqual(quotaProof.response, {
    ok: false,
    error: 'STORAGE_WRITE_FAILED',
  });
  assert.deepEqual(await request({ type: 'config.get' }), beforeFailure);
  const afterRecovery = await request({
    type: 'settings.update',
    patch: { matchRedirectedUrl: true },
  });
  assert.equal(afterRecovery.settings.matchRedirectedUrl, true);
  assert.deepEqual(afterRecovery.rules, beforeFailure.rules);
  report.results.push({
    id: 'TEST-DR-P2-04',
    status: 'pass',
    concurrentEditAndTogglePreserved: true,
    quotaBytes: quotaProof.quotaBytes,
    quotaError: quotaProof.response.error,
    failedWritePreservedData: true,
    queueRecoveredAfterFailure: true,
  });

  const invalidConfig = { ...afterRecovery, configVersion: 999 };
  await options.evaluate(
    (config) => chrome.storage.local.set({ config }),
    invalidConfig,
  );
  const fallbackFile = await download(
    fixture.origin,
    '#direct',
    'invalid-config.txt',
    textFixture,
    '/files/invalid-config.txt',
  );
  assert.deepEqual(
    await options.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'config.get' }),
    ),
    { ok: false, error: 'INVALID_CONFIG' },
  );
  assert.deepEqual(
    await options.evaluate(
      async () => (await chrome.storage.local.get('config')).config,
    ),
    invalidConfig,
  );
  await options
    .getByRole('status')
    .filter({ hasText: 'Không đọc được cấu hình' })
    .waitFor();
  await options.evaluate(
    (config) => chrome.storage.local.set({ config }),
    afterRecovery,
  );
  await options.getByRole('status').filter({ hasText: 'Đang bật' }).waitFor();
  report.results.push({
    id: 'TEST-DR-P2-02',
    status: 'pass',
    unsupportedVersionPreserved: true,
    recoverableErrorShown: true,
    file: fallbackFile,
  });
  report.results.push(
    ...(await runOptionsE2E({
      page: options,
      context,
      fixture,
      download,
      waitFor,
      artifacts,
    })),
  );
  report.results.push(
    ...(await runPopupE2E({
      page: options,
      context,
      fixture,
      download,
      waitFor,
      artifacts,
    })),
  );
  report.results.push(
    ...(await runReliabilityE2E({
      page: options,
      context,
      fixture,
      download,
      verifyDownload,
      waitFor,
      artifacts,
      downloads,
    })),
  );
  report.results.push(
    ...(await runImportExportE2E({
      page: options,
      context,
      fixture,
      download,
      verifyDownload,
      waitFor,
      artifacts,
      downloads,
      browserOptions,
    })),
  );
  report.results.push(
    ...(await runReleaseE2E({
      page: options,
      context,
      fixture,
      download,
      verifyDownload,
      waitFor,
      artifacts,
      downloads,
      browserOptions,
      onOptionsPage: (page) => {
        options = page;
      },
    })),
  );
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(workerErrors, []);
  report.pageErrors = pageErrors;
  report.workerErrors = workerErrors;
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  report.error = error.stack;
  const extensionPage = context
    ?.pages()
    .find((page) => page.url().startsWith('chrome-extension://'));
  if (extensionPage) {
    report.diagnostics = await extensionPage
      .evaluate(async () => ({
        stored: await chrome.storage.local.get('config'),
        downloads: await chrome.downloads.search({}),
      }))
      .catch((failure) => ({ error: failure.message }));
  }
  throw error;
} finally {
  try {
    await context?.close();
  } finally {
    await fixture.close();
    writeFileSync(
      join(artifacts, 'e2e-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `Phase 0–7 E2E: ${report.status}. Evidence: ${join(artifacts, 'e2e-report.json')}`,
    );
  }
}
