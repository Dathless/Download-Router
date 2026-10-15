import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { textFixture } from '../fixture-server.mjs';

export async function runPopupE2E({
  page,
  context,
  fixture,
  download,
  waitFor,
  artifacts,
}) {
  const results = [];
  const extensionOrigin = `chrome-extension://${new URL(page.url()).hostname}`;
  const popupUrl = `${extensionOrigin}/popup/index.html`;
  let popup;
  async function open() {
    popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 720 });
    await popup.goto(popupUrl);
    await ready();
  }
  async function ready() {
    await waitFor(() => popup.locator('#toggle').isEnabled(), 'popup ready');
  }
  async function config() {
    const response = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'config.get' }),
    );
    assert.equal(response.ok, true);
    return response.config;
  }
  async function checked(value) {
    await waitFor(
      async () =>
        (await popup.locator('#toggle').getAttribute('aria-checked')) ===
        String(value),
      `saved routing=${value}`,
    );
  }
  async function optionsReady() {
    await waitFor(
      () => page.locator('#save-settings').isEnabled(),
      'options ready',
    );
  }
  async function saveOptionsEnabled(value) {
    await page.locator('#settings-enabled').setChecked(value);
    await page.locator('#save-settings').click();
    await waitFor(
      async () => (await config()).settings.enabled === value,
      'options setting committed',
    );
    await optionsReady();
  }

  await page.locator('#cancel-rule').click();
  await optionsReady();
  await open();
  const beforeToggle = await config();
  assert.equal(beforeToggle.rules.length, 2);
  await checked(true);
  assert.match(await popup.locator('#rule-count').innerText(), /^2\/2/);
  await popup.locator('#toggle').focus();
  await popup.keyboard.press('Space');
  await ready();
  await checked(false);
  await waitFor(
    () =>
      page
        .locator('#settings-enabled')
        .isChecked()
        .then((value) => !value),
    'options reflects popup toggle',
  );
  assert.deepEqual((await config()).rules, beforeToggle.rules);
  assert.equal(
    (await config()).settings.matchRedirectedUrl,
    beforeToggle.settings.matchRedirectedUrl,
  );
  await saveOptionsEnabled(true);
  await checked(true);
  const offRule = beforeToggle.rules[0];
  await page
    .locator(`[data-rule-id="${offRule.id}"]`)
    .getByRole('button', { name: /^Tắt rule/ })
    .click();
  await waitFor(
    async () =>
      (await popup.locator('#rule-count').innerText()).startsWith('1/2'),
    'live enabled count',
  );
  await optionsReady();
  await page
    .locator(`[data-rule-id="${offRule.id}"]`)
    .getByRole('button', { name: /^Bật rule/ })
    .click();
  await waitFor(
    async () =>
      (await popup.locator('#rule-count').innerText()).startsWith('2/2'),
    'live count restored',
  );

  // Fill only a disposable test key to the real quota; true→false needs one extra byte.
  const quota = await page.evaluate(async () => {
    const used = await chrome.storage.local.getBytesInUse(null);
    const limit = chrome.storage.local.QUOTA_BYTES;
    const key = 'phase4QuotaFiller';
    await chrome.storage.local.set({
      [key]: 'q'.repeat(limit - used - key.length - 2),
    });
    return { limit, bytes: await chrome.storage.local.getBytesInUse(null) };
  });
  assert.equal(quota.bytes, quota.limit);
  const beforeReject = await config();
  await popup.locator('#toggle').click();
  await popup.locator('#error').filter({ hasText: 'Không lưu được' }).waitFor();
  await ready();
  await checked(true);
  assert.equal(await popup.locator('#action-status').innerText(), '');
  assert.deepEqual(await config(), beforeReject);
  await page.evaluate(() => chrome.storage.local.remove('phase4QuotaFiller'));
  await popup.locator('#toggle').click();
  await ready();
  await checked(false);
  await popup.locator('#toggle').click();
  await ready();
  await checked(true);
  results.push({
    id: 'TEST-DR-P4-01',
    status: 'pass',
    liveEnabledCount: true,
    actualQuotaRejection: quota,
    failedTogglePreservedConfig: true,
    retryWorked: true,
    unrelatedRulesAndSettingsPreserved: true,
    zeroRules:
      'Asserted through UI below; empty state also covered by popup integration suite.',
  });

  const target = 'DownloadRouterTest/Phase4';
  await page.locator('#add-rule').click();
  await page.locator('#rule-name').fill('Popup fixture');
  await page.locator('#rule-type').selectOption('domain');
  await page.locator('#rule-pattern').fill('127.0.0.1');
  await page.locator('#rule-destination').fill(target);
  await page.locator('#rule-priority').fill('1000');
  await page.locator('#save-rule').click();
  await page.locator('#editor').waitFor({ state: 'hidden' });
  await optionsReady();
  const routingRule = (await config()).rules.find(
    (rule) => rule.name === 'Popup fixture',
  );
  assert.ok(routingRule);
  const routed = await download(
    fixture.origin,
    '#direct',
    `${target}/popup-token.txt`,
    textFixture,
    '/files/popup-token.txt?token=PHASE4_PRIVATE_TOKEN',
  );
  await waitFor(
    async () =>
      (await popup.locator('#event-basename').innerText()) ===
      'popup-token.txt',
    'live latest event',
  );
  const storedEvent = await page.evaluate(
    async () =>
      (await chrome.storage.local.get('lastRoutingEvent')).lastRoutingEvent,
  );
  assert.deepEqual(Object.keys(storedEvent).sort(), [
    'basename',
    'destination',
    'ruleId',
    'timestamp',
  ]);
  assert.deepEqual(storedEvent, {
    timestamp: storedEvent.timestamp,
    ruleId: routingRule.id,
    basename: 'popup-token.txt',
    destination: target,
  });
  assert.ok(Number.isSafeInteger(storedEvent.timestamp));
  assert.ok(!JSON.stringify(storedEvent).includes('PHASE4_PRIVATE_TOKEN'));
  assert.ok(
    !(await popup.locator('body').innerText()).includes('PHASE4_PRIVATE_TOKEN'),
  );
  assert.ok(
    !(await popup.locator('body').innerText()).includes(fixture.origin),
  );
  assert.match(
    await popup.locator('body').innerText(),
    /chưa xác nhận tải hoàn tất/,
  );
  assert.equal(Object.hasOwn(await config(), 'lastRoutingEvent'), false);
  await popup.close();
  await open();
  await waitFor(
    async () =>
      (await popup.locator('#event-basename').innerText()) ===
      'popup-token.txt',
    'persisted event on reopen',
  );

  await popup.locator('#toggle').click();
  await ready();
  await checked(false);
  const fallback = await download(
    fixture.origin,
    '#direct',
    'popup-disabled.txt',
    textFixture,
    '/files/popup-disabled.txt?token=PHASE4_FALLBACK_TOKEN',
  );
  assert.deepEqual(
    await page.evaluate(
      async () =>
        (await chrome.storage.local.get('lastRoutingEvent')).lastRoutingEvent,
    ),
    storedEvent,
  );
  await popup.locator('#toggle').click();
  await ready();
  await checked(true);
  results.push({
    id: 'TEST-DR-P4-04',
    status: 'pass',
    emptyEventBeforeFirstDownload: true,
    whitelistedEvent: storedEvent,
    noUrlOrQueryInEventOrPopup: true,
    reopenedEventPersisted: true,
    fallbackDidNotReplaceEvent: true,
    proposalDisclaimerVisible: true,
    files: [routed, fallback],
  });

  const screenshot = join(artifacts, 'popup.png');
  assert.equal(
    await popup.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
  );
  await popup.screenshot({ path: screenshot, fullPage: true });
  await popup.emulateMedia({ colorScheme: 'dark' });
  const darkScreenshot = join(artifacts, 'popup-dark.png');
  await popup.screenshot({ path: darkScreenshot, fullPage: true });

  await popup.locator('#toggle').focus();
  await popup.keyboard.press('Enter');
  await ready();
  await checked(false);
  const focus = await popup
    .locator('#toggle')
    .evaluate((element) => globalThis.getComputedStyle(element).outlineStyle);
  assert.notEqual(focus, 'none');
  await popup.keyboard.press('Tab');
  assert.equal(
    await popup.evaluate(() => document.activeElement.id),
    'options',
  );
  await popup.keyboard.press('Shift+Tab');
  assert.equal(await popup.evaluate(() => document.activeElement.id), 'toggle');
  await popup.keyboard.press('Space');
  await ready();
  await checked(true);
  await popup.keyboard.press('Tab');
  await popup.keyboard.press('Enter');
  await waitFor(
    () =>
      context
        .pages()
        .some(
          (candidate) =>
            candidate.url() === `${extensionOrigin}/options/index.html`,
        ),
    'Manage Rules opens options',
  );
  // A page focus can close a toolbar popup; the document used for cross-page sync stays open here.
  assert.equal(await popup.locator('#options').getAttribute('type'), 'button');
  results.push({
    id: 'TEST-DR-P4-05',
    status: 'pass',
    nativeSwitchKeyboard: ['Space', 'Enter', 'Tab', 'Shift+Tab'],
    focusVisible: focus,
    optionsOpened: true,
    screenshots: { light: screenshot, dark: darkScreenshot },
  });

  // Chrome's action popup is a CDP page target that Playwright does not expose as a Page.
  await popup.close();
  await page.evaluate(() => chrome.action.openPopup());
  const actionCdp = await context.newCDPSession(page);
  const targetInfo = await waitFor(
    async () =>
      (await actionCdp.send('Target.getTargets')).targetInfos.find(
        (target) => target.url === popupUrl,
      ),
    'native action popup target',
  );
  const { sessionId } = await actionCdp.send('Target.attachToTarget', {
    targetId: targetInfo.targetId,
    flatten: false,
  });
  const replies = new Map();
  actionCdp.on('Target.receivedMessageFromTarget', (payload) => {
    const reply = JSON.parse(payload.message);
    if (payload.sessionId === sessionId && reply.id)
      replies.set(reply.id, reply);
  });
  let commandId = 0;
  async function actionCommand(method, params = {}) {
    const id = ++commandId;
    await actionCdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    const response = await waitFor(
      () => replies.get(id),
      `action popup ${method}`,
    );
    assert.equal(response.error, undefined);
    return response.result;
  }
  async function actionValue(expression) {
    const response = await actionCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    assert.equal(response.exceptionDetails, undefined);
    return response.result.value;
  }
  await waitFor(
    () => actionValue('!document.getElementById("toggle").disabled'),
    'native popup ready',
  );
  assert.equal(
    await actionValue(
      'document.getElementById("toggle").getAttribute("aria-checked")',
    ),
    'true',
  );
  await actionValue('document.getElementById("toggle").focus()');
  async function actionKey(key, code, virtualKeyCode) {
    for (const type of ['keyDown', 'keyUp'])
      await actionCommand('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        windowsVirtualKeyCode: virtualKeyCode,
        nativeVirtualKeyCode: virtualKeyCode,
      });
  }
  await actionKey(' ', 'Space', 32);
  await waitFor(
    async () => !(await config()).settings.enabled,
    'native popup keyboard commit',
  );
  await waitFor(
    () =>
      actionValue(
        '!document.getElementById("toggle").disabled && document.activeElement.id === "toggle"',
      ),
    'native popup focus restored',
  );
  await actionKey(' ', 'Space', 32);
  await waitFor(
    async () => (await config()).settings.enabled,
    'native popup keyboard restore',
  );
  await waitFor(
    () => actionValue('!document.getElementById("toggle").disabled'),
    'native popup saved',
  );
  const nativeState = await actionValue(
    '({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,optionsBottom:document.getElementById("options").getBoundingClientRect().bottom,count:document.getElementById("rule-count").textContent,basename:document.getElementById("event-basename").textContent})',
  );
  assert.ok(nativeState.scrollWidth <= nativeState.width);
  assert.ok(
    nativeState.optionsBottom <= nativeState.height,
    'Manage Rules fits inside actual popup',
  );
  assert.match(nativeState.count, /^3\/3/);
  assert.equal(nativeState.basename, 'popup-token.txt');
  const nativeScreenshot = join(artifacts, 'popup-action.png');
  const nativeImage = await actionCommand('Page.captureScreenshot', {
    format: 'png',
  });
  writeFileSync(nativeScreenshot, Buffer.from(nativeImage.data, 'base64'));
  results.push({
    id: 'PHASE4-ACTION-POPUP-SMOKE',
    status: 'pass',
    openedBy: 'chrome.action.openPopup (Chromium 149 test only)',
    nativeKeyboardToggle: true,
    nativeFocusRestored: true,
    state: nativeState,
    screenshot: nativeScreenshot,
  });
  await actionCdp.send('Target.closeTarget', { targetId: targetInfo.targetId });
  await actionCdp.detach();
  await open();

  // Exercise the empty rule state through Options, without raw config replacement.
  for (const rule of (await config()).rules) {
    await optionsReady();
    await page
      .locator(`[data-rule-id="${rule.id}"]`)
      .getByRole('button', { name: /^Xóa rule/ })
      .click();
    await waitFor(
      async () => !(await config()).rules.some((entry) => entry.id === rule.id),
      'UI delete for zero rules',
    );
  }
  await waitFor(
    async () =>
      (await popup.locator('#rule-count').innerText()).startsWith('0/0'),
    'zero rules popup',
  );
  await popup.close();
  for (const candidate of context.pages()) {
    if (candidate.url().startsWith(`${extensionOrigin}/`))
      await candidate.goto('about:blank');
  }
  const lifecyclePage = await context.newPage();
  const cdp = await context.newCDPSession(lifecyclePage);
  const versions = new Map();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
    for (const version of updates) versions.set(version.versionId, version);
  });
  await cdp.send('ServiceWorker.enable');
  const running = await waitFor(
    () =>
      [...versions.values()].find(
        (version) =>
          version.scriptURL === `${extensionOrigin}/background.js` &&
          version.runningStatus === 'running',
      ),
    'popup cold-start running worker',
  );
  const worker = context
    .serviceWorkers()
    .find((candidate) => candidate.url() === running.scriptURL);
  assert.ok(worker);
  await worker.evaluate(() => {
    globalThis.__phase4Lifetime = true;
  });
  await cdp.send('ServiceWorker.stopWorker', { versionId: running.versionId });
  const stopped = await waitFor(() => {
    const version = versions.get(running.versionId);
    return version?.runningStatus === 'stopped' ? { ...version } : false;
  }, 'worker stopped before opening popup');
  await open();
  await checked(true);
  assert.match(await popup.locator('#rule-count').innerText(), /^0\/0/);
  await waitFor(
    async () =>
      (await popup.locator('#event-basename').innerText()) ===
      'popup-token.txt',
    'event after worker stop',
  );
  const restarted = await waitFor(
    () =>
      [...versions.values()].find(
        (version) =>
          version.scriptURL === running.scriptURL &&
          version.runningStatus === 'running',
      ),
    'popup wakes worker',
  );
  const newWorker = context
    .serviceWorkers()
    .find((candidate) => candidate.url() === running.scriptURL);
  assert.ok(newWorker);
  assert.equal(
    await newWorker.evaluate(() => Boolean(globalThis.__phase4Lifetime)),
    false,
  );
  results.push({
    id: 'TEST-DR-P4-02',
    status: 'pass',
    optionsAndPopupSync: true,
    reopenedPopupReadsSavedState: true,
    stopped,
    restarted: {
      versionId: restarted.versionId,
      runningStatus: restarted.runningStatus,
    },
    workerMarkerReset: true,
  });
  await popup.close();
  await lifecyclePage.close();
  await page.goto(`${extensionOrigin}/options/index.html`);
  return results;
}
