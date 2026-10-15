import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import {
  resolve,
  join,
  dirname,
  relative,
  basename,
  isAbsolute,
} from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import {
  startFixtureServer,
  textFixture,
  replacementFixture,
} from '../fixture-server.mjs';

const dist = resolve('dist');
const artifacts = resolve(
  '.test-artifacts',
  `phase5-native-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
);
const profile = join(artifacts, 'profile');
const downloads = join(artifacts, 'Downloads');
mkdirSync(join(profile, 'Default'), { recursive: true });
mkdirSync(join(downloads, 'Native', 'Chosen'), { recursive: true });
const fixture = await startFixtureServer(0);
const report = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  artifacts,
  headless: false,
  fixture: fixture.origin,
  distSha256: Object.fromEntries(
    readdirSync(dist, { recursive: true })
      .filter((file) => statSync(join(dist, file)).isFile())
      .sort()
      .map((file) => [
        file,
        createHash('sha256')
          .update(readFileSync(join(dist, file)))
          .digest('hex'),
      ]),
  ),
  cases: [],
  status: 'in_progress',
};
if (process.env.NATIVE_RESUME_REPORT) {
  const previous = JSON.parse(
    readFileSync(process.env.NATIVE_RESUME_REPORT, 'utf8'),
  );
  assert.deepEqual(
    previous.distSha256,
    report.distSha256,
    'Resume requires the same production build',
  );
  report.cases = previous.cases
    .filter((entry) => entry.status === 'pass')
    .map((entry) => ({
      ...entry,
      evidenceSource: process.env.NATIVE_RESUME_REPORT,
    }));
}
let context, options, source, pending;
let input;
let ruleId;
let saveAsEnabled = false;
async function waitFor(check, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function request(message) {
  const response = await options.evaluate(
    (value) => chrome.runtime.sendMessage(value),
    message,
  );
  assert.equal(response.ok, true);
  return response.config;
}
async function launch(prompt) {
  await context?.close();
  const prefsPath = join(profile, 'Default', 'Preferences');
  const prefs = existsSync(prefsPath)
    ? JSON.parse(readFileSync(prefsPath, 'utf8'))
    : {};
  prefs.download = {
    ...prefs.download,
    default_directory: downloads,
    prompt_for_download: prompt,
  };
  writeFileSync(prefsPath, JSON.stringify(prefs));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : { channel: 'chromium' }),
    headless: false,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  report.browser = context.browser().version();
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options/index.html`);
  await waitFor(async () => {
    const response = await options.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'config.get' }),
    );
    return response.ok;
  }, 'initialized config');
  const cdp = await context.newCDPSession(options);
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'default',
    eventsEnabled: true,
  });
  source = await context.newPage();
  saveAsEnabled = prompt;
}
const cases = {
  'prompt-cancel': {
    prompt: false,
    cancel: true,
    href: '/conflict/new',
    chosen: null,
  },
  'prompt-choose': {
    prompt: false,
    cancel: false,
    href: '/conflict/new',
    chosen: 'Native/Chosen/prompt-choice.txt',
  },
  'save-as-choose': {
    prompt: true,
    cancel: false,
    href: '/files/native-save-as.txt',
    chosen: 'Native/Chosen/user-choice.txt',
  },
  'save-as-cancel': {
    prompt: true,
    cancel: true,
    href: '/files/native-cancel.txt',
    chosen: null,
  },
};
try {
  await launch(false);
  const seeded = await request({ type: 'config.get' });
  for (const rule of seeded.rules)
    await request({ type: 'rule.delete', id: rule.id });
  const created = await request({
    type: 'rule.create',
    rule: {
      name: 'Native conflict fixture',
      enabled: true,
      match: { type: 'domain', pattern: '127.0.0.1' },
      destination: 'Native/Prompt',
      priority: 1000,
      conflictAction: 'prompt',
    },
  });
  ruleId = created.rules[0].id;
  const preexisting = join(downloads, 'Native', 'Prompt', 'conflict.txt');
  mkdirSync(dirname(preexisting), { recursive: true });
  writeFileSync(preexisting, textFixture);
  console.log(
    JSON.stringify({
      ready: true,
      artifacts,
      downloads,
      cases: Object.keys(cases),
    }),
  );
  input = createInterface({ input: process.stdin });
  for await (const line of input) {
    const command = JSON.parse(line);
    if (command.action === 'retry') {
      assert.ok(pending);
      command.case = pending.name;
      const history = await options.evaluate(() => chrome.downloads.search({}));
      for (const entry of history.filter(
        (entry) =>
          !pending.previousIds.includes(entry.id) &&
          entry.state === 'in_progress',
      ))
        await options.evaluate((id) => chrome.downloads.cancel(id), entry.id);
      pending = undefined;
      command.action = 'trigger';
    }
    if (command.action === 'status') {
      console.log(
        JSON.stringify({
          pending: pending?.name,
          verified: report.cases.map((entry) => entry.case),
          downloads: await options.evaluate(() => chrome.downloads.search({})),
        }),
      );
      continue;
    }
    if (command.action === 'trigger') {
      assert.equal(pending, undefined);
      const scenario = cases[command.case];
      assert.ok(scenario, 'Unknown native scenario');
      assert.ok(
        !report.cases.some((entry) => entry.case === command.case),
        'Case already verified',
      );
      if (scenario.prompt !== saveAsEnabled) await launch(scenario.prompt);
      await request({
        type: 'rule.update',
        id: ruleId,
        patch: {
          destination: scenario.prompt ? 'Native/Auto' : 'Native/Prompt',
          conflictAction: scenario.prompt ? 'uniquify' : 'prompt',
        },
      });
      const previous = await options.evaluate(() =>
        chrome.downloads.search({}),
      );
      pending = {
        name: command.case,
        scenario,
        previousIds: previous.map((entry) => entry.id),
      };
      await source.goto(fixture.origin);
      await source.evaluate(() => {
        document.title = 'Download Router Phase 5 TEST PROFILE';
      });
      await source.locator('#direct').evaluate((link, href) => {
        link.href = href;
      }, scenario.href);
      await source.locator('#direct').click();
      console.log(
        JSON.stringify({
          awaitingNativeDialog: command.case,
          saveAsSetting: saveAsEnabled,
          chosenPath: scenario.chosen ? join(downloads, scenario.chosen) : null,
          expectedAction: scenario.cancel ? 'Cancel' : 'Save to chosenPath',
        }),
      );
    } else if (command.action === 'verify') {
      assert.ok(pending);
      const history = await options.evaluate(() => chrome.downloads.search({}));
      const download = history
        .filter((entry) => !pending.previousIds.includes(entry.id))
        .sort((a, b) => b.id - a.id)[0];
      if (!download || download.state === 'in_progress') {
        console.log(
          JSON.stringify({
            stillWaiting: true,
            case: pending.name,
            state: download?.state,
            filename: download?.filename,
            message:
              'Dialog or download is still open; no timeout closes the test window.',
          }),
        );
        continue;
      }
      const scenario = pending.scenario;
      assert.equal(
        readFileSync(preexisting, 'utf8'),
        textFixture,
        'Existing fixture must remain unchanged',
      );
      const event = await options.evaluate(
        async () =>
          (await chrome.storage.local.get('lastRoutingEvent')).lastRoutingEvent,
      );
      if (scenario.cancel) {
        assert.equal(download.state, 'interrupted');
        assert.equal(download.error, 'USER_CANCELED');
      } else {
        assert.equal(download.state, 'complete');
        const savedRelative = relative(
          resolve('.test-artifacts'),
          download.filename,
        );
        assert.ok(
          !isAbsolute(savedRelative) && !savedRelative.startsWith('..'),
          'Chosen file must stay inside task-owned .test-artifacts',
        );
        assert.equal(basename(download.filename), basename(scenario.chosen));
        assert.equal(
          readFileSync(download.filename, 'utf8'),
          scenario.prompt ? textFixture : replacementFixture,
        );
      }
      report.cases.push({
        case: pending.name,
        status: 'pass',
        saveAsSetting: saveAsEnabled,
        downloadId: download.id,
        state: download.state,
        error: download.error,
        relativePath: download.filename
          ? relative(downloads, download.filename)
          : null,
        sha256: scenario.cancel
          ? null
          : createHash('sha256')
              .update(readFileSync(download.filename))
              .digest('hex'),
        originalPreserved: true,
        proposal: event,
      });
      console.log(JSON.stringify(report.cases.at(-1)));
      writeFileSync(
        join(artifacts, 'native-report.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
      pending = undefined;
    } else if (command.action === 'finish') {
      assert.equal(pending, undefined);
      assert.equal(report.cases.length, Object.keys(cases).length);
      report.status = 'pass';
      break;
    } else {
      throw new Error('Unknown command');
    }
  }
  assert.equal(report.status, 'pass', 'All four native cases are required');
} catch (error) {
  report.status = 'fail';
  report.error = error.stack;
  if (options && !options.isClosed())
    report.diagnostics = await options
      .evaluate(async () => ({
        downloads: await chrome.downloads.search({}),
        stored: await chrome.storage.local.get(['config', 'lastRoutingEvent']),
      }))
      .catch(() => null);
  process.exitCode = 1;
} finally {
  input?.close();
  process.stdin.pause();
  await context?.close();
  await fixture.close();
  writeFileSync(
    join(artifacts, 'native-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `Native conflict E2E: ${report.status}. Evidence: ${join(artifacts, 'native-report.json')}`,
  );
}
