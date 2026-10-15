import { parseConfigMessage } from '../core/message-validator';
import type { ConfigResponse } from '../models/messages';
import {
  loadConfig,
  mutateConfig,
  RepositoryError,
  exportConfig,
  previewImport,
} from '../storage/config-repository';

export async function handleConfigRequest(
  value: unknown,
): Promise<ConfigResponse> {
  let message;
  try {
    message = parseConfigMessage(value);
  } catch {
    return { ok: false, error: 'INVALID_MESSAGE' };
  }
  try {
    const result =
      message.type === 'config.get'
        ? await loadConfig()
        : message.type === 'config.export'
          ? { config: await exportConfig(), skippedRules: 0 }
          : message.type === 'config.previewImport'
            ? { ...(await previewImport(message.config)), skippedRules: 0 }
            : { config: await mutateConfig(message), skippedRules: 0 };
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof RepositoryError ? error.code : 'INVALID_MESSAGE',
    };
  }
}

export function createMessageHandler() {
  return (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ConfigResponse) => void,
  ): boolean => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL(''))
    ) {
      sendResponse({ ok: false, error: 'FORBIDDEN' });
      return false;
    }
    void handleConfigRequest(message).then((response) => {
      try {
        sendResponse(response);
      } catch {
        /* The caller closed; any completed write remains committed. */
      }
    });
    return true;
  };
}
