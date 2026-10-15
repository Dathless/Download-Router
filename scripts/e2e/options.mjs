import assert from 'node:assert/strict';
import { join } from 'node:path';
import { textFixture, pdfFixture } from '../fixture-server.mjs';

export async function runOptionsE2E({
  page,
  context,
  fixture,
  download,
  waitFor,
  artifacts,
}) {
  const results = [];
  const row = (id) => page.locator(`[data-rule-id="${id}"]`);
  async function config() {
    const response = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'config.get' }),
    );
    assert.equal(response.ok, true);
    return response.config;
  }
  async function ready() {
    await waitFor(
      () => page.locator('#add-rule').isEnabled(),
      'options write controls ready',
    );
  }
  async function save() {
    await page.locator('#save-rule').click();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    await ready();
  }
  async function edit(id) {
    await row(id)
      .getByRole('button', { name: /^Sửa rule/ })
      .click();
  }
  async function fields(values) {
    for (const [key, value] of Object.entries(values)) {
      const control = page.locator(`#rule-${key}`);
      if (key === 'type' || key === 'conflictAction')
        await control.selectOption(value);
      else if (key === 'enabled') await control.setChecked(value);
      else await control.fill(String(value));
    }
  }
  async function settings(patch) {
    if ('enabled' in patch)
      await page.locator('#settings-enabled').setChecked(patch.enabled);
    if ('matchRedirectedUrl' in patch)
      await page
        .locator('#settings-redirect')
        .setChecked(patch.matchRedirectedUrl);
    if ('defaultConflictAction' in patch)
      await page
        .locator('#settings-conflict')
        .selectOption(patch.defaultConflictAction);
    await page.locator('#save-settings').click();
    await ready();
    const current = await config();
    for (const [key, value] of Object.entries(patch))
      assert.equal(current.settings[key], value);
  }

  await ready();
  for (const rule of (await config()).rules) {
    await row(rule.id)
      .getByRole('button', { name: /^Xóa rule/ })
      .click();
    await waitFor(
      async () => !(await config()).rules.some((entry) => entry.id === rule.id),
      'rule deleted through UI',
    );
    await ready();
  }
  await page.locator('#empty-state').waitFor();
  const markupName = '<img src=x onerror="globalThis.__phase3Xss=1">';
  const pdfPattern = '^http://127[.]0[.]0[.]1:[0-9]+/download/123$';
  await page.locator('#add-rule').click();
  await fields({
    name: markupName,
    type: 'regex',
    pattern: '(?=a)',
    destination: '../escape',
    priority: '1.5',
    extensions: '.PDF',
    mimeTypes: 'APPLICATION/PDF',
  });
  await page.locator('#save-rule').click();
  await page.locator('#rule-pattern-error').waitFor();
  assert.equal(
    await page.locator('#rule-pattern').getAttribute('aria-invalid'),
    'true',
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'rule-pattern',
  );
  assert.ok(
    (await page.locator('#rule-destination-error').textContent()).includes(
      'thư mục con',
    ),
  );
  assert.ok(
    (await page.locator('#rule-priority-error').textContent()).includes(
      'số nguyên',
    ),
  );
  assert.equal((await config()).rules.length, 0);
  await fields({
    pattern: pdfPattern,
    destination: 'DownloadRouterTest/Phase3/PDF',
    priority: '50',
  });

  await page.locator('#test-url').fill(`${fixture.origin}/download/123`);
  await page.locator('#test-rule').click();
  assert.match(
    await page.locator('#test-result').textContent(),
    /Chưa đủ dữ liệu: basename Chrome, MIME/,
  );
  await page.locator('#test-filename').fill('report.pdf');
  await page.locator('#test-mime').fill('application/pdf');
  await page.locator('#test-rule').click();
  assert.match(await page.locator('#test-result').textContent(), /^MATCH\n/);
  assert.ok(
    (await page.locator('#test-result').textContent()).includes(
      'Downloads/DownloadRouterTest/Phase3/PDF/report.pdf',
    ),
  );
  assert.equal((await config()).rules.length, 0, 'Rule test must not save');
  results.push({
    id: 'TEST-DR-P3-04',
    status: 'pass',
    missingMetadataReported: true,
    noUrlFilenameGuessing: true,
    noMutationOnTest: true,
  });

  await save();
  let stored = await config();
  const primary = stored.rules[0];
  assert.equal(primary.name, markupName);
  assert.equal(await row(primary.id).locator('img').count(), 0);
  assert.ok((await row(primary.id).textContent()).includes(markupName));
  assert.equal(await page.evaluate(() => globalThis.__phase3Xss), undefined);
  results.push({
    id: 'TEST-DR-P3-02',
    status: 'pass',
    invalidFieldsRejectedBeforeWrite: true,
    markupRenderedAsText: true,
  });
  const primaryFile = await download(
    fixture.origin,
    '#pdf',
    'DownloadRouterTest/Phase3/PDF/report.pdf',
    pdfFixture,
  );

  await row(primary.id)
    .getByRole('button', { name: /^Nhân bản rule/ })
    .click();
  await waitFor(
    async () => (await config()).rules.length === 2,
    'duplicate saved',
  );
  await ready();
  stored = await config();
  const duplicate = stored.rules[1];
  assert.notEqual(duplicate.id, primary.id);
  assert.ok(duplicate.createdAt >= primary.createdAt);
  assert.deepEqual(
    stored.rules.map((rule) => rule.id),
    [primary.id, duplicate.id],
  );
  await edit(duplicate.id);
  await fields({
    destination: 'DownloadRouterTest/Phase3/Copy',
    priority: '100',
  });
  await save();
  const duplicateFile = await download(
    fixture.origin,
    '#pdf',
    'DownloadRouterTest/Phase3/Copy/report.pdf',
    pdfFixture,
  );
  await row(duplicate.id)
    .getByRole('button', { name: /^Tắt rule/ })
    .click();
  await waitFor(
    async () => (await config()).rules[1].enabled === false,
    'duplicate disabled',
  );
  await ready();
  const disabledFile = await download(
    fixture.origin,
    '#pdf',
    'DownloadRouterTest/Phase3/PDF/report (1).pdf',
    pdfFixture,
  );
  await row(duplicate.id)
    .getByRole('button', { name: /^Bật rule/ })
    .click();
  await waitFor(
    async () => (await config()).rules[1].enabled === true,
    'duplicate re-enabled',
  );
  await ready();
  await row(duplicate.id)
    .getByRole('button', { name: /^Xóa rule/ })
    .click();
  await waitFor(
    async () => (await config()).rules.length === 1,
    'duplicate deleted',
  );
  await ready();
  await page.reload();
  await ready();
  assert.equal((await config()).rules[0].id, primary.id);
  assert.equal((await config()).rules[0].createdAt, primary.createdAt);
  await row(primary.id).waitFor();
  results.push({
    id: 'TEST-DR-P3-01',
    status: 'pass',
    createdId: primary.id,
    duplicateId: duplicate.id,
    persistedAfterReload: true,
    orderAndMetadataPreserved: true,
    files: [primaryFile, duplicateFile, disabledFile],
  });

  // Keep an editor open in one page while another UI changes an unrelated field.
  await edit(primary.id);
  await fields({ destination: 'DownloadRouterTest/Phase3/Edited' });
  const second = await context.newPage();
  await second.goto(page.url());
  await second
    .locator(`#row-${primary.id}`)
    .getByRole('button', { name: /^Tắt rule/ })
    .click();
  await waitFor(
    async () => (await config()).rules[0].enabled === false,
    'toggle from second options page',
  );
  assert.equal(
    await page.locator('#rule-destination').inputValue(),
    'DownloadRouterTest/Phase3/Edited',
  );
  await save();
  assert.equal(
    (await config()).rules[0].enabled,
    false,
    'Stale editor must not undo a concurrent toggle',
  );
  assert.equal(
    (await config()).rules[0].destination,
    'DownloadRouterTest/Phase3/Edited',
  );
  await second.close();
  await row(primary.id)
    .getByRole('button', { name: /^Bật rule/ })
    .click();
  await waitFor(
    async () => (await config()).rules[0].enabled,
    'primary enabled',
  );
  await ready();

  // Hold only the caller transport to deterministically exercise pending UI state.
  await edit(primary.id);
  await fields({ destination: 'DownloadRouterTest/Phase3/PDF' });
  const beforePending = await config();
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    const probe = { original, calls: 0, release: null };
    globalThis.__phase3Pending = probe;
    chrome.runtime.sendMessage = (message) => {
      if (message.type === 'rule.update') {
        probe.calls++;
        return new Promise((resolve, reject) => {
          probe.release = () => original(message).then(resolve, reject);
        });
      }
      return original(message);
    };
  });
  await page.locator('#save-rule').click();
  await waitFor(
    () => page.evaluate(() => !!globalThis.__phase3Pending.release),
    'pending caller request',
  );
  assert.equal(await page.locator('#save-rule').isDisabled(), true);
  await page.locator('#rule-form').dispatchEvent('submit');
  await page.locator('#rule-form').dispatchEvent('submit');
  assert.equal(await page.evaluate(() => globalThis.__phase3Pending.calls), 1);
  assert.deepEqual(
    await config(),
    beforePending,
    'No success or storage write before releasing transport',
  );
  await page.evaluate(() => globalThis.__phase3Pending.release());
  await page.locator('#editor').waitFor({ state: 'hidden' });
  await ready();
  await page.evaluate(() => {
    chrome.runtime.sendMessage = globalThis.__phase3Pending.original;
    delete globalThis.__phase3Pending;
  });

  // Force a real storage quota rejection from the form, retaining all unsaved values.
  const beforeFailure = await config();
  await page.locator('#add-rule').click();
  await fields({
    name: 'Retry draft',
    type: 'domain',
    pattern: '127.0.0.1',
    destination: 'DownloadRouterTest/Phase3/Retry',
    priority: '0',
  });
  const hugeLength = await page.locator('#rule-name').evaluate((node) => {
    node.value = 'x'.repeat(chrome.storage.local.QUOTA_BYTES + 1024);
    return node.value.length;
  });
  await page.locator('#rule-name').dispatchEvent('input');
  await page.locator('#save-rule').click();
  await page
    .locator('#save-error')
    .filter({ hasText: 'Không lưu được cấu hình' })
    .waitFor();
  assert.equal(await page.locator('#editor').isVisible(), true);
  assert.equal(
    await page.locator('#rule-name').evaluate((node) => node.value.length),
    hugeLength,
  );
  assert.equal(
    await page.locator('#rule-destination').inputValue(),
    'DownloadRouterTest/Phase3/Retry',
  );
  assert.deepEqual(await config(), beforeFailure);
  await fields({ name: 'Retry draft' });
  await save();
  const retryRule = (await config()).rules.find(
    (rule) => rule.name === 'Retry draft',
  );
  assert.ok(retryRule);
  const beforeCancel = await config();
  await edit(retryRule.id);
  await fields({ name: 'Discard this unsaved change' });
  await page.locator('#cancel-rule').click();
  assert.deepEqual(await config(), beforeCancel);

  // A lost reply can follow a committed write. The UI must not auto-retry it.
  await edit(retryRule.id);
  await fields({ name: 'Committed before channel closed' });
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    const probe = { original, calls: 0 };
    globalThis.__phase3Channel = probe;
    chrome.runtime.sendMessage = async (message) => {
      if (message.type === 'rule.update') {
        probe.calls++;
        await original(message);
        throw new Error('Test transport closed after commit');
      }
      return original(message);
    };
  });
  await page.locator('#save-rule').click();
  await page
    .locator('#save-error')
    .filter({ hasText: 'chưa rõ thay đổi đã được lưu' })
    .waitFor();
  assert.equal(await page.locator('#save-rule').isDisabled(), true);
  await page.locator('#rule-form').dispatchEvent('submit');
  assert.equal(await page.evaluate(() => globalThis.__phase3Channel.calls), 1);
  assert.equal(
    (await config()).rules.find((rule) => rule.id === retryRule.id).name,
    'Committed before channel closed',
  );
  await page.evaluate(() => {
    chrome.runtime.sendMessage = globalThis.__phase3Channel.original;
    delete globalThis.__phase3Channel;
  });
  await page.locator('#reload-config').click();
  await ready();
  await page.locator('#cancel-rule').click();
  await row(retryRule.id)
    .getByRole('button', { name: /^Xóa rule/ })
    .click();
  await waitFor(
    async () => (await config()).rules.length === 1,
    'temporary retry rule deleted',
  );
  await ready();
  results.push({
    id: 'TEST-DR-P3-05',
    status: 'pass',
    pendingTransportMockOnly: true,
    duplicateSubmissionsSent: 1,
    actualStorageQuotaRejected: true,
    draftRetainedOnFailure: true,
    retryAndCancelVerified: true,
    staleEditorPreservedConcurrentToggle: true,
    closedChannelNotRetriedAfterCommit: true,
  });

  // Reach the editor and create/edit/delete a rule using keyboard controls.
  await page.locator('#add-rule').focus();
  await page.keyboard.press('Enter');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'rule-name',
  );
  await page.keyboard.type('Keyboard rule');
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'rule-type',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'rule-priority',
  );
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'rule-type',
  );
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'rule-pattern',
  );
  assert.notEqual(
    await page
      .locator('#rule-pattern')
      .evaluate(
        (node) =>
          node.ownerDocument.defaultView.getComputedStyle(node).outlineStyle,
      ),
    'none',
  );
  await page.keyboard.type('127.0.0.1');
  await page.keyboard.press('Tab');
  await page.keyboard.type('DownloadRouterTest/Phase3/Keyboard');
  const reached = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => document.activeElement.id));
  }
  assert.deepEqual(reached, [
    'rule-extensions',
    'rule-mimeTypes',
    'rule-conflictAction',
    'rule-enabled',
    'save-rule',
  ]);
  await page.keyboard.press('Enter');
  await page.locator('#editor').waitFor({ state: 'hidden' });
  await ready();
  const keyboardRule = (await config()).rules.find(
    (rule) => rule.name === 'Keyboard rule',
  );
  assert.ok(keyboardRule);
  await row(keyboardRule.id)
    .getByRole('button', { name: /^Sửa rule/ })
    .focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  assert.equal(
    await page.locator('#rule-name').getAttribute('aria-invalid'),
    'true',
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'rule-name',
  );
  await page.keyboard.type('Keyboard edited');
  await page.keyboard.press('Enter');
  await page.locator('#editor').waitFor({ state: 'hidden' });
  await ready();
  assert.equal(
    (await config()).rules.find((rule) => rule.id === keyboardRule.id).name,
    'Keyboard edited',
  );
  await row(keyboardRule.id)
    .getByRole('button', { name: /^Sửa rule/ })
    .focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    `edit-${keyboardRule.id}`,
  );
  await page.keyboard.press('Enter');
  await row(keyboardRule.id)
    .getByRole('button', { name: /^Xóa rule/ })
    .focus();
  await page.keyboard.press('Space');
  await waitFor(
    async () =>
      !(await config()).rules.some((rule) => rule.id === keyboardRule.id),
    'keyboard delete',
  );
  await ready();
  await page.locator('#cancel-rule').focus();
  await page.keyboard.press('Enter');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'add-rule',
  );
  results.push({
    id: 'TEST-DR-P3-06',
    status: 'pass',
    tabAndShiftTab: true,
    visibleFocus: true,
    keyboardCreateEditDeleteCancel: true,
    fieldErrorAndFocus: true,
  });

  await page.locator('#add-rule').click();
  await fields({
    name: 'Redirect text files',
    type: 'prefix',
    pattern: `${fixture.origin}/files/`,
    destination: 'DownloadRouterTest/Phase3/Redirect',
    priority: '10',
    extensions: 'txt',
  });
  await save();
  await settings({ matchRedirectedUrl: true });
  const redirectFile = await download(
    fixture.origin,
    '#redirect',
    'DownloadRouterTest/Phase3/Redirect/sample.txt',
    textFixture,
  );
  await settings({ matchRedirectedUrl: false });
  const noRedirectFile = await download(
    fixture.origin,
    '#redirect',
    'sample (1).txt',
    textFixture,
  );
  await settings({ defaultConflictAction: 'overwrite' });
  await edit(primary.id);
  await fields({ name: 'PDF tài liệu' });
  await page.locator('#test-url').fill(`${fixture.origin}/download/123`);
  await page.locator('#test-filename').fill('report.pdf');
  await page.locator('#test-mime').fill('application/pdf');
  await page.locator('#test-rule').click();
  assert.ok(
    (await page.locator('#test-result').textContent()).includes(
      'Conflict: overwrite',
    ),
  );
  await save();
  assert.equal((await config()).rules[0].conflictAction, undefined);
  const inheritedFile = await download(
    fixture.origin,
    '#pdf',
    'DownloadRouterTest/Phase3/PDF/report.pdf',
    pdfFixture,
  );
  assert.notEqual(
    inheritedFile.downloadId,
    primaryFile.downloadId,
    'Overwrite proof must use a new download ID',
  );
  await edit(primary.id);
  await fields({
    conflictAction: 'uniquify',
    destination: 'DownloadRouterTest/Phase3/Override',
  });
  await save();
  const overrideFirst = await download(
    fixture.origin,
    '#pdf',
    'DownloadRouterTest/Phase3/Override/report.pdf',
    pdfFixture,
  );
  const overrideSecond = await download(
    fixture.origin,
    '#pdf',
    'DownloadRouterTest/Phase3/Override/report (1).pdf',
    pdfFixture,
  );
  assert.equal((await config()).settings.defaultConflictAction, 'overwrite');
  assert.equal((await config()).rules[0].conflictAction, 'uniquify');
  await settings({
    defaultConflictAction: 'uniquify',
    matchRedirectedUrl: true,
  });
  results.push({
    id: 'TEST-DR-P3-07',
    status: 'pass',
    settingsSavedThroughUi: true,
    inheritedAction: 'overwrite',
    overrideAction: 'uniquify',
    files: [
      redirectFile,
      noRedirectFile,
      inheritedFile,
      overrideFirst,
      overrideSecond,
    ],
  });

  await edit(primary.id);
  await page.locator('#test-url').fill(`${fixture.origin}/download/123`);
  await page.locator('#test-filename').fill('report.pdf');
  await page.locator('#test-mime').fill('application/pdf');
  await page.locator('#test-rule').click();
  await page.setViewportSize({ width: 1280, height: 960 });
  const desktop = join(artifacts, 'options-desktop.png');
  await page.screenshot({ path: desktop, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
    'Options must reflow without page overflow',
  );
  const mobile = join(artifacts, 'options-mobile.png');
  await page.screenshot({ path: mobile, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 960 });
  results.push({
    id: 'PHASE3-UI-SMOKE',
    status: 'pass',
    screenshots: { desktop, mobile },
    mobileReflow: true,
    onlySelectedRuleTested: true,
  });
  return results;
}
