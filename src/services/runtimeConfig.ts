const LOOPBACK_HOST = '127.0.0.1';

const browserLocation = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.location;
};

export const readRuntimeOverride = (queryKey: string, storageKey: string) => {
  const location = browserLocation();
  if (!location) {
    return undefined;
  }

  const queryValue = new URLSearchParams(location.search).get(queryKey)?.trim();
  if (queryValue) {
    return queryValue;
  }

  try {
    return window.localStorage.getItem(storageKey)?.trim() || undefined;
  } catch {
    return undefined;
  }
};

export const buildDefaultWebSocketUrl = (port: number, fallbackHost = LOOPBACK_HOST) => {
  const location = browserLocation();
  const hostname = location?.hostname?.trim() || fallbackHost;
  const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL('ws://127.0.0.1');

  url.protocol = protocol;
  url.hostname = hostname;
  url.port = String(port);
  url.pathname = '';
  url.search = '';
  url.hash = '';

  const value = url.toString();
  return value.endsWith('/') ? value.slice(0, -1) : value;
};
