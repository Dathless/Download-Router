import type {
  ConflictAction,
  DownloadRule,
  ExtensionConfig,
  ExtensionSettings,
} from './config';

export type RuleDraft = Omit<DownloadRule, 'id' | 'createdAt' | 'updatedAt'>;
export type RulePatch = Partial<Omit<RuleDraft, 'match' | 'conflictAction'>> & {
  match?: Partial<DownloadRule['match']>;
  conflictAction?: ConflictAction | null;
};
export type ConfigMutation =
  | { type: 'settings.update'; patch: Partial<ExtensionSettings> }
  | { type: 'rule.create'; rule: RuleDraft }
  | { type: 'rule.update'; id: string; patch: RulePatch }
  | { type: 'rule.delete'; id: string }
  | { type: 'rule.duplicate'; id: string }
  | {
      type: 'config.import';
      config: ExtensionConfig;
      expectedSnapshot: string;
    };
export type ConfigMessage =
  | { type: 'config.get' }
  | { type: 'config.export' }
  | { type: 'config.previewImport'; config: ExtensionConfig }
  | ConfigMutation;

export interface ImportPreview {
  snapshot: string;
  currentRuleCount: number | null;
  currentSettings: ExtensionSettings | null;
  currentValid: boolean;
}

export const CONFIG_ERRORS = [
  'INVALID_MESSAGE',
  'INVALID_CONFIG',
  'RULE_NOT_FOUND',
  'STORAGE_READ_FAILED',
  'STORAGE_WRITE_FAILED',
  'FORBIDDEN',
  'CHANNEL_FAILED',
  'STALE_PREVIEW',
] as const;
export type ConfigError = (typeof CONFIG_ERRORS)[number];
export type ConfigResponse =
  | {
      ok: true;
      config: ExtensionConfig;
      skippedRules: number;
      preview?: ImportPreview;
    }
  | { ok: false; error: ConfigError };
