import { describe, expect, it } from 'vitest';
import {
  isValidDestination,
  isValidSegment,
} from '../../src/core/path-validator';
import { buildPath } from '../../src/core/path-builder';

describe('TEST-DR-P1-07 filesystem components and destinations', () => {
  it('rejects non-string components/destinations at runtime', () => {
    expect(isValidSegment(null as unknown as string)).toBe(false);
    expect(isValidDestination(null as unknown as string)).toBe(false);
  });
  it.each([
    'CON',
    'con.pdf',
    'NUL.tar.gz',
    'COM9',
    'LPT³.log',
    'con .txt',
    'a\u0085b',
    'bad\u007f',
    'bad\n',
    'file:stream',
    '\\\\?\\C:\\a',
    '//host/share',
    'a\\..\\b',
    'a/./b',
    'a//b',
    'a/',
    'a\\',
    '~',
    '../a',
  ])('rejects invalid destination unchanged: %j', (value) => {
    expect(isValidDestination(value)).toBe(false);
    expect(buildPath(value, 'report.pdf')).toBeNull();
  });
  it.each([
    'Báo cáo (2026)',
    '.hidden',
    'a%2Fb',
    'COM0',
    'LPT10',
    'a..b',
    'a'.repeat(255),
  ])('preserves valid Unicode/punctuation: %j', (value) =>
    expect(isValidSegment(value)).toBe(true),
  );
  it('rejects a component longer than the Windows component limit', () => {
    expect(isValidSegment('a'.repeat(256))).toBe(false);
    expect(buildPath('Reports', 'a'.repeat(256))).toBeNull();
  });
  it('normalizes separators while preserving filename and meaningful spaces', () => {
    expect(buildPath('Báo cáo\\Tháng 10', ' kết quả (1).pdf')).toBe(
      'Báo cáo/Tháng 10/ kết quả (1).pdf',
    );
  });
});
