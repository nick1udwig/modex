const LOOPBACK_HOST = '127.0.0.1';

interface WebSocketUrlTarget {
  path?: string;
  port?: number;
}

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

export const buildDefaultWebSocketUrl = (
  target: number | WebSocketUrlTarget,
  fallbackHost = LOOPBACK_HOST,
) => {
  const options = typeof target === 'number' ? { port: target } : target;
  const location = browserLocation();
  const hostname = location?.hostname?.trim() || fallbackHost;
  const currentPort = location?.port?.trim() || '';
  const protocol = location?.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL('ws://127.0.0.1');
  const path = options.path?.trim() || '';

  url.protocol = protocol;
  url.hostname = hostname;
  url.port = options.port === undefined ? currentPort : String(options.port);
  url.pathname = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  url.search = '';
  url.hash = '';

  const value = url.toString();
  return value.endsWith('/') ? value.slice(0, -1) : value;
};
