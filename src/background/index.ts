import { createDownloadHandler } from './download-handler';
import { initializeConfig, readConfig } from '../storage/config-repository';

chrome.downloads.onDeterminingFilename.addListener(
  createDownloadHandler(readConfig),
);
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    void initializeConfig().catch(() => {
      console.warn('Download Router: could not initialize configuration.');
    });
  }
});
