import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../fixtures/storage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('TEST-DR-P2-01 real background entry lifecycle', () => {
  it('TEST-DR-P5-05 isolates a throwing initialization logger', async () => {
    vi.resetModules();
    const storage = memoryStorage();
    storage.get.mockRejectedValueOnce(new Error('private-token'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('logger failed');
    });
    await import('../../src/background/index');
    storage.chromeMock.runtime.onInstalled.addListener.mock.calls[0]![0]({
      reason: 'install',
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage.set).not.toHaveBeenCalled();
  });
  it.each(['update', 'chrome_update', 'shared_module_update'])(
    'registers listeners synchronously without seeding on startup/%s',
    async (reason) => {
      vi.resetModules();
      const storage = memoryStorage();
      storage.replace(undefined);
      await import('../../src/background/index');
      expect(
        storage.chromeMock.downloads.onDeterminingFilename.addListener,
      ).toHaveBeenCalledTimes(1);
      expect(
        storage.chromeMock.runtime.onMessage.addListener,
      ).toHaveBeenCalledTimes(1);
      expect(storage.get).not.toHaveBeenCalled();
      storage.chromeMock.runtime.onInstalled.addListener.mock.calls[0]![0]({
        reason,
      });
      expect(storage.get).not.toHaveBeenCalled();
      expect(storage.set).not.toHaveBeenCalled();
    },
  );
  it('seeds only the install event and reports a storage failure generically', async () => {
    vi.resetModules();
    const storage = memoryStorage();
    storage.replace(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.get.mockRejectedValueOnce(new Error('private-token'));
    await import('../../src/background/index');
    storage.chromeMock.runtime.onInstalled.addListener.mock.calls[0]![0]({
      reason: 'install',
    });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        'Download Router: could not initialize configuration.',
      ),
    );
    expect(storage.set).not.toHaveBeenCalled();
  });
});
