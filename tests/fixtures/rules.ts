import type {
  DownloadInput,
  DownloadRule,
  ExtensionConfig,
} from '../../src/models/config';

export const rule: DownloadRule = {
  id: 'test-rule',
  name: 'Fixture rule',
  enabled: true,
  match: { type: 'domain', pattern: 'example.com' },
  destination: 'DownloadRouterTest/Rules',
  priority: 0,
  createdAt: 0,
  updatedAt: 0,
};

export const input: DownloadInput = {
  url: 'https://example.com/download/123',
  filename: 'report.PDF',
  mime: 'application/pdf',
};

export function configWithRules(rules: DownloadRule[]): ExtensionConfig {
  return {
    configVersion: 1,
    settings: {
      enabled: true,
      matchRedirectedUrl: true,
      defaultConflictAction: 'uniquify',
    },
    rules,
  };
}

export const invalidRules: unknown[] = [
  null,
  {},
  { ...rule, id: '' },
  { ...rule, name: ' ' },
  { ...rule, enabled: 'true' },
  { ...rule, priority: '1' },
  { ...rule, priority: NaN },
  { ...rule, priority: Infinity },
  { ...rule, priority: Number.MAX_SAFE_INTEGER + 1 },
  { ...rule, priority: 0.5 },
  { ...rule, conflictAction: null },
  { ...rule, conflictAction: 'replace' },
  { ...rule, createdAt: -1 },
  { ...rule, updatedAt: Infinity },
  { ...rule, destination: '../outside' },
  { ...rule, match: null },
  { ...rule, match: { type: 'unknown', pattern: 'example.com' } },
  { ...rule, match: { type: 'domain', pattern: 'https://example.com' } },
  { ...rule, match: { type: 'domain', pattern: 'example.com:443' } },
  { ...rule, match: { type: 'prefix', pattern: 'javascript:alert(1)' } },
  { ...rule, match: { type: 'regex', pattern: '(?=a)' } },
  { ...rule, match: { ...rule.match, extensions: [123] } },
  { ...rule, match: { ...rule.match, extensions: ['...'] } },
  { ...rule, match: { ...rule.match, extensions: ['../pdf'] } },
  { ...rule, match: { ...rule.match, mimeTypes: ['application/*'] } },
  { ...rule, match: { ...rule.match, mimeTypes: 'application/pdf' } },
];
