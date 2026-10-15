export type MatchType = 'domain' | 'prefix' | 'glob' | 'regex';
export type ConflictAction = 'uniquify' | 'overwrite' | 'prompt';

export interface DownloadRule {
  id: string;
  name: string;
  enabled: boolean;
  match: {
    type: MatchType;
    pattern: string;
    extensions?: string[];
    mimeTypes?: string[];
  };
  destination: string;
  priority: number;
  conflictAction?: ConflictAction;
  createdAt: number;
  updatedAt: number;
}

export interface ExtensionSettings {
  enabled: boolean;
  matchRedirectedUrl: boolean;
  defaultConflictAction: ConflictAction;
}

export interface ExtensionConfig {
  configVersion: 1;
  settings: ExtensionSettings;
  rules: DownloadRule[];
}

export interface DownloadInput {
  url: string;
  finalUrl?: string;
  filename: string;
  mime: string;
}

export type MatchFailureReason =
  | 'disabled'
  | 'invalid-input'
  | 'invalid-url'
  | 'invalid-rule'
  | 'extension-filter'
  | 'mime-filter'
  | 'url-pattern'
  | 'regex-input-too-long';

export type MatchResult = (
  | { matched: false; reason: MatchFailureReason }
  | {
      matched: true;
      rule: DownloadRule;
      matchedUrl: string;
      conflictAction: ConflictAction;
    }
) & { regexInputTooLong?: true };
