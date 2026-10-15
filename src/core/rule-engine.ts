import type {
  DownloadInput,
  DownloadRule,
  ExtensionConfig,
  MatchResult,
  MatchFailureReason,
} from '../models/config';
import { MAX_REGEX_INPUT_LENGTH } from '../utils/regex';
import { parseDownloadInput, prepareRule } from './config-validator';
import { normalizeUrl } from './url-normalizer';

function filterFailure(
  rule: DownloadRule,
  input: DownloadInput,
): MatchFailureReason | undefined {
  const { extensions, mimeTypes } = rule.match;
  const filename = input.filename.toLowerCase();
  if (
    extensions?.length &&
    !extensions.some((entry) =>
      filename.endsWith(`.${entry.replace(/^\.+/u, '').toLowerCase()}`),
    )
  )
    return 'extension-filter';
  if (
    mimeTypes?.length &&
    !mimeTypes.some((entry) => entry.toLowerCase() === input.mime.toLowerCase())
  )
    return 'mime-filter';
}

export function matchRule(
  input: DownloadInput,
  config: ExtensionConfig,
): MatchResult {
  if (!config.settings.enabled) return { matched: false, reason: 'disabled' };
  try {
    input = parseDownloadInput(input);
  } catch {
    return { matched: false, reason: 'invalid-input' };
  }
  const candidates: URL[] = [];
  const original = normalizeUrl(input.url);
  if (original) candidates.push(original);
  const final =
    config.settings.matchRedirectedUrl && input.finalUrl
      ? normalizeUrl(input.finalUrl)
      : null;
  if (final && final.href !== original?.href) candidates.push(final);
  if (!candidates.length) return { matched: false, reason: 'invalid-url' };
  let winner: DownloadRule | undefined;
  let matchedUrl: string | undefined;
  let regexInputTooLong: true | undefined;
  let reason: MatchFailureReason = 'url-pattern';
  for (const value of config.rules) {
    const prepared = prepareRule(value);
    if (!prepared) {
      reason = 'invalid-rule';
      continue;
    }
    if (!prepared.rule.enabled) {
      reason = 'disabled';
      continue;
    }
    const failedFilter = filterFailure(prepared.rule, input);
    if (failedFilter) {
      reason = failedFilter;
      continue;
    }
    reason = 'url-pattern';
    const { rule, matches } = prepared;
    for (const candidate of candidates) {
      if (
        rule.match.type === 'regex' &&
        candidate.href.length > MAX_REGEX_INPUT_LENGTH
      ) {
        regexInputTooLong = true;
        continue;
      }
      if (matches(candidate)) {
        if (!winner || rule.priority > winner.priority) {
          winner = rule;
          matchedUrl = candidate.href;
        }
        break;
      }
    }
  }
  const diagnostic = regexInputTooLong ? { regexInputTooLong } : {};
  return winner && matchedUrl
    ? {
        matched: true,
        rule: winner,
        matchedUrl,
        conflictAction:
          winner.conflictAction ?? config.settings.defaultConflictAction,
        ...diagnostic,
      }
    : {
        matched: false,
        reason: regexInputTooLong ? 'regex-input-too-long' : reason,
        ...diagnostic,
      };
}
