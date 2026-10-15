import { buildPath, getBasename } from '../core/path-builder';
import { matchRule } from '../core/rule-engine';
import { parseConfig } from '../storage/config-repository';

export type DownloadDetails = Pick<
  chrome.downloads.DownloadItem,
  'url' | 'finalUrl' | 'filename' | 'mime'
>;
export type Suggest = (
  suggestion?: chrome.downloads.FilenameSuggestion,
) => void;

export function createDownloadHandler(loadConfig: () => Promise<unknown>) {
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
        const rule = matchRule(input, config);
        const filename = rule
          ? buildPath(rule.destination, input.filename)
          : null;
        if (!rule || !filename) return complete();
        complete({
          filename,
          conflictAction:
            rule.conflictAction ?? config.settings.defaultConflictAction,
        });
      })
      .catch(() => {
        complete();
        console.warn('Download Router: routing failed; using Chrome defaults.');
      });
    return true;
  };
}
