import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeRealtimeTranscriptionStartError,
  getRealtimeTranscriptionSupport,
} from '../src/services/realtimeTranscriptionSupport.ts';

const withBrowser = async (
  options: {
    hasAudioContext?: boolean;
    hasGetUserMedia?: boolean;
    hasWebkitAudioContext?: boolean;
    hostname?: string;
    isSecureContext?: boolean;
    protocol?: string;
  },
  run: () => void | Promise<void>,
) => {
  const originalWindow = (globalThis as { window?: typeof window }).window;
  const originalNavigator = (globalThis as { navigator?: typeof navigator }).navigator;

  (globalThis as { window?: unknown }).window = {
    AudioContext: options.hasAudioContext ? class AudioContextMock {} : undefined,
    isSecureContext: options.isSecureContext ?? true,
    location: {
      hostname: options.hostname ?? 'localhost',
      protocol: options.protocol ?? 'https:',
    },
    webkitAudioContext: options.hasWebkitAudioContext ? class WebkitAudioContextMock {} : undefined,
  };

  (globalThis as { navigator?: unknown }).navigator = options.hasGetUserMedia === false
    ? {}
    : {
        mediaDevices: {
          getUserMedia() {
            return Promise.resolve();
          },
        },
      };

  try {
    await run();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: typeof window }).window = originalWindow;
    }

    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator;
    } else {
      (globalThis as { navigator?: typeof navigator }).navigator = originalNavigator;
    }
  }
};

test('reports insecure remote pages as unsupported for voice transcription', async () => {
  await withBrowser(
    {
      hasAudioContext: true,
      hostname: '100.69.229.117',
      isSecureContext: false,
      protocol: 'http:',
    },
    () => {
      assert.deepEqual(getRealtimeTranscriptionSupport(), {
        canRecord: false,
        reason: 'Voice transcription requires HTTPS or localhost. Open Modex over HTTPS and try again.',
      });
    },
  );
});

test('reports missing microphone capture support separately', async () => {
  await withBrowser(
    {
      hasAudioContext: true,
      hasGetUserMedia: false,
    },
    () => {
      assert.deepEqual(getRealtimeTranscriptionSupport(), {
        canRecord: false,
        reason: 'Voice transcription requires microphone capture support in this browser.',
      });
    },
  );
});

test('accepts browsers that expose only webkitAudioContext', async () => {
  await withBrowser(
    {
      hasAudioContext: false,
      hasWebkitAudioContext: true,
    },
    () => {
      assert.deepEqual(getRealtimeTranscriptionSupport(), {
        canRecord: true,
        reason: null,
      });
    },
  );
});

test('maps blocked microphone permissions to a clear error', () => {
  assert.equal(
    describeRealtimeTranscriptionStartError({ name: 'NotAllowedError' }),
    'Microphone access was blocked. Allow microphone access in this browser and try again.',
  );
});
