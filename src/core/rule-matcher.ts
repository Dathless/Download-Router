import type { MatchType } from '../models/config';
import { compileRegex, matchesRegex } from '../utils/regex';
import { normalizeUrl } from './url-normalizer';

function matchesGlob(pattern: string, text: string): boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === text;
  const first = parts[0]!;
  if (!text.startsWith(first)) return false;
  let position = first.length;
  for (const part of parts.slice(1, -1)) {
    const found = text.indexOf(part, position);
    if (found < 0) return false;
    position = found + part.length;
  }
  const last = parts.at(-1)!;
  return text.endsWith(last) && position <= text.length - last.length;
}

// Candidates come from normalizeUrl; glob '*' never crosses the authority/path boundary.
export function compileMatcher(
  type: MatchType,
  pattern: string,
): (url: URL) => boolean {
  if (typeof pattern !== 'string' || !pattern.length)
    throw new Error('Invalid match pattern.');
  switch (type) {
    case 'domain': {
      const host = normalizeUrl(`https://${pattern}/`)?.hostname;
      if (!host || host !== pattern.toLowerCase() || host.includes('*'))
        throw new Error('Expected an exact hostname.');
      return (url) => url.hostname === host;
    }
    case 'prefix': {
      const prefix = normalizeUrl(pattern);
      if (!/^https?:\/\//iu.test(pattern) || !prefix)
        throw new Error('Expected an HTTP(S) URL prefix.');
      return (url) => url.href.startsWith(prefix.href);
    }
    case 'glob': {
      const glob = normalizeUrl(pattern);
      if (
        !/^https?:\/\/[^/]+\//iu.test(pattern) ||
        /[\\?#]/u.test(pattern) ||
        !glob ||
        glob.username ||
        glob.password
      )
        throw new Error('Unsupported URL glob syntax.');
      return (url) =>
        url.protocol === glob.protocol &&
        url.port === glob.port &&
        matchesGlob(glob.hostname, url.hostname) &&
        matchesGlob(glob.pathname, url.pathname);
    }
    case 'regex': {
      const compiled = compileRegex(pattern);
      return (url) => matchesRegex(compiled, url.href);
    }
    default:
      throw new Error('Unsupported matcher type.');
  }
}
