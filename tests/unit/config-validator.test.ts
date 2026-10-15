import { describe, expect, it } from 'vitest';
import {
  parseConfig,
  parseDownloadInput,
} from '../../src/core/config-validator';
import { rule, input, configWithRules, invalidRules } from '../fixtures/rules';
import type { DownloadRule, MatchType } from '../../src/models/config';

describe('TEST-DR-P1-08 shared runtime configuration validation', () => {
  it.each([
    ['domain', 'EXAMPLE.COM'],
    ['prefix', 'https://example.com/releases/'],
    ['glob', 'https://*.example.com/files/*.pdf'],
    ['regex', '^https://example[.]com/'],
  ] as [MatchType, string][])(
    'accepts canonical %s configuration without mutating input',
    (type, pattern) => {
      const stored = JSON.parse(
        JSON.stringify(
          configWithRules([
            {
              ...rule,
              match: {
                type,
                pattern,
                extensions: ['.PDF'],
                mimeTypes: ['APPLICATION/PDF'],
              },
            },
          ]),
        ),
      );
      const before = structuredClone(stored);
      expect(parseConfig(stored, 'strict')).toEqual(stored);
      expect(stored).toEqual(before);
    },
  );
  it.each(invalidRules.map((value, i) => [i, value] as const))(
    'rejects invalid rule #%s for strict writes, isolates it on runtime load',
    (_, value) => {
      const stored = configWithRules([value as DownloadRule, rule]);
      expect(() => parseConfig(stored, 'strict')).toThrow();
      expect(parseConfig(stored).rules).toEqual([rule]);
      expect(stored.rules).toHaveLength(2);
    },
  );
  it.each([
    null,
    [],
    {},
    { ...configWithRules([]), configVersion: 2 },
    {
      ...configWithRules([]),
      configVersion: undefined,
      settings: { configVersion: 1 },
    },
    { ...configWithRules([]), rules: {} },
    { ...configWithRules([]), settings: null },
    {
      ...configWithRules([]),
      settings: {
        enabled: 'true',
        matchRedirectedUrl: true,
        defaultConflictAction: 'uniquify',
      },
    },
    {
      ...configWithRules([]),
      settings: {
        enabled: true,
        matchRedirectedUrl: 1,
        defaultConflictAction: 'uniquify',
      },
    },
    {
      ...configWithRules([]),
      settings: {
        enabled: true,
        matchRedirectedUrl: true,
        defaultConflictAction: 'bad',
      },
    },
  ])('rejects invalid root/settings/version: %j', (value) =>
    expect(() => parseConfig(value)).toThrow(),
  );
  it('rejects duplicate IDs in strict mode and keeps the first on runtime load', () => {
    const stored = configWithRules([rule, { ...rule, destination: 'Other' }]);
    expect(() => parseConfig(stored, 'strict')).toThrow();
    expect(parseConfig(stored).rules).toEqual([rule]);
    expect(stored.rules).toHaveLength(2);
  });
});

describe('TEST-DR-P1-08 canonical DownloadInput boundary', () => {
  it('accepts basename input, uses empty MIME for missing metadata, and keeps malformed candidates for the normalizer', () => {
    expect(parseDownloadInput(input)).toMatchObject(input);
    expect(
      parseDownloadInput({
        ...input,
        mime: undefined,
        url: 'broken',
        finalUrl: 'https://example.com/a',
      }),
    ).toMatchObject({
      mime: '',
      url: 'broken',
      finalUrl: 'https://example.com/a',
    });
  });
  it.each([
    null,
    {},
    { ...input, url: 1 },
    { ...input, filename: '../a' },
    { ...input, finalUrl: 1 },
    { ...input, mime: false },
  ])('rejects invalid download input: %j', (value) => {
    expect(() => parseDownloadInput(value)).toThrow();
  });
});

describe('TEST-DR-P1-04 same RE2JS validator for writes and runtime loads', () => {
  it.each([
    '[',
    '(?=a)',
    '(?!a)',
    '(?<=a)',
    '(?<!a)',
    '(a)\\1',
    'a'.repeat(257),
  ])(
    'rejects invalid/unsupported regex and keeps other rules usable: %j',
    (pattern) => {
      const stored = configWithRules([
        { ...rule, id: 'bad-regex', match: { type: 'regex', pattern } },
        rule,
      ]);
      expect(() => parseConfig(stored, 'strict')).toThrow();
      expect(parseConfig(stored).rules).toEqual([rule]);
    },
  );
  it('uses UTF-16 units consistently at the 256 limit, including Unicode', () => {
    for (const pattern of ['a'.repeat(256), '😀'.repeat(128)]) {
      expect(
        parseConfig(
          configWithRules([{ ...rule, match: { type: 'regex', pattern } }]),
          'strict',
        ).rules,
      ).toHaveLength(1);
    }
    expect(() =>
      parseConfig(
        configWithRules([
          { ...rule, match: { type: 'regex', pattern: '😀'.repeat(129) } },
        ]),
        'strict',
      ),
    ).toThrow();
  });
});
