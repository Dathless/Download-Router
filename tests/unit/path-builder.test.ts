import { describe, expect, it } from 'vitest';
import { buildPath, getBasename } from '../../src/core/path-builder';

describe('TEST-DR-P0-06 basename and complete relative paths', () => {
  it.each([
    'C:\\Downloads\\Báo cáo.pdf',
    '/home/test/Downloads/Báo cáo.pdf',
    'Báo cáo.pdf',
  ])('keeps only the basename: %s', (path) => {
    expect(buildPath('DownloadRouterTest\\Local', getBasename(path))).toBe(
      'DownloadRouterTest/Local/Báo cáo.pdf',
    );
  });

  it.each([
    '',
    '.',
    '..',
    'CON',
    'con.txt',
    'LPT1.pdf',
    'COM¹.txt',
    'name.',
    'name ',
    'bad:name',
    'bad\u0000name',
    'folder/name',
    'folder\\name',
  ])('rejects an invalid basename: %j', (name) => {
    expect(buildPath('DownloadRouterTest/Local', name)).toBeNull();
  });

  it.each([
    '',
    '../outside',
    'a/../outside',
    'a\\..\\outside',
    '/root',
    '\\root',
    '\\\\host\\share',
    'C:\\data',
    'C:relative',
    '~/data',
    'a//b',
    'a/./b',
    'a/NUL',
    'a/bad\u0001',
  ])('rejects an unsafe destination: %j', (destination) => {
    expect(buildPath(destination, 'sample.txt')).toBeNull();
  });

  it('does not decode filename characters or invent a name for a trailing separator', () => {
    expect(buildPath('Local', 'literal%2Fname.pdf')).toBe(
      'Local/literal%2Fname.pdf',
    );
    expect(buildPath('Local', getBasename('C:\\Downloads\\'))).toBeNull();
  });
});
