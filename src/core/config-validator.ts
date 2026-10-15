import type {
  ConflictAction,
  DownloadInput,
  DownloadRule,
  ExtensionConfig,
} from '../models/config';
import { isValidDestination, isValidSegment } from './path-validator';
import { compileMatcher } from './rule-matcher';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function onlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isConflictAction(value: unknown): value is ConflictAction {
  return value === 'uniquify' || value === 'overwrite' || value === 'prompt';
}

export function isValidExtensionFilter(entry: string): boolean {
  const suffix = entry.replace(/^\.+/u, '');
  return suffix.length > 0 && isValidSegment(`.${suffix}`);
}

export function isValidMimeFilter(entry: string): boolean {
  return /^[a-z0-9!#$%&'+.^_`|~-]+\/[a-z0-9!#$%&'+.^_`|~-]+$/iu.test(entry);
}

function isFilterList(
  value: unknown,
  validEntry: (entry: string) => boolean,
): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every((entry) => typeof entry === 'string' && validEntry(entry)))
  );
}

export function prepareRule(
  value: unknown,
): { rule: DownloadRule; matches: (url: URL) => boolean } | null {
  if (!isRecord(value) || !isRecord(value.match)) return null;
  const { match } = value;
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.enabled !== 'boolean' ||
    typeof match.type !== 'string' ||
    typeof match.pattern !== 'string' ||
    !isFilterList(match.extensions, isValidExtensionFilter) ||
    !isFilterList(match.mimeTypes, isValidMimeFilter) ||
    typeof value.destination !== 'string' ||
    !isValidDestination(value.destination) ||
    typeof value.priority !== 'number' ||
    !Number.isSafeInteger(value.priority) ||
    (value.conflictAction !== undefined &&
      !isConflictAction(value.conflictAction)) ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0
  )
    return null;
  const rule = value as unknown as DownloadRule;
  try {
    return {
      rule,
      matches: compileMatcher(rule.match.type, rule.match.pattern),
    };
  } catch {
    return null;
  }
}

export function parseDownloadInput(value: unknown): DownloadInput {
  if (
    !isRecord(value) ||
    typeof value.url !== 'string' ||
    (value.finalUrl !== undefined && typeof value.finalUrl !== 'string') ||
    typeof value.filename !== 'string' ||
    !isValidSegment(value.filename) ||
    (value.mime !== undefined && typeof value.mime !== 'string')
  ) {
    throw new Error('Invalid download input.');
  }
  return {
    url: value.url,
    finalUrl: value.finalUrl as string | undefined,
    filename: value.filename,
    mime: (value.mime as string | undefined) ?? '',
  };
}

export function parseConfig(
  value: unknown,
  policy: 'runtime' | 'strict' = 'runtime',
): ExtensionConfig {
  if (
    !isRecord(value) ||
    value.configVersion !== 1 ||
    !isRecord(value.settings) ||
    typeof value.settings.enabled !== 'boolean' ||
    typeof value.settings.matchRedirectedUrl !== 'boolean' ||
    !isConflictAction(value.settings.defaultConflictAction) ||
    !Array.isArray(value.rules)
  ) {
    throw new Error('Invalid or unsupported configuration.');
  }
  const rules: DownloadRule[] = [];
  const ids = new Set<string>();
  for (const valueRule of value.rules) {
    const prepared = prepareRule(valueRule);
    if (!prepared || ids.has(prepared.rule.id)) {
      if (policy === 'strict') throw new Error('Invalid or duplicate rule.');
      continue;
    }
    ids.add(prepared.rule.id);
    rules.push(prepared.rule);
  }
  return {
    configVersion: 1,
    settings: {
      enabled: value.settings.enabled,
      matchRedirectedUrl: value.settings.matchRedirectedUrl,
      defaultConflictAction: value.settings.defaultConflictAction,
    },
    rules,
  };
}
