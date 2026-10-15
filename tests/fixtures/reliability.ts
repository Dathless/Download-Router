import type {
  DownloadRule,
  ExtensionConfig,
  MatchType,
} from '../../src/models/config';

export function reliabilityConfig(
  origin = 'http://127.0.0.1:8173',
): ExtensionConfig {
  const types: MatchType[] = ['domain', 'prefix', 'glob', 'regex'];
  const rules: DownloadRule[] = Array.from({ length: 200 }, (_, index) => {
    const type = types[index % types.length]!;
    const pattern =
      type === 'domain'
        ? `unused-${index}.example.test`
        : type === 'prefix'
          ? `${origin}/unused-${index}/`
          : type === 'glob'
            ? `${origin}/unused-${index}/*`
            : `^http://127[.]0[.]0[.]1:[0-9]+/unused-${index}/(a+)+$`;
    return {
      id: `reliability-${index}`,
      name: `Fixture ${index}`,
      enabled: true,
      match: { type, pattern, extensions: ['txt'], mimeTypes: ['text/plain'] },
      destination: 'DownloadRouterTest/Phase5/Performance',
      priority: index,
      createdAt: 0,
      updatedAt: 0,
    };
  });
  rules[199]!.match.pattern =
    '^http://127[.]0[.]0[.]1:[0-9]+/files/.*[.]txt(?:[?].*)?$';
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

export function percentiles(samples: number[]) {
  if (
    !samples.length ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error('Invalid timing samples.');
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: samples.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    max: sorted.at(-1)!,
  };
}
