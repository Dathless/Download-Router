import { createDefaultConfig } from '../../src/storage/config-repository';
import type { DownloadDetails } from '../../src/background/download-handler';

export const config = createDefaultConfig();
export const item: DownloadDetails = {
  url: 'http://127.0.0.1/files/sample.txt',
  finalUrl: 'http://127.0.0.1/files/sample.txt',
  filename: 'C:\\Downloads\\sample.txt',
  mime: 'text/plain',
};
