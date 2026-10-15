import type { ConfigMessage, ImportPreview } from '../models/messages';
import {
  isRecord,
  prepareRule,
  onlyKeys,
  parseConfig,
} from './config-validator';
import { parseImportedConfig } from './import-export';

const ruleFields = [
  'name',
  'enabled',
  'match',
  'destination',
  'priority',
  'conflictAction',
];
const snapshotPattern = /^[a-f0-9]{64}$/u;

export function parseConfigMessage(value: unknown): ConfigMessage {
  if (!isRecord(value) || !Object.hasOwn(value, 'type'))
    throw new Error('Invalid message.');
  let valid = false;
  switch (value.type) {
    case 'config.get':
    case 'config.export':
      valid = onlyKeys(value, ['type']);
      break;
    case 'config.previewImport':
    case 'config.import':
      valid =
        onlyKeys(
          value,
          value.type === 'config.import'
            ? ['type', 'config', 'expectedSnapshot']
            : ['type', 'config'],
        ) &&
        (value.type !== 'config.import' ||
          (typeof value.expectedSnapshot === 'string' &&
            snapshotPattern.test(value.expectedSnapshot)));
      if (valid) parseImportedConfig(value.config);
      break;
    case 'settings.update':
      valid =
        onlyKeys(value, ['type', 'patch']) &&
        isRecord(value.patch) &&
        Object.keys(value.patch).length > 0 &&
        onlyKeys(value.patch, [
          'enabled',
          'matchRedirectedUrl',
          'defaultConflictAction',
        ]);
      break;
    case 'rule.create':
      valid =
        onlyKeys(value, ['type', 'rule']) &&
        isRecord(value.rule) &&
        onlyKeys(value.rule, ruleFields) &&
        isRecord(value.rule.match) &&
        onlyKeys(value.rule.match, [
          'type',
          'pattern',
          'extensions',
          'mimeTypes',
        ]) &&
        prepareRule({
          ...value.rule,
          id: 'draft',
          createdAt: 0,
          updatedAt: 0,
        }) !== null;
      break;
    case 'rule.update':
      valid =
        onlyKeys(value, ['type', 'id', 'patch']) &&
        typeof value.id === 'string' &&
        value.id.trim().length > 0 &&
        isRecord(value.patch) &&
        Object.keys(value.patch).length > 0 &&
        onlyKeys(value.patch, ruleFields) &&
        (value.patch.match === undefined ||
          (isRecord(value.patch.match) &&
            Object.keys(value.patch.match).length > 0 &&
            onlyKeys(value.patch.match, [
              'type',
              'pattern',
              'extensions',
              'mimeTypes',
            ])));
      break;
    case 'rule.delete':
    case 'rule.duplicate':
      valid =
        onlyKeys(value, ['type', 'id']) &&
        typeof value.id === 'string' &&
        value.id.trim().length > 0;
      break;
  }
  if (!valid) throw new Error('Invalid message.');
  // Capture the intent before it can wait behind another write.
  return structuredClone(value) as ConfigMessage;
}

export function parseImportPreview(value: unknown): ImportPreview {
  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      'snapshot',
      'currentRuleCount',
      'currentSettings',
      'currentValid',
    ]) ||
    typeof value.snapshot !== 'string' ||
    !snapshotPattern.test(value.snapshot) ||
    typeof value.currentValid !== 'boolean' ||
    (value.currentRuleCount !== null &&
      (!Number.isSafeInteger(value.currentRuleCount) ||
        (value.currentRuleCount as number) < 0)) ||
    (value.currentValid &&
      (value.currentRuleCount === null || value.currentSettings === null))
  )
    throw new Error('Invalid preview.');
  const currentSettings =
    value.currentSettings === null
      ? null
      : parseConfig(
          { configVersion: 1, settings: value.currentSettings, rules: [] },
          'strict',
        ).settings;
  return {
    snapshot: value.snapshot,
    currentRuleCount: value.currentRuleCount as number | null,
    currentSettings,
    currentValid: value.currentValid,
  };
}
