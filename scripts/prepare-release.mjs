import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This repository's release environment is Windows; normal build/test scripts remain portable.
assert.equal(
  process.platform,
  'win32',
  'Release packaging requires Windows PowerShell.',
);
assert.ok(process.env.npm_execpath, 'Run through pnpm release:prepare.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
).version;
const output = join(
  root,
  '.test-artifacts',
  `release-${version}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
);
const source = join(output, 'source');
mkdirSync(source, { recursive: true });
const hash = (value) => createHash('sha256').update(value).digest('hex');
function hashes(directory) {
  return Object.fromEntries(
    readdirSync(directory, { recursive: true })
      .filter((name) => statSync(join(directory, name)).isFile())
      .sort()
      .map((name) => [
        name.replaceAll('\\', '/'),
        hash(readFileSync(join(directory, name))),
      ]),
  );
}
const files = execFileSync(
  'git',
  ['ls-files', '-co', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .filter((name) => existsSync(join(root, name)))
  .filter(
    (name) =>
      /^(?:src\/|public\/|scripts\/|tests\/|docs\/(?!evidence\/))/u.test(
        name,
      ) ||
      /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json|vite\.config\.ts|vitest\.config\.ts|eslint\.config\.js|\.prettier.*|\.gitattributes|\.gitignore|README\.md|AGENTS\.md|CHANGELOG\.md)$/u.test(
        name,
      ),
  );
for (const file of files) {
  const target = join(source, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, file), target);
}
const sourceSha256 = hashes(source);
const report = {
  version,
  startedAt: new Date().toISOString(),
  output,
  source,
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  revision:
    'Uncommitted candidate identified by source SHA-256, built in a separate clean source snapshot.',
  sourceSha256,
  sourceDigest: hash(JSON.stringify(sourceSha256)),
  node: process.version,
  commands: [],
  results: [],
  status: 'running',
};
function run(args, environment = {}) {
  const pnpm = process.env.npm_execpath;
  const command = pnpm.endsWith('.exe') ? pnpm : process.execPath;
  const prefix = command === pnpm ? [] : [pnpm];
  const result = spawnSync(
    command,
    [...prefix, '--store-dir', join(root, '.pnpm-store'), ...args],
    {
      cwd: source,
      encoding: 'utf8',
      env: { ...process.env, ...environment },
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const log = `command-${report.commands.length + 1}.log`;
  writeFileSync(
    join(output, log),
    (result.stdout ?? '') + (result.stderr ?? ''),
  );
  report.commands.push({
    command: `pnpm ${args.join(' ')}`,
    exitCode: result.status,
    log,
  });
  console.log(`pnpm ${args.join(' ')}: ${result.status}`);
  assert.equal(
    result.status,
    0,
    `Command failed; inspect ${join(output, log)}\n${result.error ?? ''}\n${result.stderr ?? ''}`,
  );
}
try {
  assert.ok(!existsSync(join(source, 'node_modules')));
  assert.ok(!existsSync(join(source, 'dist')));
  run(['install', '--frozen-lockfile', '--offline']);
  assert.equal(
    hash(readFileSync(join(source, 'pnpm-lock.yaml'))),
    sourceSha256['pnpm-lock.yaml'],
  );
  run(['typecheck']);
  run(['lint']);
  run(['format:check']);
  run([
    'test:coverage',
    '--reporter=json',
    `--outputFile=${join(output, 'unit.json')}`,
  ]);
  run(['build']);
  const dist = join(source, 'dist');
  const manifest = JSON.parse(
    readFileSync(join(dist, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.version, version);
  assert.equal(version, '1.0.0');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '120');
  assert.deepEqual(manifest.permissions, ['downloads', 'storage']);
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self'; object-src 'none'",
  );
  for (const key of [
    'host_permissions',
    'optional_permissions',
    'content_scripts',
    'externally_connectable',
    'web_accessible_resources',
  ])
    assert.equal(manifest[key], undefined);
  for (const entry of [
    manifest.background.service_worker,
    manifest.options_page,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
  ])
    assert.ok(existsSync(join(dist, entry)), entry);
  assert.equal(
    readFileSync(join(dist, 'RE2JS-LICENSE.txt'), 'utf8'),
    readFileSync(join(source, 'node_modules/re2js/LICENSE'), 'utf8'),
  );
  const dependency = JSON.parse(
    readFileSync(join(source, 'node_modules/re2js/package.json'), 'utf8'),
  );
  assert.equal(dependency.version, '2.8.6');
  assert.equal(dependency.license, 'MIT');
  report.distSha256 = hashes(dist);
  const allowed =
    /^(?:manifest\.json|(?:background|options|popup|regex)\.js|RE2JS-LICENSE\.txt|(?:options|popup)\/index\.html|icons\/(?:16|48|128)\.png|assets\/[\w.-]+\.(?:js|css))$/u;
  for (const file of Object.keys(report.distSha256)) {
    assert.match(file, allowed, 'Only production resources may ship.');
    if (/\.(?:js|html|json)$/u.test(file))
      assert.doesNotMatch(
        readFileSync(join(dist, file), 'utf8'),
        /sk-[A-Za-z0-9]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|PHASE[3-7]_PRIVATE|__phase[0-9]/u,
      );
  }
  // Keep the established Windows full-path test boundary outside the nested source snapshot.
  const browserArtifacts = join(root, '.test-artifacts', `r7-${Date.now()}`);
  run(['test:e2e'], { DOWNLOAD_ROUTER_E2E_ARTIFACTS: browserArtifacts });
  const browserReport = join(browserArtifacts, 'e2e-report.json');
  assert.ok(existsSync(browserReport));
  report.browser = JSON.parse(readFileSync(browserReport, 'utf8'));
  assert.equal(report.browser.status, 'pass');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(report.browser.distSha256).map(([name, value]) => [
        name.replaceAll('\\', '/'),
        value,
      ]),
    ),
    report.distSha256,
  );
  report.results.push({
    id: 'TEST-DR-P7-01',
    status: 'pass',
    cleanSnapshotInstallAndBuild: true,
    frozenLockfileUnchanged: true,
    productionBrowserLoaded: true,
  });
  report.results.push({
    id: 'TEST-DR-P7-04',
    status: 'pass',
    manifestEntriesCspPermissions: true,
    dependency: {
      name: 're2js',
      version: dependency.version,
      license: dependency.license,
    },
    licenseExact: true,
    productionFilesOnly: true,
    executableAudit:
      'Phase 5 static AST and runtime network observations rerun in browser suite.',
  });
  const unit = JSON.parse(readFileSync(join(output, 'unit.json'), 'utf8'));
  const coverage = JSON.parse(
    readFileSync(join(source, 'coverage/coverage-summary.json'), 'utf8'),
  );
  assert.equal(unit.success, true);
  assert.equal(unit.numFailedTests, 0);
  assert.ok(coverage.total.lines.pct >= 90);
  report.unit = {
    tests: unit.numTotalTests,
    passed: unit.numPassedTests,
    files: unit.testResults.length,
  };
  report.coverage = coverage;
  report.results.push({
    id: 'TEST-DR-P7-05',
    status: 'pass',
    checklist:
      'docs/planning/PLAN.md section 28; docs/TESTING.md and test ledger',
    extensionConflictBoundary:
      'TEST-DR-P5-06 uses a controlled local extension fixture; no third-party compatibility guarantee.',
  });
  const observed = new Set(
    JSON.stringify([
      unit.testResults.map((result) =>
        result.assertionResults.map((test) => test.fullName),
      ),
      report.browser.results,
      report.results,
    ]).match(/TEST-DR-P[0-7]-\d{2}/gu),
  );
  report.testLedger = {
    covered: [],
    unverified: [],
    missing: [],
  };
  for (const [phase, count] of [7, 8, 7, 7, 5, 6, 7, 5].entries()) {
    for (let number = 1; number <= count; number++) {
      const id = `TEST-DR-P${phase}-${String(number).padStart(2, '0')}`;
      report.testLedger[observed.has(id) ? 'covered' : 'missing'].push(id);
    }
  }
  assert.deepEqual(report.testLedger.missing, []);
  report.packagePath = join(output, `download-router-${version}.zip`);
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "[void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')\n[IO.Compression.ZipFile]::CreateFromDirectory($env:DOWNLOAD_ROUTER_PACKAGE_DIR, $env:DOWNLOAD_ROUTER_PACKAGE_ZIP)",
    ],
    {
      env: {
        ...process.env,
        DOWNLOAD_ROUTER_PACKAGE_DIR: dist,
        DOWNLOAD_ROUTER_PACKAGE_ZIP: report.packagePath,
      },
      windowsHide: true,
    },
  );
  report.packageSha256 = hash(readFileSync(report.packagePath));
  const extracted = join(output, 'zip-verification');
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "[void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')\n[IO.Compression.ZipFile]::ExtractToDirectory($env:DOWNLOAD_ROUTER_PACKAGE_ZIP, $env:DOWNLOAD_ROUTER_PACKAGE_CHECK)",
    ],
    {
      env: {
        ...process.env,
        DOWNLOAD_ROUTER_PACKAGE_ZIP: report.packagePath,
        DOWNLOAD_ROUTER_PACKAGE_CHECK: extracted,
      },
      windowsHide: true,
    },
  );
  assert.deepEqual(hashes(extracted), report.distSha256);
  report.zipContentsVerified = true;
  // A second build from the same isolated source must reproduce every production file.
  run(['build']);
  assert.deepEqual(hashes(dist), report.distSha256);
  report.reproducibleBuild = true;
  report.status = 'pass';
  const fileProof = (file) => ({
    downloadId: file.downloadId,
    relativePath: (
      file.relativePath ?? file.filename.split(/[/\\]Downloads[/\\]/u).at(-1)
    ).replaceAll('\\', '/'),
    state: file.state,
    sha256: file.sha256,
  });
  const workflow = report.browser.results.find(
    (result) => result.id === 'TEST-DR-P7-02',
  );
  const upgrade = report.browser.results.find(
    (result) => result.id === 'TEST-DR-P7-03' && result.previousVersion,
  );
  const conflict = report.browser.results.find(
    (result) => result.id === 'TEST-DR-P5-06',
  );
  const verification = {
    version,
    status: 'pass',
    verifiedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      node: process.version,
      browser: report.browser.browser,
      headless: true,
    },
    revision: {
      baseCommit: report.baseCommit,
      sourceDigest: report.sourceDigest,
      sourceSha256: report.sourceSha256,
    },
    commands: report.commands.map(({ command, exitCode }) => ({
      command: command.replaceAll(output, '<artifacts>'),
      exitCode,
    })),
    unit: report.unit,
    coverage: {
      scope: 'src/core/**/*.ts',
      modules: Object.keys(coverage).length - 1,
      ...coverage.total,
    },
    testLedger: report.testLedger,
    distSha256: report.distSha256,
    package: {
      file: `download-router-${version}.zip`,
      sha256: report.packageSha256,
      zipContentsVerified: true,
      reproducibleBuild: true,
    },
    browser: {
      pageErrors: report.browser.pageErrors,
      workerErrors: report.browser.workerErrors,
      workflow: Object.fromEntries(
        ['first', 'backup', 'cold', 'disabled', 'restored'].map((key) => [
          key,
          fileProof(workflow[key]),
        ]),
      ),
      reload:
        report.browser.results.find(
          (result) => result.id === 'TEST-DR-P7-03' && result.runtimeReload,
        )?.exactConfigPreserved === true,
      upgrade: upgrade
        ? {
            from: upgrade.previousVersion,
            to: upgrade.currentVersion,
            exactConfigPreserved: upgrade.exactConfigPreserved,
            backupSha256: upgrade.backupSha256,
            file: fileProof(upgrade.file),
          }
        : { tested: false },
      competingExtensions: {
        fixtureOnly: true,
        files: conflict.files.map((file) => ({
          requestedLoadOrder: file.requestedLoadOrder,
          bothSuggested: file.bothSuggested,
          ...fileProof({ ...file, filename: file.actualFilename }),
        })),
      },
    },
    limitations: [
      'Windows/Chromium 149 only; Chrome 120 binary untested',
      'Natural idle and screen reader untested',
      'Third-party compatibility represented by controlled fixture only',
      'Native Save As evidence is historical; see native-dialogs-2026-10-15.json',
    ],
  };
  assert.doesNotMatch(
    JSON.stringify(verification),
    /[a-z]:\\|[a-z]:\/|\/Users\/|\/home\//iu,
  );
  writeFileSync(
    join(output, 'verification.json'),
    JSON.stringify(verification, null, 2) + '\n',
  );
} catch (error) {
  report.status = 'fail';
  report.error = error.stack;
  throw error;
} finally {
  writeFileSync(
    join(output, 'release-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `Release ${report.status}: ${join(output, 'release-report.json')}`,
  );
}
