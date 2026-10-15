import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import {
  startFixtureServer,
  textFixture,
  pdfFixture,
} from './fixture-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
assert.ok(existsSync(join(dist, 'manifest.json')), 'Run pnpm build first.');
const artifacts = join(
  root,
  '.test-artifacts',
  new Date().toISOString().replaceAll(/[:.]/g, '-'),
);
const profile = join(artifacts, 'profile');
const downloads = join(artifacts, 'Downloads');
mkdirSync(downloads, { recursive: true });
mkdirSync(join(profile, 'Default'), { recursive: true });
writeFileSync(
  join(profile, 'Default', 'Preferences'),
  JSON.stringify({
    download: { default_directory: downloads, prompt_for_download: false },
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
    ['manifest.json', 'background.js', 'regex.js'].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(join(dist, name)))
        .digest('hex'),
    ]),
  ),
  results: [],
};
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : { channel: 'chromium' }),
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  context.setDefaultTimeout(15_000);
  report.browser = context.browser().version();
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).hostname;
  report.extensionId = extensionId;
  const pageErrors = [];
  context.on('page', (page) =>
    page.on('pageerror', (error) => pageErrors.push(error.message)),
  );
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  assert.equal(await options.title(), 'Download Router — Cài đặt');
  await options.waitForFunction(
    async () => (await chrome.storage.local.get('config')).config !== undefined,
  );
  const manifest = await options.evaluate(() => chrome.runtime.getManifest());
  assert.deepEqual(manifest.permissions, ['downloads', 'storage']);
  assert.equal(manifest.background.type, 'module');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
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
  const source = await context.newPage();
  const savedFiles = [];
  async function download(origin, selector, relativePath, content) {
    await source.goto(origin);
    await source.locator(selector).click();
    const filename = join(downloads, relativePath);
    await waitFor(() => existsSync(filename), relativePath);
    await waitFor(
      () => readFileSync(filename, 'utf8') === content,
      `file contents: ${relativePath}`,
    );
    const history = await waitFor(async () => {
      const entries = await options.evaluate(() => chrome.downloads.search({}));
      return entries.find(
        (entry) => entry.filename === filename && entry.state === 'complete',
      );
    }, `Chrome completion: ${relativePath}`);
    const saved = {
      relativePath,
      state: history.state,
      sha256: createHash('sha256').update(readFileSync(filename)).digest('hex'),
    };
    savedFiles.push(saved);
    return saved;
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
  await options.evaluate(async () => {
    const { config } = await chrome.storage.local.get('config');
    config.settings.enabled = false;
    await chrome.storage.local.set({ config });
  });
  await download(fixture.origin, '#pdf', 'report.pdf', pdfFixture);
  await options.evaluate(async () => {
    const { config } = await chrome.storage.local.get('config');
    config.settings.enabled = true;
    await chrome.storage.local.set({ config });
  });
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
      join(artifacts, 'phase0-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `Phase 0 E2E: ${report.status}. Evidence: ${join(artifacts, 'phase0-report.json')}`,
    );
  }
}
