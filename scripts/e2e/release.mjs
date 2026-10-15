import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { textFixture } from '../fixture-server.mjs';

export async function runReleaseE2E({
  page,
  context,
  fixture,
  download,
  verifyDownload,
  waitFor,
  artifacts,
  downloads,
  browserOptions,
  onOptionsPage,
}) {
  const origin = `chrome-extension://${new URL(page.url()).hostname}`;
  const optionsUrl = `${origin}/options/index.html`;
  const ready = (target) =>
    waitFor(
      () => target.locator('#add-rule').isEnabled(),
      'release options ready',
    );
  const config = (target) =>
    target.evaluate(
      async () => (await chrome.storage.local.get('config')).config,
    );
  async function create(target, destination, name) {
    await ready(target);
    await target.locator('#add-rule').click();
    for (const [field, value] of Object.entries({
      name,
      pattern: '127.0.0.1',
      destination,
      priority: '2000',
    }))
      await target.locator(`#rule-${field}`).fill(value);
    await target.locator('#rule-type').selectOption('domain');
    await target.locator('#save-rule').click();
    await target.locator('#editor').waitFor({ state: 'hidden' });
    await ready(target);
  }
  async function reload(target, url, version) {
    const owner = target.context();
    const extensions = await owner.newPage();
    await extensions.goto('chrome://extensions');
    await extensions.evaluate(() =>
      chrome.developerPrivate.updateProfileConfiguration({
        inDeveloperMode: true,
      }),
    );
    assert.equal(
      await extensions.evaluate(
        async () =>
          (await chrome.developerPrivate.getProfileConfiguration())
            .inDeveloperMode,
      ),
      true,
    );
    await extensions.close();
    const closed = target.waitForEvent('close');
    await target.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await closed;
    // Reload closes extension tabs; use a new page in the surviving browser context.
    target = await owner.newPage();
    await waitFor(async () => {
      try {
        await target.goto(url);
        return await target.evaluate(
          (expected) => chrome.runtime.getManifest().version === expected,
          version,
        );
      } catch {
        return false;
      }
    }, `extension reload ${version}`);
    await ready(target);
    return target;
  }
  await create(page, 'DownloadRouterTest/Phase7/Release', 'Release workflow');
  const saved = await config(page);
  const created = saved.rules.find((rule) => rule.name === 'Release workflow');
  assert.ok(created);
  const first = await download(
    fixture.origin,
    '#direct',
    'DownloadRouterTest/Phase7/Release/release-first.txt',
    textFixture,
    '/files/release-first.txt',
  );
  await page.locator('#export-config').click();
  const backupPath = join(downloads, 'download-router-config (1).json');
  await waitFor(() => existsSync(backupPath), 'release backup');
  const backupText = readFileSync(backupPath, 'utf8');
  assert.deepEqual(JSON.parse(backupText), saved);
  const backup = await verifyDownload(
    'download-router-config (1).json',
    backupText,
  );

  const lifecycle = await context.newPage();
  const cdp = await context.newCDPSession(lifecycle);
  const versions = new Map();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
    for (const value of updates) versions.set(value.versionId, value);
  });
  await cdp.send('ServiceWorker.enable');
  const running = await waitFor(
    () =>
      [...versions.values()].find(
        (value) =>
          value.scriptURL === `${origin}/background.js` &&
          value.runningStatus === 'running',
      ),
    'release running worker',
  );
  for (const target of context.pages())
    if (target.url().startsWith(origin + '/')) await target.goto('about:blank');
  await cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId });
  await waitFor(
    () => versions.get(running.versionId)?.runningStatus === 'stopped',
    'release worker stopped',
  );
  const source = await context.newPage();
  await source.goto(fixture.origin);
  await source.locator('#direct').evaluate((link) => {
    link.href = '/files/release-cold.txt';
  });
  await source.locator('#direct').click();
  const coldPath = 'DownloadRouterTest/Phase7/Release/release-cold.txt';
  await waitFor(
    () =>
      existsSync(join(downloads, coldPath)) &&
      readFileSync(join(downloads, coldPath), 'utf8') === textFixture,
    'first release download wakes worker',
  );
  await page.goto(optionsUrl);
  await ready(page);
  const cold = await verifyDownload(coldPath, textFixture);
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup/index.html`);
  await waitFor(() => popup.locator('#toggle').isEnabled(), 'release popup');
  await popup.locator('#toggle').click();
  await waitFor(
    async () => (await config(page)).settings.enabled === false,
    'release routing disabled',
  );
  const disabled = await download(
    fixture.origin,
    '#direct',
    'release-disabled.txt',
    textFixture,
    '/files/release-disabled.txt',
  );
  await waitFor(
    () => popup.locator('#toggle').isEnabled(),
    'release toggle settled',
  );
  await popup.locator('#toggle').click();
  await waitFor(
    async () => (await config(page)).settings.enabled === true,
    'release routing enabled',
  );
  await ready(page);
  await page
    .locator(`[data-rule-id="${created.id}"]`)
    .getByRole('button', { name: /^Sửa rule/ })
    .click();
  await page
    .locator('#rule-destination')
    .fill('DownloadRouterTest/Phase7/Changed');
  await page.locator('#save-rule').click();
  await page.locator('#editor').waitFor({ state: 'hidden' });
  await ready(page);
  assert.notDeepEqual(await config(page), saved);
  await page.locator('#import-file').setInputFiles(backupPath);
  await waitFor(
    () => page.locator('#preview-import').isEnabled(),
    'release backup validated',
  );
  await page.locator('#preview-import').click();
  await page.locator('#confirm-import').waitFor({ state: 'visible' });
  await page.locator('#confirm-import').click();
  await page
    .locator('#import-status')
    .filter({ hasText: 'Đã thay thế cấu hình' })
    .waitFor();
  assert.deepEqual(await config(page), saved);
  const restored = await download(
    fixture.origin,
    '#direct',
    'DownloadRouterTest/Phase7/Release/release-restored.txt',
    textFixture,
    '/files/release-restored.txt',
  );
  await popup.close();
  page = await reload(page, optionsUrl, '1.0.0');
  onOptionsPage(page);
  assert.deepEqual(await config(page), saved);
  const afterReload = await download(
    fixture.origin,
    '#direct',
    'DownloadRouterTest/Phase7/Release/release-reload.txt',
    textFixture,
    '/files/release-reload.txt',
  );
  await source.close();
  await lifecycle.close();
  const results = [
    {
      id: 'TEST-DR-P7-02',
      status: 'pass',
      uiOnlyConfiguration: true,
      first,
      backup,
      cold,
      disabled,
      restored,
      exactRoundtrip: true,
      devtoolsWindowOpen: false,
    },
    {
      id: 'TEST-DR-P7-03',
      status: 'pass',
      runtimeReload: true,
      exactConfigPreserved: true,
      afterReload,
    },
  ];

  if (process.env.PREVIOUS_EXTENSION) {
    const upgradeRoot = join(artifacts, 'phase7-upgrade');
    const extension = join(upgradeRoot, 'extension');
    const profile = join(upgradeRoot, 'profile');
    const output = join(upgradeRoot, 'Downloads');
    mkdirSync(output, { recursive: true });
    mkdirSync(join(profile, 'Default'), { recursive: true });
    writeFileSync(
      join(profile, 'Default', 'Preferences'),
      JSON.stringify({
        download: { default_directory: output, prompt_for_download: false },
      }),
    );
    cpSync(resolve(process.env.PREVIOUS_EXTENSION), extension, {
      recursive: true,
    });
    const previousVersion = JSON.parse(
      readFileSync(join(extension, 'manifest.json'), 'utf8'),
    ).version;
    assert.equal(previousVersion, '0.1.0');
    const upgraded = await chromium.launchPersistentContext(profile, {
      ...browserOptions,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const errors = [];
    upgraded.on('page', (target) =>
      target.on('pageerror', (error) => errors.push(error.message)),
    );
    try {
      const worker =
        upgraded.serviceWorkers()[0] ??
        (await upgraded.waitForEvent('serviceworker'));
      let target = await upgraded.newPage();
      const url = `chrome-extension://${new URL(worker.url()).hostname}/options/index.html`;
      await target.goto(url);
      await create(
        target,
        'DownloadRouterTest/Phase7/Upgrade',
        'Preserve on upgrade',
      );
      await target.locator('#settings-redirect').uncheck();
      await target.locator('#save-settings').click();
      await ready(target);
      const previous = await config(target);
      const session = await upgraded.newCDPSession(target);
      await session.send('Browser.setDownloadBehavior', {
        behavior: 'default',
        eventsEnabled: true,
      });
      await target.locator('#export-config').click();
      const file = join(output, 'download-router-config.json');
      await waitFor(
        async () =>
          (await target.evaluate(() => chrome.downloads.search({}))).some(
            (entry) => entry.filename === file && entry.state === 'complete',
          ),
        'pre-upgrade backup complete',
      );
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), previous);
      // Replace only this disposable unpacked installation, preserving its path and profile.
      cpSync(resolve('dist'), extension, { recursive: true });
      target = await reload(target, url, '1.0.0');
      assert.deepEqual(await config(target), previous);
      const source = await upgraded.newPage();
      await source.goto(fixture.origin);
      await source.locator('#direct').evaluate((link) => {
        link.href = '/files/release-upgrade.txt';
      });
      await source.locator('#direct').click();
      const filename = join(
        output,
        'DownloadRouterTest/Phase7/Upgrade/release-upgrade.txt',
      );
      const entry = await waitFor(
        async () =>
          (await target.evaluate(() => chrome.downloads.search({}))).find(
            (value) =>
              value.filename === filename && value.state === 'complete',
          ),
        'upgraded Chrome download complete',
      );
      assert.equal(readFileSync(filename, 'utf8'), textFixture);
      assert.deepEqual(errors, []);
      results.push({
        id: 'TEST-DR-P7-03',
        status: 'pass',
        previousVersion,
        currentVersion: '1.0.0',
        previousConfig: previous,
        backupSha256: createHash('sha256')
          .update(readFileSync(file))
          .digest('hex'),
        exactConfigPreserved: true,
        sameExtensionPathAndId: true,
        file: {
          filename,
          downloadId: entry.id,
          state: entry.state,
          sha256: createHash('sha256')
            .update(readFileSync(filename))
            .digest('hex'),
        },
        pageErrors: errors,
      });
    } finally {
      await upgraded.close();
    }
  }
  const competitor = join(artifacts, 'filename-competitor');
  mkdirSync(competitor, { recursive: true });
  writeFileSync(
    join(competitor, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Download Router filename conflict TEST ONLY',
      version: '1.0.0',
      permissions: ['downloads', 'storage'],
      background: { service_worker: 'background.js' },
    }),
  );
  writeFileSync(
    join(competitor, 'background.js'),
    `chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const basename = item.filename.replaceAll('\\\\', '/').split('/').at(-1);
    const filename = 'DownloadRouterTest/Phase7/Competitor/' + basename;
    suggest({ filename, conflictAction: 'uniquify' });
    void chrome.storage.local.set({ proposed: filename });
    return true;
  });`,
  );
  const competingFiles = [];
  for (const [index, extensions] of [
    [competitor],
    [resolve('dist'), competitor],
    [competitor, resolve('dist')],
  ].entries()) {
    const trial = join(artifacts, `phase7-conflict-${index}`);
    const output = join(trial, 'Downloads');
    const profile = join(trial, 'profile');
    mkdirSync(output, { recursive: true });
    mkdirSync(join(profile, 'Default'), { recursive: true });
    writeFileSync(
      join(profile, 'Default', 'Preferences'),
      JSON.stringify({
        download: { default_directory: output, prompt_for_download: false },
      }),
    );
    const trialContext = await chromium.launchPersistentContext(profile, {
      ...browserOptions,
      args: [
        `--disable-extensions-except=${extensions.join(',')}`,
        `--load-extension=${extensions.join(',')}`,
      ],
    });
    try {
      await waitFor(
        () => trialContext.serviceWorkers().length === extensions.length,
        'both filename listeners loaded',
      );
      const workers = trialContext.serviceWorkers();
      const workerInfo = await Promise.all(
        workers.map(async (worker) => ({
          worker,
          name: await worker.evaluate(() => chrome.runtime.getManifest().name),
          id: new URL(worker.url()).hostname,
        })),
      );
      const other = workerInfo.find((value) =>
        value.name.endsWith('TEST ONLY'),
      );
      const router = workerInfo.find(
        (value) => value.name === 'Download Router',
      );
      assert.ok(other);
      if (index) assert.ok(router);
      const source = await trialContext.newPage();
      const session = await trialContext.newCDPSession(source);
      await session.send('Browser.setDownloadBehavior', {
        behavior: 'default',
        eventsEnabled: true,
      });
      if (router)
        await waitFor(
          () =>
            router.worker.evaluate(
              async () =>
                (await chrome.storage.local.get('config')).config !== undefined,
            ),
          'router installation initialized',
        );
      const basename = `competing-${index}.txt`;
      await source.goto(fixture.origin);
      await source.locator('#direct').evaluate((link, name) => {
        link.href = '/files/' + name;
      }, basename);
      await source.locator('#direct').click();
      const entry = await waitFor(
        async () =>
          (await other.worker.evaluate(() => chrome.downloads.search({}))).find(
            (value) =>
              value.state === 'complete' && value.filename.endsWith(basename),
          ),
        'competing download completed',
      );
      const allowed = [
        join(output, 'DownloadRouterTest/Phase7/Competitor', basename),
        ...(router ? [join(output, 'DownloadRouterTest/Local', basename)] : []),
      ];
      assert.ok(allowed.includes(entry.filename));
      assert.equal(readFileSync(entry.filename, 'utf8'), textFixture);
      await waitFor(
        async () =>
          (await other.worker.evaluate(
            async () => (await chrome.storage.local.get('proposed')).proposed,
          )) ===
          'DownloadRouterTest/Phase7/Competitor/' + basename,
        'other extension called suggest',
      );
      if (router)
        await waitFor(
          async () =>
            (
              await router.worker.evaluate(
                async () =>
                  (await chrome.storage.local.get('lastRoutingEvent'))
                    .lastRoutingEvent,
              )
            )?.basename === basename,
          'router also called suggest',
        );
      competingFiles.push({
        requestedLoadOrder: extensions.map((path) =>
          path === competitor ? 'competitor' : 'Download Router',
        ),
        observedWorkerOrder: workerInfo.map(({ name, id }) => ({ name, id })),
        bothSuggested: Boolean(router),
        actualFilename: entry.filename,
        state: entry.state,
        downloadId: entry.id,
        sha256: createHash('sha256')
          .update(readFileSync(entry.filename))
          .digest('hex'),
      });
    } finally {
      await trialContext.close();
    }
  }
  results.push({
    id: 'TEST-DR-P5-06',
    status: 'pass',
    routerBaseline: first,
    competitorFixtureOnly: true,
    competitorManifestSha256: createHash('sha256')
      .update(readFileSync(join(competitor, 'manifest.json')))
      .digest('hex'),
    competitorCodeSha256: createHash('sha256')
      .update(readFileSync(join(competitor, 'background.js')))
      .digest('hex'),
    files: competingFiles,
    boundary:
      'Real concurrent Chrome filename listeners with a local controlled extension. Requested load order is recorded; no guarantee of install order or winner, and no third-party extension compatibility claim. Native Save As evidence remains historical Phase 5.',
  });
  return results;
}
