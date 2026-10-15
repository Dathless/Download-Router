import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../../src/core/url-normalizer';

describe('TEST-DR-P1-02 URL normalization', () => {
  it('rejects non-string input at runtime', () => {
    expect(normalizeUrl(null as unknown as string)).toBeNull();
  });
  it('uses URL semantics, preserves query order/encoded separators and removes fragments', () => {
    expect(
      normalizeUrl(
        'HTTPS://EXAMPLE.COM:443/a/../releases/%2Ffile?b=2&a=1#section',
      )?.href,
    ).toBe('https://example.com/releases/%2Ffile?b=2&a=1');
    expect(normalizeUrl('https://example.com/a%2Fb')?.pathname).toBe('/a%2Fb');
    expect(normalizeUrl('http://EXAMPLE.COM:8173/a')?.href).toBe(
      'http://example.com:8173/a',
    );
  });
  it.each([
    'not a URL',
    '',
    'ftp://example.com/a',
    'file:///tmp/a',
    'javascript:alert(1)',
    'http://[bad]',
  ])('rejects malformed/unsupported URLs: %s', (url) =>
    expect(normalizeUrl(url)).toBeNull(),
  );
});
