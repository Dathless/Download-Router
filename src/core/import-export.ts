import type { ExtensionConfig } from '../models/config';
import { isRecord, onlyKeys, parseConfig } from './config-validator';

export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export function canonicalConfig(value: unknown): ExtensionConfig {
  const config = parseConfig(value, 'strict');
  return {
    configVersion: 1,
    settings: config.settings,
    rules: config.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      match: {
        type: rule.match.type,
        pattern: rule.match.pattern,
        ...(rule.match.extensions === undefined
          ? {}
          : { extensions: [...rule.match.extensions] }),
        ...(rule.match.mimeTypes === undefined
          ? {}
          : { mimeTypes: [...rule.match.mimeTypes] }),
      },
      destination: rule.destination,
      priority: rule.priority,
      ...(rule.conflictAction === undefined
        ? {}
        : { conflictAction: rule.conflictAction }),
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    })),
  };
}

export function parseImportedConfig(value: unknown): ExtensionConfig {
  const config = canonicalConfig(value);
  if (
    !isRecord(value) ||
    !onlyKeys(value, ['configVersion', 'settings', 'rules']) ||
    !isRecord(value.settings) ||
    !onlyKeys(value.settings, [
      'enabled',
      'matchRedirectedUrl',
      'defaultConflictAction',
    ]) ||
    !(value.rules as Record<string, unknown>[]).every(
      (rule) =>
        onlyKeys(rule, [
          'id',
          'name',
          'enabled',
          'match',
          'destination',
          'priority',
          'conflictAction',
          'createdAt',
          'updatedAt',
        ]) &&
        onlyKeys(rule.match as Record<string, unknown>, [
          'type',
          'pattern',
          'extensions',
          'mimeTypes',
        ]),
    )
  )
    throw new Error('Invalid imported configuration.');
  return config;
}

export function parseImportJson(text: string): ExtensionConfig {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES)
    throw new Error('Import file exceeds 16 MiB.');
  return parseImportedConfig(JSON.parse(text));
}

export function serializeConfig(value: unknown): string {
  return JSON.stringify(canonicalConfig(value)) + '\n';
}
