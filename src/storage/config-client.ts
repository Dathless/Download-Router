import { isRecord, parseConfig } from '../core/config-validator';
import { parseImportPreview } from '../core/message-validator';
import {
  CONFIG_ERRORS,
  type ConfigMessage,
  type ConfigResponse,
  type ConfigError,
} from '../models/messages';

export async function requestConfig(
  message: ConfigMessage,
): Promise<ConfigResponse> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(message);
    if (isRecord(response)) {
      if (
        response.ok === false &&
        CONFIG_ERRORS.includes(response.error as ConfigError)
      ) {
        return { ok: false, error: response.error as ConfigError };
      }
      if (
        response.ok === true &&
        typeof response.skippedRules === 'number' &&
        Number.isSafeInteger(response.skippedRules) &&
        response.skippedRules >= 0
      ) {
        return {
          ok: true,
          config: parseConfig(response.config, 'strict'),
          skippedRules: response.skippedRules,
          ...(message.type === 'config.previewImport'
            ? { preview: parseImportPreview(response.preview) }
            : {}),
        };
      }
    }
  } catch {
    /* A disconnected caller cannot assume that a write was not committed. */
  }
  return { ok: false, error: 'CHANNEL_FAILED' };
}
