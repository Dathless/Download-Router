import type {
  ConflictAction,
  DownloadInput,
  DownloadRule,
  ExtensionSettings,
  MatchFailureReason,
} from '../models/config';
import { prepareRule } from './config-validator';
import { buildPath } from './path-builder';
import { matchRule } from './rule-engine';

export type RuleTestResult =
  | { status: 'incomplete'; missing: ('filename' | 'mime')[] }
  | { status: 'invalid'; reason: 'invalid-rule' | 'invalid-path' }
  | { status: 'no-match'; reason: MatchFailureReason; regexInputTooLong?: true }
  | {
      status: 'match';
      matchedUrl: string;
      filename: string;
      conflictAction: ConflictAction;
      regexInputTooLong?: true;
    };

export function testRule(
  rule: DownloadRule,
  input: DownloadInput,
  settings: ExtensionSettings,
): RuleTestResult {
  if (!prepareRule(rule)) return { status: 'invalid', reason: 'invalid-rule' };
  const missing: ('filename' | 'mime')[] = [];
  if (!input.filename) missing.push('filename');
  if (rule.match.mimeTypes?.length && !input.mime) missing.push('mime');
  if (missing.length) return { status: 'incomplete', missing };
  const result = matchRule(input, {
    configVersion: 1,
    settings,
    rules: [rule],
  });
  if (!result.matched)
    return {
      status: 'no-match',
      reason: result.reason,
      ...(result.regexInputTooLong ? { regexInputTooLong: true } : {}),
    };
  const filename = buildPath(rule.destination, input.filename);
  if (!filename) return { status: 'invalid', reason: 'invalid-path' };
  return {
    status: 'match',
    matchedUrl: result.matchedUrl,
    filename,
    conflictAction: result.conflictAction,
    ...(result.regexInputTooLong ? { regexInputTooLong: true } : {}),
  };
}
