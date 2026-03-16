import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultWebSocketUrl, readRuntimeOverride } from '../src/services/runtimeConfig.ts';

const withWindow = async (
  location: { hostname: string; protocol: string; search?: string },
  run: () => void | Promise<void>,
) => {
  const originalWindow = (globalThis as { window?: typeof window }).window;
  const storage = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };

  (globalThis as { window?: unknown }).window = {
    location: {
      hostname: location.hostname,
      protocol: location.protocol,
      search: location.search ?? '',
    },
    localStorage,
  };

  try {
    await run();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: typeof window }).window = originalWindow;
    }
  }
};

test('buildDefaultWebSocketUrl follows the current browser host', async () => {
  await withWindow({ hostname: '100.69.229.117', protocol: 'http:' }, () => {
    assert.equal(buildDefaultWebSocketUrl(4222), 'ws://100.69.229.117:4222');
  });
});

test('buildDefaultWebSocketUrl upgrades to wss on https pages', async () => {
  await withWindow({ hostname: 'levi.taila510b.ts.net', protocol: 'https:' }, () => {
    assert.equal(buildDefaultWebSocketUrl(4230), 'wss://levi.taila510b.ts.net:4230');
  });
});

test('readRuntimeOverride prefers query params over localStorage', async () => {
  await withWindow(
    {
      hostname: '100.69.229.117',
      protocol: 'http:',
      search: '?appServerUrl=ws%3A%2F%2Foverride.example%3A4222',
    },
    () => {
      assert.equal(
        readRuntimeOverride('appServerUrl', 'modex.appServer.url'),
        'ws://override.example:4222',
      );
    },
  );
});

test('readRuntimeOverride falls back to localStorage', async () => {
  await withWindow({ hostname: '100.69.229.117', protocol: 'http:' }, () => {
    window.localStorage.setItem('modex.appServer.url', 'ws://stored.example:4222');
    assert.equal(readRuntimeOverride('appServerUrl', 'modex.appServer.url'), 'ws://stored.example:4222');
  });
});
