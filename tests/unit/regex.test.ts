import { describe, expect, it } from 'vitest';
import { compileRegex, matchesRegex } from '../../src/utils/regex';

describe('TEST-DR-P0-07 RE2JS feasibility', () => {
  it('matches substrings and anchored patterns without native user-pattern evaluation', () => {
    expect(
      matchesRegex(compileRegex('example[.]test'), 'https://example.test/file'),
    ).toBe(true);
    expect(
      matchesRegex(
        compileRegex('^https://example[.]test/.*[.]pdf$'),
        'https://example.test/report.pdf',
      ),
    ).toBe(true);
    expect(
      matchesRegex(
        compileRegex('^https://example[.]test/.*[.]pdf$'),
        'https://example.test/report.zip',
      ),
    ).toBe(false);
  });

  it.each([
    '',
    '[',
    '(?=a)',
    '(?!a)',
    '(?<=a)',
    '(?<!a)',
    '(a)\\1',
    'a'.repeat(257),
  ])('rejects invalid or unsupported syntax: %j', (pattern) => {
    expect(() => compileRegex(pattern)).toThrow();
  });

  it('accepts the pattern/input boundaries and skips only oversized input', () => {
    expect(() => compileRegex('a'.repeat(256))).not.toThrow();
    const pattern = compileRegex('^a+$');
    expect(matchesRegex(pattern, 'a'.repeat(8_192))).toBe(true);
    expect(matchesRegex(pattern, 'a'.repeat(8_193))).toBe(false);
    expect(matchesRegex(pattern, 'aaa')).toBe(true);
  });

  it('completes nested-quantifier nonmatches at increasing input sizes', () => {
    const pattern = compileRegex('^(a+)+$');
    for (const size of [128, 1_024, 8_191]) {
      expect(matchesRegex(pattern, `${'a'.repeat(size)}!`)).toBe(false);
    }
  }, 2_000);
});
