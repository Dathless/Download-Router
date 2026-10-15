import { isValidDestination } from '../core/path-validator';
import { getHostname } from '../core/url-normalizer';
import type {
  ConflictAction,
  DownloadRule,
  ExtensionConfig,
} from '../models/config';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConflictAction(value: unknown): value is ConflictAction {
  return value === 'uniquify' || value === 'overwrite' || value === 'prompt';
}

function isDomainRule(value: unknown): value is DownloadRule {
  if (!isRecord(value) || !isRecord(value.match)) return false;
  const { match } = value;
  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.enabled === 'boolean' &&
    match.type === 'domain' &&
    typeof match.pattern === 'string' &&
    getHostname(`https://${match.pattern}/`) === match.pattern.toLowerCase() &&
    (match.extensions === undefined ||
      (Array.isArray(match.extensions) && match.extensions.length === 0)) &&
    (match.mimeTypes === undefined ||
      (Array.isArray(match.mimeTypes) && match.mimeTypes.length === 0)) &&
    typeof value.destination === 'string' &&
    isValidDestination(value.destination) &&
    typeof value.priority === 'number' &&
    Number.isSafeInteger(value.priority) &&
    (value.conflictAction === undefined ||
      isConflictAction(value.conflictAction)) &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    value.createdAt >= 0 &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    value.updatedAt >= 0
  );
}

export function parseConfig(value: unknown): ExtensionConfig {
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
  return {
    configVersion: 1,
    settings: {
      enabled: value.settings.enabled,
      matchRedirectedUrl: value.settings.matchRedirectedUrl,
      defaultConflictAction: value.settings.defaultConflictAction,
    },
    // shortcut: Skip unsupported matcher/filter rules until Phase 1, without modifying storage.
    rules: value.rules.filter(isDomainRule),
  };
}

export async function readConfig(): Promise<unknown> {
  const stored = await chrome.storage.local.get('config');
  return stored.config;
}

export function createDefaultConfig(): ExtensionConfig {
  const now = Date.now();
  return {
    configVersion: 1,
    settings: {
      enabled: true,
      matchRedirectedUrl: true,
      defaultConflictAction: 'uniquify',
    },
    rules: [
      {
        id: 'local-fixture',
        name: 'Local fixture (Phase 0)',
        enabled: true,
        match: { type: 'domain', pattern: '127.0.0.1' },
        destination: 'DownloadRouterTest/Local',
        priority: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export async function initializeConfig(): Promise<void> {
  if ((await readConfig()) === undefined) {
    await chrome.storage.local.set({ config: createDefaultConfig() });
  }
}
