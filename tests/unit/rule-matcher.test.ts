import { describe, expect, it } from 'vitest';
import { compileMatcher } from '../../src/core/rule-matcher';
import type { MatchType } from '../../src/models/config';

function matches(type: MatchType, pattern: string, url: string) {
  return compileMatcher(type, pattern)(new URL(url));
}

describe('TEST-DR-P1-01 exact domain', () => {
  it.each([
    ['github.com', 'https://github.com/a', true],
    ['GITHUB.COM', 'https://GITHUB.COM/a', true],
    ['github.com', 'https://notgithub.com/a', false],
    ['github.com', 'https://api.github.com/a', false],
    ['github.com', 'https://other.test/github.com/a', false],
    ['github.com', 'https://github.com:8173/a', true],
  ])('%s with %s -> %s', (pattern, url, expected) =>
    expect(matches('domain', pattern, url)).toBe(expected),
  );
});

describe('TEST-DR-P1-02 prefix semantics', () => {
  it.each([
    [
      'https://EXAMPLE.com/releases/',
      'https://example.com/releases/a.zip',
      true,
    ],
    [
      'https://example.com/releases/',
      'https://example.com/assets/a.zip',
      false,
    ],
    ['https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2', false],
    ['https://example.com/a#old', 'https://example.com/a#new', true],
    ['https://example.com/a%2Fb', 'https://example.com/a/b', false],
    ['https://example.com/a%2Fb', 'https://example.com/a%2Fb/c', true],
  ])('%s with %s -> %s', (pattern, url, expected) =>
    expect(matches('prefix', pattern, url)).toBe(expected),
  );
  it.each(['example.com/path', 'ftp://example.com/a', 'http://[bad]'])(
    'rejects prefix %s',
    (pattern) => expect(() => compileMatcher('prefix', pattern)).toThrow(),
  );
});

describe('TEST-DR-P1-03 structured glob', () => {
  it.each([
    [
      'https://*.example.com/files/*.pdf',
      'https://cdn.example.com/files/report.pdf',
      true,
    ],
    [
      'https://*.example.com/files/*.pdf',
      'https://deep.cdn.example.com/files/a/b.pdf',
      true,
    ],
    [
      'https://*.example.com/files/*.pdf',
      'https://example.com/files/report.pdf',
      false,
    ],
    [
      'https://*.example.com/files/*.pdf',
      'https://evil.test/cdn.example.com/files/report.pdf',
      false,
    ],
    [
      'https://*.example.com/files/*.pdf',
      'https://cdn.example.com.evil.test/files/a.pdf',
      false,
    ],
    [
      'https://*.example.com/files/*.pdf',
      'http://cdn.example.com/files/a.pdf',
      false,
    ],
    [
      'https://*.example.com/files/*.pdf',
      'https://CDN.EXAMPLE.COM/files/a.pdf?x=1#h',
      true,
    ],
    ['https://example.com/files/*.pdf', 'https://example.com/files/.pdf', true],
    [
      'https://example.com/files/*.pdf',
      'https://example.com/files/a.PDF',
      false,
    ],
    [
      'https://example.com/files/*.pdf',
      'https://example.com/assets/a.pdf',
      false,
    ],
    ['https://example.com/a*b*c', 'https://example.com/acc', false],
    [
      'https://example.com/a+b/[x].pdf',
      'https://example.com/a+b/[x].pdf',
      true,
    ],
    [
      'https://example.com/a+b/[x].pdf',
      'https://example.com/aaab/xXpdf',
      false,
    ],
    [
      'https://example.com:8173/a*b*c',
      'https://example.com:8173/a---b---c',
      true,
    ],
    ['https://example.com/a*b*c', 'https://example.com/acb', false],
    ['https://example.com/a*b*c', 'https://example.com/abcx', false],
    ['https://example.com/a*a', 'https://example.com/a', false],
    ['https://example.com/a**b', 'https://example.com/ab', true],
    ['https://example.com/a%2Fb/*', 'https://example.com/a/b/c', false],
  ])('%s with %s -> %s', (pattern, url, expected) =>
    expect(matches('glob', pattern, url)).toBe(expected),
  );
  it.each([
    '*://example.com/a',
    'https://example.com',
    'https:///files/*',
    'https://user@example.com/*',
    'https://example.com:*/a',
    'https://example.com/a?x=*',
    'https://example.com/a#x',
    'https://example.com\\files\\*',
  ])('rejects unsupported/ambiguous grammar: %s', (pattern) =>
    expect(() => compileMatcher('glob', pattern)).toThrow(),
  );
});

describe('TEST-DR-P1-04 matcher pattern boundary', () => {
  it.each(['', null, 12])('rejects an invalid pattern value: %j', (pattern) => {
    expect(() => compileMatcher('regex', pattern as string)).toThrow();
  });
});
