import type {
  DownloadInput,
  DownloadRule,
  ExtensionConfig,
} from '../models/config';
import { getHostname } from './url-normalizer';

// shortcut: Phase 0 routes domain rules without filters; extend this engine in Phase 1.
export function matchRule(
  input: DownloadInput,
  config: ExtensionConfig,
): DownloadRule | undefined {
  const hosts = [getHostname(input.url)];
  if (config.settings.matchRedirectedUrl && input.finalUrl) {
    hosts.push(getHostname(input.finalUrl));
  }
  let winner: DownloadRule | undefined;
  for (const rule of config.rules) {
    if (
      rule.enabled &&
      rule.match.type === 'domain' &&
      !rule.match.extensions?.length &&
      !rule.match.mimeTypes?.length &&
      hosts.includes(rule.match.pattern.toLowerCase()) &&
      (!winner || rule.priority > winner.priority)
    ) {
      winner = rule;
    }
  }
  return winner;
}
