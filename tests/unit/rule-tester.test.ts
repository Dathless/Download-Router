import { describe, expect, it, vi } from 'vitest';
import { testRule } from '../../src/core/rule-tester';
import { matchRule } from '../../src/core/rule-engine';
import { buildPath } from '../../src/core/path-builder';
import { createDownloadHandler } from '../../src/background/download-handler';
import { rule, input, configWithRules } from '../fixtures/rules';
import type {
  DownloadInput,
  DownloadRule,
  MatchType,
} from '../../src/models/config';

describe('TEST-DR-P3-03 selected rule parity with production background', () => {
  it.each([
    ['domain', 'example.com'],
    ['prefix', 'https://example.com/download/'],
    ['glob', 'https://*.com/download/*'],
    ['regex', '^https://example[.]com/download/123$'],
  ] as [MatchType, string][])(
    '%s uses the same basename/MIME pipeline and relative target',
    async (type, pattern) => {
      const selected: DownloadRule = {
        ...rule,
        match: {
          type,
          pattern,
          extensions: ['.PDF'],
          mimeTypes: ['APPLICATION/PDF'],
        },
      };
      const config = configWithRules([selected]);
      const engine = matchRule(input, config);
      const tested = testRule(selected, input, config.settings);
      expect(engine.matched).toBe(true);
      if (!engine.matched) throw new Error('Expected match');
      expect(tested).toEqual({
        status: 'match',
        matchedUrl: engine.matchedUrl,
        filename: buildPath(selected.destination, input.filename),
        conflictAction: engine.conflictAction,
      });
      const suggest = vi.fn();
      createDownloadHandler(() => Promise.resolve(config))(
        {
          ...input,
          finalUrl: '',
          filename: `C:\\Downloads\\${input.filename}`,
        },
        suggest,
      );
      await vi.waitFor(() =>
        expect(suggest).toHaveBeenCalledExactlyOnceWith({
          filename: `${selected.destination}/${input.filename}`,
          conflictAction: 'uniquify',
        }),
      );
    },
  );
  it('shares redirected candidate choice and compound extension filtering', () => {
    const selected: DownloadRule = {
      ...rule,
      match: { type: 'domain', pattern: 'cdn.test', extensions: ['tar.gz'] },
      conflictAction: 'prompt',
    };
    const config = configWithRules([selected]);
    const download = {
      ...input,
      url: 'broken',
      finalUrl: 'https://cdn.test/a#hash',
      filename: 'archive.TAR.GZ',
      mime: '',
    };
    expect(testRule(selected, download, config.settings)).toEqual({
      status: 'match',
      matchedUrl: 'https://cdn.test/a',
      filename: `${rule.destination}/archive.TAR.GZ`,
      conflictAction: 'prompt',
    });
    config.settings.matchRedirectedUrl = false;
    expect(testRule(selected, download, config.settings)).toMatchObject({
      status: 'no-match',
      reason: 'invalid-url',
    });
  });
  it.each([
    [{ ...rule, enabled: false }, input, 'disabled'],
    [rule, { ...input, filename: '../report.pdf' }, 'invalid-input'],
    [rule, { ...input, url: 'ftp://example.com/a' }, 'invalid-url'],
    [rule, { ...input, url: 'https://other.test/a' }, 'url-pattern'],
    [
      { ...rule, match: { ...rule.match, extensions: ['zip'] } },
      input,
      'extension-filter',
    ],
    [
      { ...rule, match: { ...rule.match, mimeTypes: ['text/plain'] } },
      input,
      'mime-filter',
    ],
  ] as [DownloadRule, DownloadInput, string][])(
    'explains failure with the engine reason: %s',
    (selected, download, reason) => {
      const config = configWithRules([selected]);
      expect(testRule(selected, download, config.settings)).toEqual({
        status: 'no-match',
        reason,
      });
      expect(matchRule(download, config)).toMatchObject({
        matched: false,
        reason,
      });
    },
  );
  it('honors global disabled state and rejects invalid rules', () => {
    const settings = { ...configWithRules([]).settings, enabled: false };
    expect(testRule(rule, input, settings)).toMatchObject({
      status: 'no-match',
      reason: 'disabled',
    });
    expect(
      testRule({ ...rule, destination: '../escape' }, input, settings),
    ).toEqual({ status: 'invalid', reason: 'invalid-rule' });
  });
  it('reports a regex candidate over the normalized limit and continues with final URL', () => {
    const selected: DownloadRule = {
      ...rule,
      match: { type: 'regex', pattern: '^https://' },
    };
    const settings = configWithRules([]).settings;
    const download = {
      ...input,
      url: 'https://example.com/' + 'a'.repeat(8192),
    };
    expect(testRule(selected, download, settings)).toMatchObject({
      status: 'no-match',
      reason: 'regex-input-too-long',
      regexInputTooLong: true,
    });
    expect(
      testRule(selected, { ...download, finalUrl: input.url }, settings),
    ).toMatchObject({
      status: 'match',
      matchedUrl: input.url,
      regexInputTooLong: true,
    });
  });
});

describe('TEST-DR-P3-04 missing test metadata is incomplete, never inferred', () => {
  it('requires Chrome basename and active MIME-filter input for /download/123', () => {
    const selected = {
      ...rule,
      match: {
        ...rule.match,
        extensions: ['pdf'],
        mimeTypes: ['application/pdf'],
      },
    };
    const settings = configWithRules([]).settings;
    expect(
      testRule(selected, { ...input, filename: '', mime: '' }, settings),
    ).toEqual({ status: 'incomplete', missing: ['filename', 'mime'] });
    expect(testRule(selected, { ...input, mime: '' }, settings)).toEqual({
      status: 'incomplete',
      missing: ['mime'],
    });
    expect(testRule(selected, input, settings).status).toBe('match');
    expect(testRule(rule, { ...input, mime: '' }, settings).status).toBe(
      'match',
    );
  });
});
