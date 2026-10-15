export function isValidSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== '.' &&
    segment !== '..' &&
    // eslint-disable-next-line no-control-regex -- Reject control characters at the filesystem boundary.
    !/[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(segment) &&
    !/[. ]$/u.test(segment) &&
    !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(segment)
  );
}

export function isValidDestination(destination: string): boolean {
  if (/^(?:[\\/]|[a-z]:|~(?:[\\/]|$))/iu.test(destination)) return false;
  return destination.replaceAll('\\', '/').split('/').every(isValidSegment);
}
