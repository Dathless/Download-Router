import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { textFixture } from '../fixture-server.mjs';

export async function runImportExportE2E({
  page,
  context,
  fixture,
  download,
  verifyDownload,
  waitFor,
  artifacts,
  downloads,
  browserOptions,
}) {
  const results = [];
  const portable = JSON.parse(
    readFileSync(
      new URL('../../tests/fixtures/portable-config.json', import.meta.url),
      'utf8',
    ),
  );
  const origin = `chrome-extension://${new URL(page.url()).hostname}`;
  const config = () =>
    page.evaluate(
      async () => (await chrome.storage.local.get('config')).config,
    );
  const ready = () =>
    waitFor(() => page.locator('#import-file').isEnabled(), 'import ready');
  async function select(value, target = page) {
    await target.locator('#import-file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        typeof value === 'string' ? value : JSON.stringify(value),
      ),
    });
    await waitFor(
      () => target.locator('#preview-import').isEnabled(),
      'file validated',
    );
  }
  async function preview(target = page) {
    await target.locator('#preview-import').click();
    await target.locator('#import-preview').waitFor({ state: 'visible' });
    assert.equal(
      await target.evaluate(() => document.activeElement.id),
      'import-preview-heading',
    );
  }
  async function confirm(target = page) {
    await target.locator('#confirm-import').click();
    await target
      .locator('#import-status')
      .filter({ hasText: 'Đã thay thế cấu hình' })
      .waitFor();
  }
  await ready();
  const before = await config();
  await page.locator('#add-rule').click();
  await page.locator('#rule-name').fill('Unsaved import draft');
  await select(portable);
  await preview();
  assert.match(
    await page.locator('#import-summary').innerText(),
    /bằng 3 rule/,
  );
  assert.equal(await page.locator('#import-settings li').count(), 3);
  assert.deepEqual(await config(), before);
  await page.locator('#cancel-import').click();
  assert.deepEqual(await config(), before);
  assert.equal(
    await page.locator('#rule-name').inputValue(),
    'Unsaved import draft',
  );
  await select(portable);
  await preview();
  await page.locator('#import-file').setInputFiles([]);
  assert.equal(await page.locator('#import-preview').isHidden(), true);
  assert.deepEqual(await config(), before);
  await select(portable);
  await preview();
  // Exercise the browser cancel-event handler without opening a native Windows dialog.
  await page.locator('#import-file').dispatchEvent('cancel');
  assert.equal(await page.locator('#preview-import').isDisabled(), true);
  assert.deepEqual(await config(), before);
  const cancelledDownload = await download(
    fixture.origin,
    '#direct',
    'DownloadRouterTest/Phase5/Preserved/cancelled-import.txt',
    textFixture,
    '/files/cancelled-import.txt',
  );
  results.push({
    id: 'TEST-DR-P6-04',
    status: 'pass',
    previewAndCancelPreservedConfig: true,
    draftRetained: true,
    unchangedDownloadBehavior: cancelledDownload,
    emptyReselectionClearedPreview: true,
    pickerCancelEvent:
      'Dispatched DOM cancel event; no native file picker automation.',
  });

  for (const bad of [
    '{',
    { ...portable, configVersion: 999 },
    { ...portable, surprise: true },
    { ...portable, rules: [...portable.rules, portable.rules[0]] },
    {
      ...portable,
      rules: [{ ...portable.rules[0], destination: '../escape' }],
    },
    {
      ...portable,
      rules: [
        {
          ...portable.rules[0],
          match: { type: 'regex', pattern: '(?=unsupported)' },
        },
      ],
    },
  ]) {
    await page.locator('#import-file').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from(typeof bad === 'string' ? bad : JSON.stringify(bad)),
    });
    await page
      .locator('#import-error')
      .filter({ hasText: 'Không đọc được cấu hình' })
      .waitFor();
    assert.equal(
      await page.locator('#import-file').getAttribute('aria-invalid'),
      'true',
    );
    assert.equal(await page.locator('#preview-import').isDisabled(), true);
    assert.deepEqual(await config(), before);
  }
  await page.locator('#import-file').setInputFiles({
    name: 'oversized.json',
    mimeType: 'application/json',
    buffer: Buffer.alloc(16 * 1024 * 1024 + 1, ' '),
  });
  await page.locator('#import-error').filter({ hasText: '16 MiB' }).waitFor();
  assert.deepEqual(await config(), before);
  results.push({
    id: 'TEST-DR-P6-02',
    status: 'pass',
    invalidJsonVersionUnknownFieldsAndOversizedRejected: true,
  });
  results.push({
    id: 'TEST-DR-P6-03',
    status: 'pass',
    duplicateIdUnsafePathAndUnsupportedRegexRejected: true,
  });

  const popup = await context.newPage();
  await popup.goto(`${origin}/popup/index.html`);
  await select(portable);
  await preview();
  await popup.locator('#toggle').click();
  await waitFor(
    () => page.locator('#import-preview').isHidden(),
    'external mutation invalidates preview',
  );
  assert.equal(await page.locator('#confirm-import').isDisabled(), true);
  const concurrent = await config();
  assert.equal(concurrent.settings.enabled, !before.settings.enabled);
  assert.deepEqual(concurrent.rules, before.rules);
  await preview();
  await confirm();
  assert.deepEqual(await config(), portable);
  assert.equal(await page.locator('#editor').isHidden(), true);
  await waitFor(
    async () =>
      (await popup.locator('#rule-count').innerText()).startsWith('2/3'),
    'popup reflects imported rules',
  );
  assert.equal(
    await popup.locator('#toggle').getAttribute('aria-checked'),
    'true',
  );
  const restored = await download(
    fixture.origin,
    '#direct',
    'DownloadRouterTest/Phase6/Restored/restored.txt',
    textFixture,
    '/files/restored.txt',
  );
  results.push({
    id: 'TEST-DR-P6-05',
    status: 'pass',
    otherPageCommitInvalidatedPreview: true,
    repreviewThenConfirmPreservedExactCandidate: true,
    queueRace: 'Also proven with a gated pending writer in unit tests.',
  });

  await page.locator('#export-config').click();
  const backupPath = join(downloads, 'download-router-config.json');
  await waitFor(() => existsSync(backupPath), 'actual JSON export');
  const backupText = readFileSync(backupPath, 'utf8');
  assert.deepEqual(JSON.parse(backupText), portable);
  assert.deepEqual(Object.keys(JSON.parse(backupText)).sort(), [
    'configVersion',
    'rules',
    'settings',
  ]);
  const backup = await verifyDownload(
    'download-router-config.json',
    backupText,
  );
  assert.deepEqual(await config(), portable);
  results.push({
    id: 'TEST-DR-P6-01',
    status: 'pass',
    backup,
    exactMetadataOrderSettingsAndFilters: true,
    inheritedConflictAndPriorityTieWinner: restored,
  });

  // Exhaust only a disposable key; importing a larger valid config must hit Chrome's real quota.
  const larger = globalThis.structuredClone(portable);
  larger.rules[0].name = 'Larger replacement '.repeat(100);
  await select(larger);
  await preview();
  const quota = await page.evaluate(async () => {
    const limit = chrome.storage.local.QUOTA_BYTES;
    const used = await chrome.storage.local.getBytesInUse(null);
    const key = 'phase6QuotaFiller';
    await chrome.storage.local.set({
      [key]: 'q'.repeat(limit - used - key.length - 2),
    });
    return { limit, bytes: await chrome.storage.local.getBytesInUse(null) };
  });
  assert.equal(quota.bytes, quota.limit);
  await page.locator('#confirm-import').click();
  await page
    .locator('#import-error')
    .filter({ hasText: 'Không lưu được' })
    .waitFor();
  assert.deepEqual(await config(), portable);
  assert.equal(await page.locator('#import-preview').isVisible(), true);
  const failedImportDownload = await download(
    fixture.origin,
    '#direct',
    'DownloadRouterTest/Phase6/Restored/failed-import.txt',
    textFixture,
    '/files/failed-import.txt',
  );
  await page.evaluate(() => chrome.storage.local.remove('phase6QuotaFiller'));
  await confirm();
  assert.deepEqual(await config(), larger);
  await page.locator('#import-file').setInputFiles(backupPath);
  await waitFor(
    () => page.locator('#preview-import').isEnabled(),
    'backup reread',
  );
  await preview();
  await confirm();
  assert.deepEqual(await config(), portable);
  results.push({
    id: 'TEST-DR-P6-06',
    status: 'pass',
    actualQuotaRejection: quota,
    oldConfigPreserved: true,
    oldConfigStillRoutes: failedImportDownload,
    previewRetainedForExplicitRetry: true,
    exportedBackupRestored: true,
  });

  await select(portable);
  await preview();
  await page
    .locator('[aria-labelledby="backup-heading"]')
    .screenshot({ path: join(artifacts, 'phase6-preview.png') });
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
    true,
  );
  await page
    .locator('[aria-labelledby="backup-heading"]')
    .screenshot({ path: join(artifacts, 'phase6-preview-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#cancel-import').click();
  await popup.close();

  // Commit is real; only the caller's response transport is deliberately dropped.
  await select(larger);
  await preview();
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    const probe = { original, calls: 0 };
    globalThis.__phase6Channel = probe;
    chrome.runtime.sendMessage = async (message) => {
      if (message.type === 'config.import') {
        probe.calls++;
        await original(message);
        throw new Error('Test transport closed after import commit');
      }
      return original(message);
    };
  });
  await page.locator('#confirm-import').click();
  await page
    .locator('#import-error')
    .filter({ hasText: 'chưa rõ thay đổi đã được lưu' })
    .waitFor();
  assert.equal(await page.locator('#confirm-import').isDisabled(), true);
  assert.equal(await page.locator('#import-file').isDisabled(), true);
  await page.locator('#confirm-import').dispatchEvent('click');
  assert.equal(await page.evaluate(() => globalThis.__phase6Channel.calls), 1);
  assert.deepEqual(await config(), larger);
  await page.evaluate(() => {
    chrome.runtime.sendMessage = globalThis.__phase6Channel.original;
    delete globalThis.__phase6Channel;
  });
  await page.locator('#reload-config').click();
  await ready();
  await page.locator('#import-file').setInputFiles(backupPath);
  await waitFor(
    () => page.locator('#preview-import').isEnabled(),
    'explicit reread after lost reply',
  );
  await preview();
  await confirm();
  assert.deepEqual(await config(), portable);
  results.push({
    id: 'TEST-DR-P6-06',
    status: 'pass',
    lostResponseAfterRealCommit: true,
    transportMockOnly: true,
    automaticRetries: 0,
    lockedUntilExplicitReread: true,
  });

  const freshRoot = join(artifacts, 'phase6-fresh');
  const freshDownloads = join(freshRoot, 'Downloads');
  const freshProfile = join(freshRoot, 'profile');
  mkdirSync(freshDownloads, { recursive: true });
  mkdirSync(join(freshProfile, 'Default'), { recursive: true });
  writeFileSync(
    join(freshProfile, 'Default', 'Preferences'),
    JSON.stringify({
      download: {
        default_directory: freshDownloads,
        prompt_for_download: false,
      },
    }),
  );
  const fresh = await chromium.launchPersistentContext(
    freshProfile,
    browserOptions,
  );
  let freshFile;
  const freshErrors = [];
  fresh.on('page', (target) =>
    target.on('pageerror', (error) => freshErrors.push(error.message)),
  );
  try {
    const worker =
      fresh.serviceWorkers()[0] ?? (await fresh.waitForEvent('serviceworker'));
    const target = await fresh.newPage();
    await target.goto(
      `chrome-extension://${new URL(worker.url()).hostname}/options/index.html`,
    );
    await waitFor(
      () => target.locator('#import-file').isEnabled(),
      'fresh options',
    );
    const cdp = await fresh.newCDPSession(target);
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'default',
      eventsEnabled: true,
    });
    await target.locator('#import-file').setInputFiles(backupPath);
    await waitFor(
      () => target.locator('#preview-import').isEnabled(),
      'fresh backup validated',
    );
    await preview(target);
    await confirm(target);
    assert.deepEqual(
      await target.evaluate(
        async () => (await chrome.storage.local.get('config')).config,
      ),
      portable,
    );
    const source = await fresh.newPage();
    await source.goto(fixture.origin);
    await source.locator('#direct').evaluate((link) => {
      link.href = '/files/fresh-restored.txt';
    });
    await source.locator('#direct').click();
    const filename = join(
      freshDownloads,
      'DownloadRouterTest/Phase6/Restored/fresh-restored.txt',
    );
    const entry = await waitFor(
      async () =>
        (await target.evaluate(() => chrome.downloads.search({}))).find(
          (item) => item.filename === filename && item.state === 'complete',
        ),
      'fresh Chrome completed restored download',
    );
    assert.equal(readFileSync(filename, 'utf8'), textFixture);
    freshFile = {
      downloadId: entry.id,
      state: entry.state,
      filename,
      sha256: createHash('sha256').update(readFileSync(filename)).digest('hex'),
    };
    assert.deepEqual(freshErrors, []);
  } finally {
    await fresh.close();
  }
  results.push({
    id: 'TEST-DR-P6-07',
    status: 'pass',
    existingProfileDownload: restored,
    freshProfileDownload: freshFile,
    actualBrowserExportImportedWithoutEditing: true,
    popupSynced: true,
    screenshots: ['phase6-preview.png', 'phase6-preview-mobile.png'],
    freshPageErrors: freshErrors,
  });
  return results;
}
