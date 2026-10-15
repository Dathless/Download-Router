import { buildPath, getBasename } from '../core/path-builder';
import { matchRule } from '../core/rule-engine';
import { parseConfig } from '../core/config-validator';
import type { RoutingEvent } from '../models/routing-event';

export type DownloadDetails = Pick<
  chrome.downloads.DownloadItem,
  'url' | 'finalUrl' | 'filename' | 'mime'
>;
export type Suggest = (
  suggestion?: chrome.downloads.FilenameSuggestion,
) => void;

export function createDownloadHandler(
  loadConfig: () => Promise<unknown>,
  recordEvent?: (event: RoutingEvent) => Promise<void>,
) {
  return (item: DownloadDetails, suggest: Suggest): true => {
    let completed = false;
    const complete = (suggestion?: chrome.downloads.FilenameSuggestion) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (suggestion) suggest(suggestion);
      else suggest();
    };
    const timer = setTimeout(() => complete(), 1_000);
    void Promise.resolve()
      .then(loadConfig)
      .then((rawConfig) => {
        if (completed) return;
        const config = parseConfig(rawConfig);
        if (!config.settings.enabled) return complete();
        const input = { ...item, filename: getBasename(item.filename) };
        const result = matchRule(input, config);
        const filename = result.matched
          ? buildPath(result.rule.destination, input.filename)
          : null;
        if (!result.matched || !filename) return complete();
        complete({
          filename,
          conflictAction: result.conflictAction,
        });
        if (recordEvent) {
          const event: RoutingEvent = {
            timestamp: Date.now(),
            ruleId: result.rule.id,
            basename: input.filename,
            destination: result.rule.destination.replaceAll('\\', '/'),
          };
          // Status is best effort and starts only after suggest has returned.
          void Promise.resolve()
            .then(() => recordEvent(event))
            .catch(() => {});
        }
      })
      .catch(() => {
        complete();
        try {
          console.warn(
            'Download Router: routing failed; using Chrome defaults.',
          );
        } catch {
          /* Diagnostics must not reject the event handler. */
        }
      });
    return true;
  };
}
