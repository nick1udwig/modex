import type {
  AccessMode,
  ChatRuntimeSettings,
  ChatStatus,
  ChatSummary,
  ChatThread,
  CreateChatPayload,
  Message,
  RemoteAppClient,
  RemoteThreadEvent,
  SendMessagePayload,
} from '../app/types';

const DEFAULT_APP_SERVER_URL = 'ws://127.0.0.1:4222';
const DEFAULT_SOURCE_KINDS = ['cli', 'vscode', 'appServer'] as const;
const NOTIFICATION_OPTOUTS = [
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/commandExecution/terminalInteraction',
] as const;

interface AppServerConfig {
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  cwd?: string;
  model?: string;
  modelProvider?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  url: string;
}

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcResponse<T> {
  error?: JsonRpcError;
  id: number;
  result?: T;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface RawThreadListResponse {
  data: RawThread[];
  nextCursor?: string | null;
}

interface RawThreadReadResponse {
  thread: RawThread;
}

interface RawThreadStartResponse {
  thread: RawThread;
}

interface RawThreadResumeResponse {
  thread: RawThread;
}

interface RawTurnStartResponse {
  turn: RawTurn;
}

interface RawThread {
  createdAt: number;
  cwd: string;
  id: string;
  modelProvider: string;
  name?: string | null;
  preview: string;
  status: RawThreadStatus;
  turns: RawTurn[];
  updatedAt: number;
}

type RawThreadStatus =
  | { type: 'notLoaded' | 'idle' | 'systemError' }
  | {
      activeFlags?: Array<'waitingOnApproval' | 'waitingOnUserInput'>;
      type: 'active';
    };

interface RawTurn {
  error?: {
    message: string;
  } | null;
  id: string;
  items: RawThreadItem[];
  status: 'completed' | 'failed' | 'inProgress' | 'interrupted';
}

type RawThreadItem =
  | {
      content: RawUserInput[];
      id: string;
      type: 'userMessage';
    }
  | {
      id: string;
      phase?: string | null;
      text: string;
      type: 'agentMessage';
    }
  | {
      id: string;
      type: string;
    };

type RawUserInput =
  | {
      text: string;
      type: 'text';
    }
  | {
      type: 'image';
      url: string;
    }
  | {
      path: string;
      type: 'localImage';
    }
  | {
      name: string;
      path: string;
      type: 'skill';
    }
  | {
      name: string;
      path: string;
      type: 'mention';
    };

interface RawThreadStatusChangedNotification {
  status: RawThreadStatus;
  threadId: string;
}

interface RawThreadNameUpdatedNotification {
  threadId: string;
  threadName?: string | null;
}

interface RawThreadTokenUsageUpdatedNotification {
  threadId: string;
  tokenUsage: {
    total: {
      totalTokens: number;
    };
  };
  turnId: string;
}

interface RawTurnCompletedNotification {
  threadId: string;
  turn: RawTurn;
}

interface RawErrorNotification {
  error: {
    message: string;
  };
  threadId?: string;
  turnId?: string;
  willRetry?: boolean;
}

interface RawItemNotification {
  item: RawThreadItem;
  threadId: string;
  turnId: string;
}

interface RawAgentMessageDeltaNotification {
  delta: string;
  itemId: string;
  threadId: string;
  turnId: string;
}

const appServerConfig = (): AppServerConfig => ({
  approvalPolicy:
    (import.meta.env.VITE_CODEX_APP_SERVER_APPROVAL_POLICY as
      | AppServerConfig['approvalPolicy']
      | undefined) ?? 'never',
  cwd: import.meta.env.VITE_CODEX_APP_SERVER_CWD?.trim() || undefined,
  model: import.meta.env.VITE_CODEX_APP_SERVER_MODEL?.trim() || undefined,
  modelProvider: import.meta.env.VITE_CODEX_APP_SERVER_MODEL_PROVIDER?.trim() || undefined,
  sandbox:
    (import.meta.env.VITE_CODEX_APP_SERVER_SANDBOX as AppServerConfig['sandbox'] | undefined) ??
    undefined,
  url: import.meta.env.VITE_CODEX_APP_SERVER_URL?.trim() || DEFAULT_APP_SERVER_URL,
});

const omitUndefined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

const isoFromSeconds = (seconds: number) => new Date(seconds * 1000).toISOString();
const compactSummaryText = (text: string) => text.replace(/\s+/g, ' ').trim();

const normalizeRoots = (roots: string[]) => {
  const seen = new Set<string>();
  return roots
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .filter((root) => {
      if (seen.has(root)) {
        return false;
      }

      seen.add(root);
      return true;
    });
};

const primaryRoot = (settings: ChatRuntimeSettings | undefined, fallbackCwd: string | undefined) =>
  normalizeRoots(settings?.roots ?? [fallbackCwd ?? ''])[0] ?? fallbackCwd;

const normalizeAccessMode = (settings: ChatRuntimeSettings | undefined, config: AppServerConfig): AccessMode => {
  if (settings?.accessMode) {
    return settings.accessMode;
  }

  if (config.sandbox === 'read-only') {
    return 'read-only';
  }

  return 'workspace-write';
};

const coarseSandboxMode = (
  accessMode: AccessMode,
): Exclude<AppServerConfig['sandbox'], 'danger-full-access' | undefined> =>
  accessMode === 'read-only' ? 'read-only' : 'workspace-write';

const buildSandboxPolicy = (config: AppServerConfig, settings: ChatRuntimeSettings | undefined) => {
  if (!settings) {
    return undefined;
  }

  const roots = normalizeRoots(settings.roots);
  const accessMode = normalizeAccessMode(settings, config);

  if (accessMode === 'read-only') {
    return {
      access: {
        includePlatformDefaults: true,
        readableRoots: roots.slice(1),
        type: 'restricted',
      },
      networkAccess: false,
      type: 'readOnly',
    };
  }

  return {
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: false,
    readOnlyAccess: {
      includePlatformDefaults: true,
      readableRoots: [],
      type: 'restricted',
    },
    type: 'workspaceWrite',
    writableRoots: roots.slice(1),
  };
};

const buildThreadStartParams = (config: AppServerConfig, settings: ChatRuntimeSettings | undefined) => {
  const accessMode = normalizeAccessMode(settings, config);

  return omitUndefined({
    approvalPolicy: config.approvalPolicy,
    cwd: primaryRoot(settings, config.cwd),
    experimentalRawEvents: false,
    model: config.model,
    modelProvider: config.modelProvider,
    persistExtendedHistory: true,
    sandbox: coarseSandboxMode(accessMode),
  });
};

const buildThreadResumeParams = (
  config: AppServerConfig,
  chatId: string,
  settings: ChatRuntimeSettings | undefined,
) => {
  const accessMode = normalizeAccessMode(settings, config);

  return omitUndefined({
    approvalPolicy: config.approvalPolicy,
    cwd: primaryRoot(settings, config.cwd),
    model: config.model,
    modelProvider: config.modelProvider,
    persistExtendedHistory: true,
    sandbox: coarseSandboxMode(accessMode),
    threadId: chatId,
  });
};

const buildTurnStartParams = (
  config: AppServerConfig,
  payload: SendMessagePayload,
) =>
  omitUndefined({
    approvalPolicy: config.approvalPolicy,
    cwd: primaryRoot(payload.settings, config.cwd),
    input: [
      {
        text: payload.content,
        textElements: [],
        type: 'text',
      },
    ],
    sandboxPolicy: buildSandboxPolicy(config, payload.settings),
    threadId: payload.chatId,
  });

const compactPreview = (text: string) => compactSummaryText(text) || 'Start a new request';

export const shouldResumeAfterTurnStartError = (error: unknown) =>
  error instanceof Error && error.message.includes('thread not found:');

const normalizeStatus = (status: RawThreadStatus): ChatStatus => (status.type === 'active' ? 'running' : 'idle');

const isUserMessageItem = (
  item: RawThreadItem,
): item is Extract<RawThreadItem, { type: 'userMessage' }> => item.type === 'userMessage' && 'content' in item;

const isAgentMessageItem = (
  item: RawThreadItem,
): item is Extract<RawThreadItem, { type: 'agentMessage' }> => item.type === 'agentMessage' && 'text' in item;

const isVisibleAgentMessageItem = (
  item: RawThreadItem,
): item is Extract<RawThreadItem, { type: 'agentMessage' }> =>
  isAgentMessageItem(item) && item.phase !== 'commentary';

const formatTokenUsageLabel = (totalTokens: number | null | undefined) => {
  if (!totalTokens || totalTokens <= 0) {
    return null;
  }

  if (totalTokens >= 1_000) {
    const value = (totalTokens / 1_000).toFixed(totalTokens >= 10_000 ? 1 : 1).replace(/\.0$/, '');
    return `${value}k tokens`;
  }

  return `${totalTokens} tokens`;
};

const firstUserPrompt = (thread: RawThread) => {
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (isUserMessageItem(item)) {
        const text = flattenUserInputs(item.content);
        if (text.length > 0) {
          return text;
        }
      }
    }
  }

  return '';
};

const fallbackPreview = (thread: RawThread) => {
  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (isVisibleAgentMessageItem(item)) {
        const text = compactSummaryText(item.text);
        if (text.length > 0) {
          return text;
        }
      }

      if (isUserMessageItem(item)) {
        const text = compactSummaryText(flattenUserInputs(item.content));
        if (text.length > 0) {
          return text;
        }
      }
    }
  }

  return '';
};

const summarizeTitle = (thread: RawThread) => {
  const preferred =
    compactSummaryText(thread.name?.trim() || '') ||
    compactSummaryText(firstUserPrompt(thread)) ||
    compactSummaryText(thread.preview);

  return preferred.slice(0, 60) || 'New session';
};

const messageTimestamp = (threadCreatedAt: number, offset: number) =>
  new Date(threadCreatedAt * 1000 + offset * 1000).toISOString();

export const flattenUserInputs = (inputs: RawUserInput[]) =>
  inputs
    .map((input) => {
      switch (input.type) {
        case 'text':
          return input.text.trim();
        case 'image':
          return `[Image] ${input.url}`;
        case 'localImage':
          return `[Local image] ${input.path}`;
        case 'skill':
          return `$${input.name}`;
        case 'mention':
          return `@${input.name}`;
        default:
          return '';
      }
    })
    .filter((text) => text.length > 0)
    .join('\n');

export const mapThreadSummary = (thread: RawThread): ChatSummary => ({
  id: thread.id,
  preview: compactPreview(fallbackPreview(thread) || thread.preview),
  status: normalizeStatus(thread.status),
  title: summarizeTitle(thread),
  updatedAt: isoFromSeconds(thread.updatedAt),
});

export const mapThreadMessages = (thread: RawThread): Message[] => {
  const messages: Message[] = [];
  let offset = 0;

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (isUserMessageItem(item)) {
        const content = flattenUserInputs(item.content);
        if (content.length === 0) {
          continue;
        }

        messages.push({
          content,
          createdAt: messageTimestamp(thread.createdAt, offset),
          id: item.id,
          role: 'user',
        });
        offset += 1;
        continue;
      }

      if (isVisibleAgentMessageItem(item)) {
        const content = item.text.trim();
        if (content.length === 0) {
          continue;
        }

        messages.push({
          content,
          createdAt: messageTimestamp(thread.createdAt, offset),
          id: item.id,
          role: 'assistant',
        });
        offset += 1;
      }
    }
  }

  return messages;
};

export const mapThread = (thread: RawThread): ChatThread => ({
  ...mapThreadSummary(thread),
  cwd: thread.cwd,
  messages: mapThreadMessages(thread),
  tokenUsageLabel: null,
});

type NotificationHandler = (notification: JsonRpcNotification) => void;
type CloseHandler = (reason: Error) => void;

class AppServerConnection {
  private readonly socket: WebSocket;
  private readonly url: string;
  private closeHandlers = new Set<CloseHandler>();
  private nextRequestId = 1;
  private notificationHandlers = new Set<NotificationHandler>();
  private pending = new Map<
    number,
    {
      reject: (reason?: unknown) => void;
      resolve: (value: unknown) => void;
    }
  >();

  private constructor(socket: WebSocket, url: string) {
    this.socket = socket;
    this.url = url;

    socket.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener('close', () => {
      const error = new Error(`App-server connection closed: ${this.url}`);

      for (const request of this.pending.values()) {
        request.reject(error);
      }

      this.pending.clear();

      for (const handler of this.closeHandlers) {
        handler(error);
      }

      this.closeHandlers.clear();
      this.notificationHandlers.clear();
    });
  }

  static async open(config: AppServerConfig) {
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const created = new WebSocket(config.url);
      let settled = false;

      created.addEventListener('open', () => {
        if (!settled) {
          settled = true;
          resolve(created);
        }
      });

      created.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          reject(new Error(`Unable to connect to app-server at ${config.url}`));
        }
      });
    });

    const connection = new AppServerConnection(socket, config.url);
    await connection.request('initialize', {
      capabilities: {
        optOutNotificationMethods: [...NOTIFICATION_OPTOUTS],
      },
      clientInfo: {
        name: 'modex_web',
        title: 'Modex Web',
        version: '0.1.0',
      },
    });
    connection.notify('initialized');
    return connection;
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }

  onClose(handler: CloseHandler) {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  onNotification(handler: NotificationHandler) {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  notify(method: string, params?: unknown) {
    this.socket.send(JSON.stringify(params === undefined ? { method } : { method, params }));
  }

  request<TResult>(method: string, params?: unknown): Promise<TResult> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        reject,
        resolve: (value) => resolve(value as TResult),
      });

      this.socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }));
    });
  }

  async waitForTurnCompletion(threadId: string, turnId: string) {
    return await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for the app-server to finish the turn'));
      }, 10 * 60 * 1000);

      const removeNotification = this.onNotification((notification) => {
        if (notification.method === 'thread/status/changed') {
          const params = notification.params as RawThreadStatusChangedNotification | undefined;
          if (params?.threadId !== threadId || params.status.type !== 'active') {
            return;
          }

          if (params.status.activeFlags?.includes('waitingOnApproval')) {
            cleanup();
            reject(new Error('Thread is waiting on approval, which this UI does not support yet'));
          }

          if (params.status.activeFlags?.includes('waitingOnUserInput')) {
            cleanup();
            reject(new Error('Thread is waiting on extra user input, which this UI does not support yet'));
          }

          return;
        }

        if (notification.method === 'error') {
          const params = notification.params as RawErrorNotification | undefined;
          if (params?.threadId === threadId && params.turnId === turnId && !params.willRetry) {
            cleanup();
            reject(new Error(params.error.message));
          }
          return;
        }

        if (notification.method !== 'turn/completed') {
          return;
        }

        const params = notification.params as RawTurnCompletedNotification | undefined;
        if (params?.threadId !== threadId || params.turn.id !== turnId) {
          return;
        }

        if (params.turn.status === 'failed') {
          cleanup();
          reject(new Error(params.turn.error?.message ?? 'The app-server turn failed'));
          return;
        }

        if (params.turn.status === 'interrupted') {
          cleanup();
          reject(new Error('The app-server turn was interrupted'));
          return;
        }

        cleanup();
        resolve();
      });

      const removeClose = this.onClose((error) => {
        cleanup();
        reject(error);
      });

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        removeNotification();
        removeClose();
      };
    });
  }

  private handleMessage(raw: string) {
    const parsed = JSON.parse(raw) as JsonRpcNotification | JsonRpcResponse<unknown>;

    if ('method' in parsed) {
      for (const handler of this.notificationHandlers) {
        handler(parsed);
      }
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }

    this.pending.delete(parsed.id);

    if (parsed.error) {
      pending.reject(new Error(parsed.error.message ?? `App-server request failed (${parsed.error.code ?? 'unknown'})`));
      return;
    }

    pending.resolve(parsed.result);
  }
}

const summaryFromThread = (thread: ChatThread): ChatSummary => ({
  id: thread.id,
  preview: thread.preview,
  status: thread.status,
  title: thread.title,
  updatedAt: thread.updatedAt,
});

export class AppServerClient implements RemoteAppClient {
  private readonly config: AppServerConfig;
  private connection: AppServerConnection | null = null;
  private connectionPromise: Promise<AppServerConnection> | null = null;
  private listeners = new Set<(event: RemoteThreadEvent) => void>();
  private refreshingThreadIds = new Set<string>();
  private summaryCache = new Map<string, ChatSummary>();
  private threadCache = new Map<string, ChatThread>();

  constructor(config: AppServerConfig = appServerConfig()) {
    this.config = config;
  }

  subscribe(listener: (event: RemoteThreadEvent) => void) {
    this.listeners.add(listener);
    void this.ensureConnection().catch((error) => {
      this.emit({
        message: error instanceof Error ? error.message : 'Unable to connect to app-server',
        type: 'error',
      });
    });

    return () => {
      this.listeners.delete(listener);
    };
  }

  async createChat(payload?: CreateChatPayload) {
    const connection = await this.ensureConnection();
    const response = await connection.request<RawThreadStartResponse>(
      'thread/start',
      buildThreadStartParams(this.config, payload?.settings),
    );

    const thread = mapThread(response.thread);
    this.storeThread(thread);
    return thread;
  }

  async getChat(chatId: string) {
    const connection = await this.ensureConnection();
    const response = await connection.request<RawThreadReadResponse>('thread/read', {
      includeTurns: true,
      threadId: chatId,
    });

    const thread = this.mergeThread(mapThread(response.thread));
    this.storeThread(thread);
    return thread;
  }

  async listChats() {
    const connection = await this.ensureConnection();
    const threads: RawThread[] = [];
    let cursor: string | null = null;

    do {
      const response: RawThreadListResponse = await connection.request<RawThreadListResponse>('thread/list', {
        archived: false,
        cursor,
        limit: 100,
        sortKey: 'updated_at',
        sourceKinds: [...DEFAULT_SOURCE_KINDS],
      });

      threads.push(...response.data);
      cursor = response.nextCursor ?? null;
    } while (cursor);

    const summaries = threads.map(mapThreadSummary);
    summaries.forEach((summary) => {
      this.summaryCache.set(summary.id, summary);
    });

    return summaries;
  }

  async sendMessage(payload: SendMessagePayload) {
    const connection = await this.ensureConnection();
    const startTurn = () => connection.request<RawTurnStartResponse>('turn/start', buildTurnStartParams(this.config, payload));

    let started: RawTurnStartResponse;

    try {
      started = await startTurn();
    } catch (error) {
      if (!shouldResumeAfterTurnStartError(error)) {
        throw error;
      }

      await connection.request<RawThreadResumeResponse>(
        'thread/resume',
        buildThreadResumeParams(this.config, payload.chatId, payload.settings),
      );

      started = await startTurn();
    }

    await connection.waitForTurnCompletion(payload.chatId, started.turn.id);
    return await this.getChat(payload.chatId);
  }

  private emit(event: RemoteThreadEvent) {
    this.listeners.forEach((listener) => {
      listener(event);
    });
  }

  private ensureConnection() {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = AppServerConnection.open(this.config)
      .then((connection) => {
        this.connection = connection;

        connection.onNotification((notification) => {
          this.handleNotification(notification);
        });

        connection.onClose((error) => {
          if (this.connection === connection) {
            this.connection = null;
            this.connectionPromise = null;
          }

          this.emit({
            message: error.message,
            type: 'error',
          });
        });

        return connection;
      })
      .catch((error) => {
        this.connection = null;
        this.connectionPromise = null;
        throw error;
      });

    return this.connectionPromise;
  }

  private handleNotification(notification: JsonRpcNotification) {
    switch (notification.method) {
      case 'thread/started': {
        const params = notification.params as RawThreadStartResponse | undefined;
        if (!params) {
          return;
        }

        this.storeSummary(mapThreadSummary(params.thread));
        return;
      }

      case 'thread/status/changed': {
        const params = notification.params as RawThreadStatusChangedNotification | undefined;
        if (!params) {
          return;
        }

        const status = normalizeStatus(params.status);
        const cachedSummary = this.summaryCache.get(params.threadId);
        if (cachedSummary) {
          const summary = {
            ...cachedSummary,
            status,
          };
          this.storeSummary(summary);
        }

        const cachedThread = this.threadCache.get(params.threadId);
        if (cachedThread) {
          this.threadCache.set(params.threadId, {
            ...cachedThread,
            status,
          });
        }

        this.emit({
          chatId: params.threadId,
          status,
          type: 'status',
        });
        return;
      }

      case 'thread/name/updated': {
        const params = notification.params as RawThreadNameUpdatedNotification | undefined;
        if (!params) {
          return;
        }

        const title = compactSummaryText(params.threadName ?? '') || 'New session';
        const cachedSummary = this.summaryCache.get(params.threadId);
        if (cachedSummary) {
          this.storeSummary({
            ...cachedSummary,
            title,
          });
        }

        const cachedThread = this.threadCache.get(params.threadId);
        if (cachedThread) {
          const nextThread = {
            ...cachedThread,
            title,
          };
          this.threadCache.set(params.threadId, nextThread);
          this.emit({
            thread: nextThread,
            type: 'thread',
          });
        }
        return;
      }

      case 'thread/tokenUsage/updated': {
        const params = notification.params as RawThreadTokenUsageUpdatedNotification | undefined;
        if (!params) {
          return;
        }

        const label = formatTokenUsageLabel(params.tokenUsage.total.totalTokens);
        const cachedThread = this.threadCache.get(params.threadId);
        if (cachedThread) {
          const nextThread = {
            ...cachedThread,
            tokenUsageLabel: label,
          };
          this.threadCache.set(params.threadId, nextThread);
        }

        this.emit({
          chatId: params.threadId,
          label,
          type: 'token-usage',
        });
        return;
      }

      case 'item/started': {
        const params = notification.params as RawItemNotification | undefined;
        if (!params) {
          return;
        }

        const message = this.mapLiveMessage(params.item);
        if (!message) {
          return;
        }

        this.emit({
          chatId: params.threadId,
          message,
          type: 'message-started',
        });
        return;
      }

      case 'item/agentMessage/delta': {
        const params = notification.params as RawAgentMessageDeltaNotification | undefined;
        if (!params || params.delta.length === 0) {
          return;
        }

        this.emit({
          chatId: params.threadId,
          delta: params.delta,
          messageId: params.itemId,
          type: 'message-delta',
        });
        return;
      }

      case 'item/completed': {
        const params = notification.params as RawItemNotification | undefined;
        if (!params) {
          return;
        }

        const message = this.mapLiveMessage(params.item);
        if (!message) {
          return;
        }

        this.emit({
          chatId: params.threadId,
          message,
          type: 'message-completed',
        });
        return;
      }

      case 'turn/completed': {
        const params = notification.params as RawTurnCompletedNotification | undefined;
        if (!params) {
          return;
        }

        if (params.turn.status === 'failed') {
          this.emit({
            chatId: params.threadId,
            message: params.turn.error?.message ?? 'The app-server turn failed',
            type: 'error',
          });
        }

        void this.refreshThread(params.threadId);
        return;
      }

      case 'error': {
        const params = notification.params as RawErrorNotification | undefined;
        if (!params) {
          return;
        }

        this.emit({
          chatId: params.threadId,
          message: params.error.message,
          type: 'error',
        });
        return;
      }

      default:
        return;
    }
  }

  private mapLiveMessage(item: RawThreadItem): Message | null {
    if (isUserMessageItem(item)) {
      const content = flattenUserInputs(item.content);
      if (content.length === 0) {
        return null;
      }

      return {
        content,
        createdAt: new Date().toISOString(),
        id: item.id,
        role: 'user',
      };
    }

    if (!isVisibleAgentMessageItem(item)) {
      return null;
    }

    return {
      content: item.text,
      createdAt: new Date().toISOString(),
      id: item.id,
      role: 'assistant',
    };
  }

  private mergeThread(thread: ChatThread) {
    const cached = this.threadCache.get(thread.id);
    if (!cached) {
      return thread;
    }

    return {
      ...thread,
      tokenUsageLabel: thread.tokenUsageLabel ?? cached.tokenUsageLabel,
    };
  }

  private storeSummary(summary: ChatSummary) {
    this.summaryCache.set(summary.id, summary);
    this.emit({
      summary,
      type: 'summary',
    });
  }

  private storeThread(thread: ChatThread) {
    this.threadCache.set(thread.id, thread);
    this.summaryCache.set(thread.id, summaryFromThread(thread));
    this.emit({
      thread,
      type: 'thread',
    });
  }

  private async refreshThread(threadId: string) {
    if (this.refreshingThreadIds.has(threadId)) {
      return;
    }

    this.refreshingThreadIds.add(threadId);

    try {
      await this.getChat(threadId);
    } catch (error) {
      this.emit({
        chatId: threadId,
        message: error instanceof Error ? error.message : 'Unable to refresh chat',
        type: 'error',
      });
    } finally {
      this.refreshingThreadIds.delete(threadId);
    }
  }
}

export const createAppServerClient = () => new AppServerClient();
