import { isValidDestination, isValidSegment } from './path-validator';

export function getBasename(filename: string): string {
  return filename.replaceAll('\\', '/').split('/').at(-1) ?? '';
}

export function buildPath(
  destination: string,
  filename: string,
): string | null {
  if (!isValidDestination(destination) || !isValidSegment(filename))
    return null;
  const result = `${destination.replaceAll('\\', '/')}/${filename}`;
  return isValidDestination(result) ? result : null;
}
