import { vi } from 'vitest';
import { configWithRules, rule } from './rules';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function memoryStorage(initial: unknown = configWithRules([rule])) {
  let stored = structuredClone(initial);
  const replace = (value: unknown) => {
    stored = structuredClone(value);
  };
  const get = vi.fn(async () => ({ config: structuredClone(stored) }));
  const set = vi.fn(async (value: { config: unknown }) => {
    replace(value.config);
  });
  const clear = vi.fn();
  const remove = vi.fn();
  const chromeMock = {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    downloads: { onDeterminingFilename: { addListener: vi.fn() } },
    storage: {
      local: { get, set, clear, remove },
      onChanged: { addListener: vi.fn() },
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  return {
    get,
    set,
    clear,
    remove,
    replace,
    read: () => structuredClone(stored),
    chromeMock,
  };
}
