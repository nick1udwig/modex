type AudioContextCtor = typeof AudioContext;

type BrowserWindowWithAudio = Window & {
  AudioContext?: AudioContextCtor;
  webkitAudioContext?: AudioContextCtor;
};

const getBrowserWindow = () =>
  typeof window === 'undefined' ? null : (window as BrowserWindowWithAudio);

const getBrowserNavigator = () =>
  typeof navigator === 'undefined' ? null : navigator;

const isLocalhostLike = (hostname: string) =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]';

export const getRecordingAudioContextConstructor = () => {
  const browserWindow = getBrowserWindow();
  if (!browserWindow) {
    return undefined;
  }

  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
};

export const getRealtimeTranscriptionSupport = () => {
  const browserWindow = getBrowserWindow();
  const browserNavigator = getBrowserNavigator();

  if (!browserWindow || !browserNavigator) {
    return {
      canRecord: false,
      reason: 'Voice transcription is only available in a browser.',
    };
  }

  const hostname = browserWindow.location?.hostname ?? '';
  const likelyInsecureRemotePage =
    browserWindow.location?.protocol === 'http:' && hostname.length > 0 && !isLocalhostLike(hostname);

  if (browserWindow.isSecureContext === false || likelyInsecureRemotePage) {
    return {
      canRecord: false,
      reason: 'Voice transcription requires HTTPS or localhost. Open Modex over HTTPS and try again.',
    };
  }

  if (!browserNavigator.mediaDevices?.getUserMedia) {
    return {
      canRecord: false,
      reason: 'Voice transcription requires microphone capture support in this browser.',
    };
  }

  if (!getRecordingAudioContextConstructor()) {
    return {
      canRecord: false,
      reason: 'Voice transcription requires Web Audio support in this browser.',
    };
  }

  return {
    canRecord: true,
    reason: null,
  };
};

export const describeRealtimeTranscriptionStartError = (error: unknown) => {
  const name =
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
      ? error.name
      : null;

  switch (name) {
    case 'AbortError':
      return 'Microphone startup was interrupted. Try again.';
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone access was blocked. Allow microphone access in this browser and try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found for voice transcription.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is unavailable. Close other apps or tabs that are using it and try again.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'This browser rejected the requested microphone settings.';
    case 'SecurityError':
      return getRealtimeTranscriptionSupport().reason ?? 'Voice transcription requires HTTPS or localhost.';
    default:
      break;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Voice transcription failed to start.';
};
