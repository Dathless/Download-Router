import type { ExtensionConfig } from '../models/config';
import type {
  ConfigError,
  ConfigMutation,
  ImportPreview,
} from '../models/messages';
import { parseConfig, isRecord } from '../core/config-validator';
import { canonicalConfig, parseImportedConfig } from '../core/import-export';
export { parseConfig } from '../core/config-validator';

export class RepositoryError extends Error {
  constructor(public readonly code: ConfigError) {
    super(code);
  }
}

let writeQueue: Promise<void> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(work);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function readConfig(): Promise<unknown> {
  try {
    const stored = await chrome.storage.local.get('config');
    return stored.config;
  } catch {
    throw new RepositoryError('STORAGE_READ_FAILED');
  }
}

function validateStored(
  value: unknown,
  policy: 'runtime' | 'strict',
): ExtensionConfig {
  try {
    return parseConfig(value, policy);
  } catch {
    throw new RepositoryError('INVALID_CONFIG');
  }
}

export async function loadConfig(): Promise<{
  config: ExtensionConfig;
  skippedRules: number;
}> {
  const raw = await readConfig();
  const config = validateStored(raw, 'runtime');
  return {
    config,
    skippedRules: (raw as ExtensionConfig).rules.length - config.rules.length,
  };
}

async function writeConfig(config: ExtensionConfig): Promise<void> {
  try {
    await chrome.storage.local.set({ config });
  } catch {
    throw new RepositoryError('STORAGE_WRITE_FAILED');
  }
}

async function snapshotOf(raw: unknown): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ config: raw })),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function exportConfig(): Promise<ExtensionConfig> {
  const raw = await readConfig();
  try {
    return canonicalConfig(raw);
  } catch {
    throw new RepositoryError('INVALID_CONFIG');
  }
}

export function previewImport(
  value: ExtensionConfig,
): Promise<{ config: ExtensionConfig; preview: ImportPreview }> {
  const config = parseImportedConfig(value);
  return enqueue(async () => {
    const raw = await readConfig();
    let current: ExtensionConfig | null = null;
    try {
      current = parseConfig(raw, 'strict');
    } catch {
      /* Explicit import can recover invalid stored data. */
    }
    return {
      config,
      preview: {
        snapshot: await snapshotOf(raw),
        currentValid: current !== null,
        currentRuleCount:
          isRecord(raw) && Array.isArray(raw.rules) ? raw.rules.length : null,
        currentSettings: current?.settings ?? null,
      },
    };
  });
}

export function mutateConfig(
  mutation: ConfigMutation,
): Promise<ExtensionConfig> {
  const message = structuredClone(mutation);
  return enqueue(async () => {
    if (message.type === 'config.import') {
      const raw = await readConfig();
      if ((await snapshotOf(raw)) !== message.expectedSnapshot)
        throw new RepositoryError('STALE_PREVIEW');
      const imported = parseImportedConfig(message.config);
      await writeConfig(imported);
      return imported;
    }
    const config = validateStored(await readConfig(), 'strict');
    if (message.type === 'settings.update') {
      config.settings = { ...config.settings, ...message.patch };
    } else if (message.type === 'rule.create') {
      const now = Date.now();
      config.rules.push({
        ...message.rule,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const index = config.rules.findIndex((rule) => rule.id === message.id);
      const existing = config.rules[index];
      if (!existing) throw new RepositoryError('RULE_NOT_FOUND');
      if (message.type === 'rule.delete') config.rules.splice(index, 1);
      else if (message.type === 'rule.duplicate') {
        const now = Date.now();
        config.rules.push({
          ...existing,
          id: crypto.randomUUID(),
          name: `${existing.name} (copy)`,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const { match, conflictAction, ...patch } = message.patch;
        const updated = {
          ...existing,
          ...patch,
          match: { ...existing.match, ...match },
          updatedAt: Date.now(),
        };
        if (conflictAction === null) delete updated.conflictAction;
        else if (conflictAction !== undefined)
          updated.conflictAction = conflictAction;
        config.rules[index] = updated;
      }
    }
    let validated: ExtensionConfig;
    try {
      validated = parseConfig(config, 'strict');
    } catch {
      throw new RepositoryError('INVALID_MESSAGE');
    }
    await writeConfig(validated);
    return validated;
  });
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
        name: 'Local example (127.0.0.1)',
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

export async function initializeConfig(reason = 'install'): Promise<void> {
  if (reason !== 'install') return;
  await enqueue(async () => {
    if ((await readConfig()) === undefined)
      await writeConfig(parseConfig(createDefaultConfig(), 'strict'));
  });
}
