import { describe, expect, it } from 'vitest';
import { matchRule } from '../../src/core/rule-engine';
import type { DownloadInput, DownloadRule } from '../../src/models/config';
import { MAX_REGEX_INPUT_LENGTH } from '../../src/utils/regex';
import { rule, input, configWithRules, invalidRules } from '../fixtures/rules';

describe('TEST-DR-P1-05 basename and MIME filters', () => {
  it.each([
    ['report.PDF', 'application/pdf', ['.pdf'], ['APPLICATION/PDF'], true],
    ['archive.TAR.GZ', 'application/gzip', ['zip', '..tar.gz'], [], true],
    ['archive.notar.gz', '', ['tar.gz'], [], false],
    ['report.pdf.exe', 'application/pdf', ['pdf'], [], false],
    ['report.pdf', '', ['pdf'], ['application/pdf'], false],
    ['report.pdf', 'text/plain', ['pdf'], ['application/pdf'], false],
    [
      'report.pdf',
      'text/plain',
      ['zip', 'PDF'],
      ['application/pdf', 'TEXT/PLAIN'],
      true,
    ],
    [
      'report.pdf',
      'application/pdf; charset=utf-8',
      [],
      ['application/pdf'],
      false,
    ],
    ['README', '', [], [], true],
    ['.pdf', '', ['pdf'], [], true],
  ] as const)(
    '%s / %s respects OR lists and AND groups',
    (filename, mime, extensions, mimeTypes, expected) => {
      const filtered = {
        ...rule,
        match: {
          ...rule.match,
          extensions: [...extensions],
          mimeTypes: [...mimeTypes],
        },
      };
      expect(
        matchRule({ ...input, filename, mime }, configWithRules([filtered]))
          .matched,
      ).toBe(expected);
    },
  );
  it('uses Chrome basename even when URL has no file name or suggests another extension', () => {
    const config = configWithRules([
      { ...rule, match: { ...rule.match, extensions: ['pdf'] } },
    ]);
    expect(matchRule(input, config).matched).toBe(true);
    expect(
      matchRule(
        {
          ...input,
          url: 'https://example.com/file.pdf',
          filename: 'actual.zip',
        },
        config,
      ).matched,
    ).toBe(false);
  });
  it('does not guess missing MIME and still permits rules without a MIME filter', () => {
    const missingMime = {
      ...input,
      mime: undefined,
    } as unknown as DownloadInput;
    expect(
      matchRule(
        missingMime,
        configWithRules([
          { ...rule, match: { ...rule.match, mimeTypes: ['application/pdf'] } },
        ]),
      ).matched,
    ).toBe(false);
    expect(matchRule(missingMime, configWithRules([rule])).matched).toBe(true);
  });
});

describe('TEST-DR-P1-06 rule priority and URL candidates', () => {
  const finalRule: DownloadRule = {
    ...rule,
    id: 'final',
    match: { type: 'domain', pattern: 'cdn.test' },
  };
  const redirected = { ...input, finalUrl: 'https://cdn.test/file#fragment' };
  it('picks higher priority final URL instead of returning the original match early', () => {
    const result = matchRule(
      redirected,
      configWithRules([rule, { ...finalRule, priority: 10 }]),
    );
    expect(result).toMatchObject({
      matched: true,
      rule: { id: 'final' },
      matchedUrl: 'https://cdn.test/file',
    });
  });
  it('keeps array order for equal priorities even when earlier rule only matches final URL', () => {
    expect(
      matchRule(redirected, configWithRules([finalRule, rule])),
    ).toMatchObject({ matched: true, rule: { id: 'final' } });
    expect(
      matchRule(redirected, configWithRules([rule, finalRule])),
    ).toMatchObject({ matched: true, rule: { id: rule.id } });
  });
  it('uses original candidate when the same rule matches both', () => {
    const broad: DownloadRule = {
      ...rule,
      match: { type: 'regex', pattern: '^https://' },
    };
    expect(matchRule(redirected, configWithRules([broad]))).toMatchObject({
      matchedUrl: input.url,
    });
  });
  it.each(['not a URL', 'ftp://example.com/a'])(
    'retains valid final URL when original is invalid: %s',
    (url) => {
      expect(
        matchRule({ ...redirected, url }, configWithRules([finalRule])),
      ).toMatchObject({ matched: true, rule: { id: 'final' } });
    },
  );
  it('ignores invalid final URL, disabled rules/global setting and respects redirect opt-out', () => {
    const config = configWithRules([rule]);
    expect(matchRule({ ...input, finalUrl: 'bad' }, config).matched).toBe(true);
    config.settings.matchRedirectedUrl = false;
    config.rules = [finalRule];
    expect(matchRule(redirected, config).matched).toBe(false);
    config.rules = [{ ...rule, enabled: false }];
    expect(matchRule(input, config).matched).toBe(false);
    config.rules = [rule];
    config.settings.enabled = false;
    expect(matchRule(input, config).matched).toBe(false);
  });
  it('isolates invalid individual rules without changing the config', () => {
    const config = configWithRules([...(invalidRules as DownloadRule[]), rule]);
    const before = structuredClone(config);
    expect(matchRule(input, config)).toMatchObject({
      matched: true,
      rule: { id: rule.id },
    });
    expect(config).toEqual(before);
  });
  it('returns no match for invalid basename instead of routing a URL-derived name', () => {
    expect(
      matchRule(
        { ...input, filename: '../report.pdf' },
        configWithRules([rule]),
      ).matched,
    ).toBe(false);
  });
});

describe('TEST-DR-P1-04 bounded regex in the shared pipeline', () => {
  const regexRule: DownloadRule = {
    ...rule,
    match: { type: 'regex', pattern: '^https://example[.]com/' },
  };
  const prefix = 'https://example.com/';
  function urlOfLength(size: number) {
    return prefix + 'a'.repeat(size - prefix.length);
  }
  it('accepts normalized URL at 8192, skips 8193 and reports why', () => {
    const config = configWithRules([regexRule]);
    expect(
      matchRule({ ...input, url: urlOfLength(MAX_REGEX_INPUT_LENGTH) }, config)
        .matched,
    ).toBe(true);
    expect(
      matchRule(
        { ...input, url: urlOfLength(MAX_REGEX_INPUT_LENGTH + 1) },
        config,
      ),
    ).toMatchObject({ matched: false, regexInputTooLong: true });
    expect(
      matchRule(
        { ...input, url: urlOfLength(MAX_REGEX_INPUT_LENGTH) + '#ignored' },
        config,
      ).matched,
    ).toBe(true);
  });
  it('continues with final candidate and other rule types when one regex candidate is oversized', () => {
    const download: DownloadInput = {
      ...input,
      url: urlOfLength(8193),
      finalUrl: 'https://example.com/final',
    };
    expect(matchRule(download, configWithRules([regexRule]))).toMatchObject({
      matched: true,
      matchedUrl: download.finalUrl,
      regexInputTooLong: true,
    });
    expect(
      matchRule(
        { ...download, finalUrl: undefined },
        configWithRules([regexRule, rule]),
      ),
    ).toMatchObject({
      matched: true,
      rule: { id: rule.id },
      regexInputTooLong: true,
    });
  });
  it('applies the URL length limit after percent encoding by the normalizer', () => {
    const url = 'https://example.com/' + 'é'.repeat(1500);
    expect(url.length).toBeLessThan(8192);
    expect(
      matchRule({ ...input, url }, configWithRules([regexRule])),
    ).toMatchObject({ matched: false, regexInputTooLong: true });
  });
  it('matches against normalized URL and executes adversarial expressions in RE2JS', () => {
    const query: DownloadRule = {
      ...rule,
      match: { type: 'regex', pattern: '^https://example[.]com/a\\?b=2&a=1$' },
    };
    expect(
      matchRule(
        { ...input, url: 'HTTPS://EXAMPLE.COM/a?b=2&a=1#hash' },
        configWithRules([query]),
      ).matched,
    ).toBe(true);
    const nested: DownloadRule = {
      ...rule,
      match: { type: 'regex', pattern: '^https://example[.]com/(a+)+$' },
    };
    expect(
      matchRule(
        { ...input, url: urlOfLength(8191) + '!' },
        configWithRules([nested]),
      ).matched,
    ).toBe(false);
  }, 2000);
});

describe('TEST-DR-P1-08 conflict action inheritance', () => {
  it('inherits settings and lets an explicit rule override them', () => {
    const config = configWithRules([rule]);
    config.settings.defaultConflictAction = 'prompt';
    expect(matchRule(input, config)).toMatchObject({
      matched: true,
      conflictAction: 'prompt',
    });
    config.rules = [{ ...rule, conflictAction: 'overwrite' }];
    expect(matchRule(input, config)).toMatchObject({
      matched: true,
      conflictAction: 'overwrite',
    });
  });
});
