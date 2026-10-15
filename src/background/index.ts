import { createDownloadHandler } from './download-handler';
import { initializeConfig, readConfig } from '../storage/config-repository';
import { createMessageHandler } from './message-handler';
import { saveRoutingEvent } from '../storage/routing-event';

chrome.downloads.onDeterminingFilename.addListener(
  createDownloadHandler(readConfig, saveRoutingEvent),
);
chrome.runtime.onMessage.addListener(createMessageHandler());
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    void initializeConfig(reason).catch(() => {
      try {
        console.warn('Download Router: could not initialize configuration.');
      } catch {
        /* Diagnostics must not reject the install handler. */
      }
    });
  }
});
