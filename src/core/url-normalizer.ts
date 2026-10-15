export function getHostname(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}
