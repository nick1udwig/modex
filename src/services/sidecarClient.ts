const DEFAULT_SIDECAR_URL = 'ws://127.0.0.1:4230';

export interface RemoteDirectoryRoot {
  label: string;
  path: string;
}

export interface RemoteDirectoryEntry {
  directory: boolean;
  hidden: boolean;
  kind: string;
  modTime: string;
  name: string;
  path: string;
  selectable: boolean;
  size: number;
}

export interface RemoteDirectoryList {
  entries: RemoteDirectoryEntry[];
  parent: string | null;
  path: string;
  roots: RemoteDirectoryRoot[];
}

export interface RemoteFilesystemClient {
  close(): void;
  list(options?: {
    directoriesOnly?: boolean;
    path?: string;
    showHidden?: boolean;
  }): Promise<RemoteDirectoryList>;
  roots(): Promise<RemoteDirectoryRoot[]>;
  search(options: {
    directoriesOnly?: boolean;
    maxResults?: number;
    path?: string;
    query: string;
    showHidden?: boolean;
  }): Promise<RemoteDirectoryEntry[]>;
  stat(path: string): Promise<RemoteDirectoryEntry>;
}

interface FilesystemRequest {
  directoriesOnly?: boolean;
  id: string;
  maxResults?: number;
  path?: string;
  query?: string;
  showHidden?: boolean;
  type: 'fs.list' | 'fs.roots' | 'fs.search' | 'fs.stat';
}

interface FilesystemErrorPayload {
  code?: string;
  message?: string;
}

interface FilesystemResponse {
  entries?: RemoteDirectoryEntry[];
  entry?: RemoteDirectoryEntry;
  error?: FilesystemErrorPayload;
  id?: string;
  parent?: string;
  path?: string;
  results?: RemoteDirectoryEntry[];
  roots?: RemoteDirectoryRoot[];
  type?: string;
}

interface SidecarConfig {
  token?: string;
  url: string;
}

const readRuntimeOverride = (queryKey: string, storageKey: string) => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const queryValue = new URLSearchParams(window.location.search).get(queryKey)?.trim();
  if (queryValue) {
    return queryValue;
  }

  try {
    return window.localStorage.getItem(storageKey)?.trim() || undefined;
  } catch {
    return undefined;
  }
};

const sidecarConfig = (): SidecarConfig => ({
  token:
    readRuntimeOverride('sidecarToken', 'modex.sidecar.token') ??
    import.meta.env.VITE_MODEX_SIDECAR_TOKEN?.trim() ??
    undefined,
  url:
    readRuntimeOverride('sidecarUrl', 'modex.sidecar.url') ??
    import.meta.env.VITE_MODEX_SIDECAR_URL?.trim() ??
    DEFAULT_SIDECAR_URL,
});

const normalizeSidecarUrl = (rawUrl: string) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  }

  return url;
};

export const buildSidecarWebSocketUrl = (path: string) => {
  const config = sidecarConfig();
  const baseUrl = normalizeSidecarUrl(config.url);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname.slice(0, -1) : baseUrl.pathname;
  baseUrl.pathname = `${basePath}${normalizedPath}`.replace(/\/{2,}/g, '/');
  if (config.token) {
    baseUrl.searchParams.set('token', config.token);
  }
  return baseUrl.toString();
};

const toError = (message: string, details?: FilesystemErrorPayload) => {
  const code = details?.code ? `${details.code}: ` : '';
  return new Error(`${code}${details?.message ?? message}`);
};

class SidecarFilesystemClient implements RemoteFilesystemClient {
  private connectPromise: Promise<WebSocket> | null = null;
  private pending = new Map<string, { reject: (reason?: unknown) => void; resolve: (value: FilesystemResponse) => void }>();
  private requestId = 0;
  private socket: WebSocket | null = null;

  close() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close(1000, 'closing');
    }

    this.rejectPending(new Error('Filesystem connection closed'));
    this.connectPromise = null;
    this.socket = null;
  }

  async roots() {
    const response = await this.request({
      type: 'fs.roots',
    });

    return response.roots ?? [];
  }

  async list(options: { directoriesOnly?: boolean; path?: string; showHidden?: boolean } = {}) {
    const response = await this.request({
      directoriesOnly: options.directoriesOnly,
      path: options.path,
      showHidden: options.showHidden,
      type: 'fs.list',
    });

    return {
      entries: response.entries ?? [],
      parent: response.parent ?? null,
      path: response.path ?? options.path ?? '',
      roots: response.roots ?? [],
    } satisfies RemoteDirectoryList;
  }

  async stat(path: string) {
    const response = await this.request({
      path,
      type: 'fs.stat',
    });

    if (!response.entry) {
      throw new Error('Filesystem response did not include an entry');
    }

    return response.entry;
  }

  async search(options: {
    directoriesOnly?: boolean;
    maxResults?: number;
    path?: string;
    query: string;
    showHidden?: boolean;
  }) {
    const response = await this.request({
      directoriesOnly: options.directoriesOnly,
      maxResults: options.maxResults,
      path: options.path,
      query: options.query,
      showHidden: options.showHidden,
      type: 'fs.search',
    });

    return response.results ?? [];
  }

  private async request(input: Omit<FilesystemRequest, 'id'>) {
    const socket = await this.connect();
    const id = `fs-${++this.requestId}`;
    const payload = {
      ...input,
      id,
    } satisfies FilesystemRequest;

    return new Promise<FilesystemResponse>((resolve, reject) => {
      this.pending.set(id, { reject, resolve });

      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(buildSidecarWebSocketUrl('/ws/filesystem'));
      let settled = false;

      socket.addEventListener('open', () => {
        settled = true;
        this.socket = socket;
        resolve(socket);
      });

      socket.addEventListener('message', (event) => {
        let payload: FilesystemResponse;
        try {
          payload = JSON.parse(String(event.data)) as FilesystemResponse;
        } catch {
          return;
        }

        if (!payload.id) {
          return;
        }

        const pending = this.pending.get(payload.id);
        if (!pending) {
          return;
        }

        this.pending.delete(payload.id);
        if (payload.error) {
          pending.reject(toError('Filesystem request failed', payload.error));
          return;
        }

        pending.resolve(payload);
      });

      socket.addEventListener('close', () => {
        this.socket = null;
        this.connectPromise = null;
        this.rejectPending(new Error('Filesystem connection closed'));

        if (!settled) {
          reject(
            new Error(
              'Unable to connect to the Modex sidecar filesystem service. Check the sidecar URL, allowed origins, and token.',
            ),
          );
        }
      });

      socket.addEventListener('error', () => {
        if (!settled) {
          reject(
            new Error(
              'Unable to connect to the Modex sidecar filesystem service. Check the sidecar URL, allowed origins, and token.',
            ),
          );
        }
      });
    });

    try {
      return await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  private rejectPending(error: Error) {
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
}

export const createSidecarFilesystemClient = (): RemoteFilesystemClient => new SidecarFilesystemClient();
