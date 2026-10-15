import { RE2JS } from 're2js';

export const MAX_PATTERN_LENGTH = 256;
export const MAX_REGEX_INPUT_LENGTH = 8_192;

export function compileRegex(pattern: string): RE2JS {
  if (
    typeof pattern !== 'string' ||
    !pattern.length ||
    pattern.length > MAX_PATTERN_LENGTH
  ) {
    throw new Error('Regex pattern must contain 1–256 UTF-16 code units.');
  }
  try {
    return RE2JS.compile(pattern);
  } catch {
    throw new Error('Invalid or unsupported regex syntax.');
  }
}

export function matchesRegex(compiled: RE2JS, input: string): boolean {
  if (input.length > MAX_REGEX_INPUT_LENGTH) return false;
  return compiled.matcher(input).find();
}
