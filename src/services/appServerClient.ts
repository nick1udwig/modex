import type {
  AccessMode,
  ActivityEntry,
  ActivityStatus,
  ApprovalDecision,
  ApprovalRequest,
  ChatRuntimeSettings,
  ChatStatus,
  ChatSummary,
  ChatThread,
  CreateChatPayload,
  JsonRpcId,
  Message,
  RemoteAppClient,
  RemoteThreadEvent,
  SendMessagePayload,
  UserInputRequest,
} from '../app/types';
import { buildDefaultWebSocketUrl, readRuntimeOverride } from './runtimeConfig';

const DEFAULT_SOURCE_KINDS = ['cli', 'vscode', 'appServer'] as const;
const NOTIFICATION_OPTOUTS = [
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/commandExecution/terminalInteraction',
] as const;
const APP_SERVER_RECONNECT_DELAYS_MS = [300, 1_000, 2_500, 5_000] as const;
const TURN_RECOVERY_POLL_MS = 1_000;
const TURN_RECOVERY_TIMEOUT_MS = 10 * 60 * 1_000;

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

interface JsonRpcServerRequest {
  id: JsonRpcId;
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
      text: string;
      type: 'plan';
    }
  | {
      content?: string[] | null;
      id: string;
      summary?: string[] | null;
      type: 'reasoning';
    }
  | {
      aggregatedOutput?: string | null;
      command?: string | null;
      cwd?: string | null;
      exitCode?: number | null;
      id: string;
      status?: 'completed' | 'declined' | 'failed' | 'inProgress' | null;
      type: 'commandExecution';
    }
  | {
      changes?: Array<{
        diff?: string | null;
        kind?: string | null;
        path?: string | null;
      }> | null;
      id: string;
      status?: 'completed' | 'declined' | 'failed' | 'inProgress' | null;
      type: 'fileChange';
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

interface RawTurnStartedNotification {
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

type RawCommandExecutionApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'
  | { acceptWithExecpolicyAmendment: unknown }
  | { applyNetworkPolicyAmendment: unknown };

interface RawAdditionalPermissionProfile {
  fileSystem?: {
    read?: string[] | null;
    write?: string[] | null;
  } | null;
  network?: {
    enabled?: boolean | null;
  } | null;
  macos?: unknown;
}

interface RawCommandExecutionRequestApprovalParams {
  additionalPermissions?: RawAdditionalPermissionProfile | null;
  approvalId?: string | null;
  availableDecisions?: RawCommandExecutionApprovalDecision[] | null;
  command?: string | null;
  cwd?: string | null;
  itemId: string;
  reason?: string | null;
  threadId: string;
  turnId: string;
}

interface RawFileChangeRequestApprovalParams {
  grantRoot?: string | null;
  itemId: string;
  reason?: string | null;
  threadId: string;
  turnId: string;
}

interface RawPermissionsRequestApprovalParams {
  itemId: string;
  permissions: RawAdditionalPermissionProfile;
  reason: string | null;
  threadId: string;
  turnId: string;
}

interface RawToolRequestUserInputParams {
  itemId: string;
  questions: Array<{
    header: string;
    id: string;
    isOther: boolean;
    isSecret: boolean;
    options: Array<{
      description: string;
      label: string;
    }> | null;
    question: string;
  }>;
  threadId: string;
  turnId: string;
}

interface RawLegacyExecCommandApprovalParams {
  approvalId: string | null;
  callId: string;
  command: string[];
  conversationId: string;
  cwd: string;
  reason: string | null;
}

interface RawLegacyApplyPatchApprovalParams {
  callId: string;
  conversationId: string;
  grantRoot: string | null;
  reason: string | null;
}

type PendingServerRequest =
  | {
      kind: 'command-approval';
      requestId: JsonRpcId;
      chatId: string;
      negativeDecision: 'cancel' | 'decline';
    }
  | {
      kind: 'file-change-approval';
      requestId: JsonRpcId;
      chatId: string;
      negativeDecision: 'cancel' | 'decline';
    }
  | {
      kind: 'permissions-approval';
      requestId: JsonRpcId;
      chatId: string;
      permissions: RawAdditionalPermissionProfile;
    }
  | {
      kind: 'legacy-command-approval';
      requestId: JsonRpcId;
      chatId: string;
      negativeDecision: 'abort' | 'denied';
    }
  | {
      kind: 'legacy-apply-patch-approval';
      requestId: JsonRpcId;
      chatId: string;
      negativeDecision: 'abort' | 'denied';
    }
  | {
      kind: 'user-input';
      requestId: JsonRpcId;
      chatId: string;
    };

const appServerConfig = (): AppServerConfig => ({
  approvalPolicy:
    (import.meta.env.VITE_CODEX_APP_SERVER_APPROVAL_POLICY as
      | AppServerConfig['approvalPolicy']
      | undefined) ?? 'on-request',
  cwd: import.meta.env.VITE_CODEX_APP_SERVER_CWD?.trim() || undefined,
  model: import.meta.env.VITE_CODEX_APP_SERVER_MODEL?.trim() || undefined,
  modelProvider: import.meta.env.VITE_CODEX_APP_SERVER_MODEL_PROVIDER?.trim() || undefined,
  sandbox:
    (import.meta.env.VITE_CODEX_APP_SERVER_SANDBOX as AppServerConfig['sandbox'] | undefined) ??
    undefined,
  url:
    readRuntimeOverride('appServerUrl', 'modex.appServer.url') ??
    import.meta.env.VITE_CODEX_APP_SERVER_URL?.trim() ??
    buildDefaultWebSocketUrl({ path: '/app-server' }),
});

export const buildInitializeParams = () => ({
  capabilities: {
    experimentalApi: true,
    optOutNotificationMethods: [...NOTIFICATION_OPTOUTS],
  },
  clientInfo: {
    name: 'modex_web',
    title: 'Modex Web',
    version: '0.1.0',
  },
});

export const isAppServerConnectionClosedError = (error: unknown) =>
  error instanceof Error && error.message.startsWith('App-server connection closed:');

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

const isAppServerUnavailableError = (error: unknown) =>
  error instanceof Error && error.message.startsWith('Unable to connect to app-server at ');

const sleep = (durationMs: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, durationMs);
  });

const detailLine = (label: string, value: string | null | undefined) => {
  const text = value?.trim();
  return text ? `${label}: ${text}` : null;
};

const permissionDetailLines = (permissions: RawAdditionalPermissionProfile | null | undefined) => {
  if (!permissions) {
    return [];
  }

  const lines: string[] = [];
  if (permissions.fileSystem?.write?.length) {
    lines.push(`Writable roots: ${permissions.fileSystem.write.join(', ')}`);
  }
  if (permissions.fileSystem?.read?.length) {
    lines.push(`Readable roots: ${permissions.fileSystem.read.join(', ')}`);
  }
  if (permissions.network?.enabled) {
    lines.push('Network access requested');
  }
  if (permissions.macos) {
    lines.push('Additional macOS permissions requested');
  }
  return lines;
};

const allowsSessionDecision = (availableDecisions: RawCommandExecutionApprovalDecision[] | null | undefined) =>
  !availableDecisions || availableDecisions.some((decision) => decision === 'acceptForSession');

const negativeDecision = (
  availableDecisions: RawCommandExecutionApprovalDecision[] | null | undefined,
): 'cancel' | 'decline' =>
  availableDecisions?.some((decision) => decision === 'decline') ? 'decline' : 'cancel';

const buildCommandApprovalRequest = (
  requestId: JsonRpcId,
  params: RawCommandExecutionRequestApprovalParams,
): ApprovalRequest => ({
  allowSessionDecision: allowsSessionDecision(params.availableDecisions),
  chatId: params.threadId,
  detailLines: [
    detailLine('Command', params.command),
    detailLine('Directory', params.cwd),
    ...permissionDetailLines(params.additionalPermissions),
  ].flatMap((line) => (line ? [line] : [])),
  kind: 'approval',
  message: params.reason?.trim() || 'Codex wants to run a command.',
  requestId,
  title: 'Command approval',
  turnId: params.turnId,
});

const buildFileChangeApprovalRequest = (
  requestId: JsonRpcId,
  params: RawFileChangeRequestApprovalParams,
): ApprovalRequest => ({
  allowSessionDecision: true,
  chatId: params.threadId,
  detailLines: [detailLine('Writable root', params.grantRoot)].flatMap((line) => (line ? [line] : [])),
  kind: 'approval',
  message: params.reason?.trim() || 'Codex wants permission to apply file changes.',
  requestId,
  title: 'File change approval',
  turnId: params.turnId,
});

const buildPermissionsApprovalRequest = (
  requestId: JsonRpcId,
  params: RawPermissionsRequestApprovalParams,
): ApprovalRequest => ({
  allowSessionDecision: true,
  chatId: params.threadId,
  detailLines: permissionDetailLines(params.permissions),
  kind: 'approval',
  message: params.reason?.trim() || 'Codex wants additional permissions.',
  requestId,
  title: 'Permissions approval',
  turnId: params.turnId,
});

const buildLegacyExecApprovalRequest = (
  requestId: JsonRpcId,
  params: RawLegacyExecCommandApprovalParams,
  fallbackTurnId: string | undefined,
): ApprovalRequest => ({
  allowSessionDecision: true,
  chatId: params.conversationId,
  detailLines: [
    params.command.length > 0 ? `Command: ${params.command.join(' ')}` : null,
    detailLine('Directory', params.cwd),
  ].flatMap((line) => (line ? [line] : [])),
  kind: 'approval',
  message: params.reason?.trim() || 'Codex wants to run a command.',
  requestId,
  title: 'Command approval',
  turnId: fallbackTurnId ?? params.callId,
});

const buildLegacyApplyPatchApprovalRequest = (
  requestId: JsonRpcId,
  params: RawLegacyApplyPatchApprovalParams,
  fallbackTurnId: string | undefined,
): ApprovalRequest => ({
  allowSessionDecision: true,
  chatId: params.conversationId,
  detailLines: [detailLine('Writable root', params.grantRoot)].flatMap((line) => (line ? [line] : [])),
  kind: 'approval',
  message: params.reason?.trim() || 'Codex wants permission to apply file changes.',
  requestId,
  title: 'File change approval',
  turnId: fallbackTurnId ?? params.callId,
});

const buildUserInputRequest = (
  requestId: JsonRpcId,
  params: RawToolRequestUserInputParams,
): UserInputRequest => ({
  chatId: params.threadId,
  kind: 'user-input',
  questions: params.questions.map((question) => ({
    header: question.header,
    id: question.id,
    isOther: question.isOther,
    isSecret: question.isSecret,
    options: question.options ?? [],
    question: question.question,
  })),
  requestId,
  title: 'More input needed',
  turnId: params.turnId,
});

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

const isPlanItem = (item: RawThreadItem): item is Extract<RawThreadItem, { type: 'plan' }> =>
  item.type === 'plan' && 'text' in item;

const isReasoningItem = (item: RawThreadItem): item is Extract<RawThreadItem, { type: 'reasoning' }> =>
  item.type === 'reasoning' && ('summary' in item || 'content' in item);

const isCommandExecutionItem = (
  item: RawThreadItem,
): item is Extract<RawThreadItem, { type: 'commandExecution' }> => item.type === 'commandExecution' && 'command' in item;

const isFileChangeItem = (item: RawThreadItem): item is Extract<RawThreadItem, { type: 'fileChange' }> =>
  item.type === 'fileChange' && 'changes' in item;

const normalizeActivityStatus = (
  status: 'completed' | 'declined' | 'failed' | 'inProgress' | null | undefined,
): ActivityStatus => {
  if (status === 'failed' || status === 'declined') {
    return 'failed';
  }

  if (status === 'inProgress') {
    return 'in-progress';
  }

  return 'completed';
};

const mapThreadActivity = (thread: RawThread): ActivityEntry[] =>
  thread.turns.flatMap((turn) =>
    turn.items.flatMap<ActivityEntry>((item) => {
      if (isPlanItem(item)) {
        const detail = item.text.trim();
        if (!detail) {
          return [];
        }

        return [
          {
            detail,
            id: item.id,
            kind: 'plan',
            status: 'completed',
            summary: compactPreview(detail),
            title: 'Plan',
            turnId: turn.id,
          } satisfies ActivityEntry,
        ];
      }

      if (isReasoningItem(item)) {
        const sections = [...(item.summary ?? []), ...(item.content ?? [])]
          .map((section) => section.trim())
          .filter((section) => section.length > 0);

        if (sections.length === 0) {
          return [];
        }

        return [
          {
            detail: sections.join('\n\n'),
            id: item.id,
            kind: 'reasoning',
            status: 'completed',
            summary: compactPreview(sections[0]),
            title: 'Reasoning',
            turnId: turn.id,
          } satisfies ActivityEntry,
        ];
      }

      if (isCommandExecutionItem(item)) {
        const command = item.command?.trim() ?? '';
        const cwd = item.cwd?.trim() ?? '';
        const output = item.aggregatedOutput?.trim() ?? '';
        const detailLines = [
          command ? `Command: ${command}` : null,
          cwd ? `Directory: ${cwd}` : null,
          item.exitCode === null || item.exitCode === undefined ? null : `Exit code: ${item.exitCode}`,
          output.length > 0 ? '' : null,
          output.length > 0 ? output : null,
        ].filter((line): line is string => line !== null);

        return [
          {
            detail: detailLines.join('\n'),
            id: item.id,
            kind: 'command',
            status: normalizeActivityStatus(item.status),
            summary: compactPreview(command || output || 'Shell command'),
            title: command || 'Shell command',
            turnId: turn.id,
          } satisfies ActivityEntry,
        ];
      }

      if (isFileChangeItem(item)) {
        const changes = (item.changes ?? [])
          .map((change) => {
            const path = change.path?.trim() ?? '';
            const kind = change.kind?.trim() ?? '';
            const diff = change.diff?.trim() ?? '';
            if (!path) {
              return null;
            }

            return `${kind ? `${kind}: ` : ''}${path}${diff ? `\n${diff}` : ''}`;
          })
          .filter((entry): entry is string => Boolean(entry));

        if (changes.length === 0) {
          return [];
        }

        const fileList = (item.changes ?? [])
          .map((change) => change.path?.trim() ?? '')
          .filter((path): path is string => path.length > 0);

        return [
          {
            detail: changes.join('\n\n'),
            id: item.id,
            kind: 'file-change',
            status: normalizeActivityStatus(item.status),
            summary: compactPreview(fileList.join(', ')),
            title: fileList.length > 1 ? 'File changes' : fileList[0] ?? 'File change',
            turnId: turn.id,
          } satisfies ActivityEntry,
        ];
      }

      return [];
    }),
  );

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
          turnId: turn.id,
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
          turnId: turn.id,
        });
        offset += 1;
      }
    }
  }

  return messages;
};

export const mapThread = (thread: RawThread): ChatThread => ({
  activity: mapThreadActivity(thread),
  ...mapThreadSummary(thread),
  cwd: thread.cwd,
  messages: mapThreadMessages(thread),
  tokenUsageLabel: null,
});

type NotificationHandler = (notification: JsonRpcNotification) => void;
type CloseHandler = (reason: Error) => void;
type ServerRequestHandler = (request: JsonRpcServerRequest) => boolean;

class AppServerConnection {
  private readonly socket: WebSocket;
  private readonly url: string;
  private closeHandlers = new Set<CloseHandler>();
  private nextRequestId = 1;
  private notificationHandlers = new Set<NotificationHandler>();
  private serverRequestHandlers = new Set<ServerRequestHandler>();
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
    await connection.request('initialize', buildInitializeParams());
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

  onServerRequest(handler: ServerRequestHandler) {
    this.serverRequestHandlers.add(handler);
    return () => {
      this.serverRequestHandlers.delete(handler);
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

  respond(id: JsonRpcId, result: unknown) {
    this.socket.send(JSON.stringify({ id, result }));
  }

  respondError(id: JsonRpcId, message: string, code = -32000) {
    this.socket.send(
      JSON.stringify({
        error: {
          code,
          message,
        },
        id,
      }),
    );
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
          resolve();
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
    const parsed = JSON.parse(raw) as JsonRpcNotification | JsonRpcServerRequest | JsonRpcResponse<unknown>;

    if ('method' in parsed) {
      if ('id' in parsed) {
        let handled = false;

        for (const handler of this.serverRequestHandlers) {
          handled = handler(parsed) || handled;
        }

        if (!handled) {
          this.respondError(parsed.id, `Unsupported app-server request: ${parsed.method}`, -32601);
        }
        return;
      }

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
  private pendingServerRequests = new Map<JsonRpcId, PendingServerRequest>();
  private reconnectAttempt = 0;
  private reconnectTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private refreshingThreadIds = new Set<string>();
  private runningTurnIds = new Map<string, string>();
  private summaryCache = new Map<string, ChatSummary>();
  private threadCache = new Map<string, ChatThread>();
  private reconnectSignalsBound = false;
  private readonly handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }

    this.nudgeReconnect();
  };
  private readonly handleReconnectSignal = () => {
    this.nudgeReconnect();
  };

  constructor(config: AppServerConfig = appServerConfig()) {
    this.config = config;
  }

  subscribe(listener: (event: RemoteThreadEvent) => void) {
    const shouldBindReconnectSignals = this.listeners.size === 0;
    this.listeners.add(listener);
    if (shouldBindReconnectSignals) {
      this.bindReconnectSignals();
    }

    void this.ensureConnection().catch((error) => {
      this.emit({
        message: error instanceof Error ? error.message : 'Unable to connect to app-server',
        type: 'error',
      });
      this.scheduleReconnect();
    });

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.unbindReconnectSignals();
        this.clearReconnectTimer();
      }
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
    const rawThread = await this.readRawThread(chatId);
    const thread = this.storeMappedThread(rawThread);
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

    this.runningTurnIds.set(payload.chatId, started.turn.id);
    try {
      await connection.waitForTurnCompletion(payload.chatId, started.turn.id);
      return await this.getChat(payload.chatId);
    } catch (error) {
      if (!isAppServerConnectionClosedError(error)) {
        throw error;
      }

      return await this.recoverTurnAfterDisconnect(payload.chatId, started.turn.id);
    }
  }

  async interruptTurn(chatId: string) {
    const connection = await this.ensureConnection();
    const turnId = this.runningTurnIds.get(chatId);
    if (!turnId) {
      throw new Error('No active run to stop.');
    }

    await connection.request<Record<string, never>>('turn/interrupt', {
      threadId: chatId,
      turnId,
    });
    this.clearPendingRequestsForChat(chatId);
  }

  async respondToApproval(request: ApprovalRequest, decision: ApprovalDecision) {
    const connection = await this.ensureConnection();
    const pending = this.pendingServerRequests.get(request.requestId);
    if (!pending) {
      throw new Error('That approval request is no longer active.');
    }

    switch (pending.kind) {
      case 'command-approval':
      case 'file-change-approval':
        connection.respond(request.requestId, {
          decision: decision === 'decline' ? pending.negativeDecision : decision,
        });
        break;

      case 'legacy-command-approval':
      case 'legacy-apply-patch-approval':
        connection.respond(request.requestId, {
          decision:
            decision === 'accept'
              ? 'approved'
              : decision === 'acceptForSession'
                ? 'approved_for_session'
                : pending.negativeDecision,
        });
        break;

      case 'permissions-approval':
        if (decision === 'decline') {
          connection.respondError(request.requestId, 'User declined additional permissions.', 4001);
          break;
        }

        connection.respond(request.requestId, {
          permissions: pending.permissions,
          scope: decision === 'acceptForSession' ? 'session' : 'turn',
        });
        break;

      case 'user-input':
        throw new Error('That request needs input, not an approval decision.');
    }

    this.pendingServerRequests.delete(request.requestId);
    this.emit({
      chatId: request.chatId,
      type: 'interaction-cleared',
    });
  }

  async submitUserInput(request: UserInputRequest, answers: Record<string, string[]>) {
    const connection = await this.ensureConnection();
    const pending = this.pendingServerRequests.get(request.requestId);
    if (!pending || pending.kind !== 'user-input') {
      throw new Error('That input request is no longer active.');
    }

    connection.respond(request.requestId, {
      answers,
    });
    this.pendingServerRequests.delete(request.requestId);
    this.emit({
      chatId: request.chatId,
      type: 'interaction-cleared',
    });
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
        this.reconnectAttempt = 0;
        this.clearReconnectTimer();

        connection.onNotification((notification) => {
          this.handleNotification(notification);
        });

        connection.onServerRequest((request) => this.handleServerRequest(request));

        connection.onClose((error) => {
          if (this.connection === connection) {
            this.connection = null;
            this.connectionPromise = null;
          }

          this.pendingServerRequests.clear();
          this.scheduleReconnect();
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

  private bindReconnectSignals() {
    if (this.reconnectSignalsBound || typeof window === 'undefined') {
      return;
    }

    window.addEventListener('online', this.handleReconnectSignal);
    window.addEventListener('pageshow', this.handleReconnectSignal);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.reconnectSignalsBound = true;
  }

  private unbindReconnectSignals() {
    if (!this.reconnectSignalsBound || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('online', this.handleReconnectSignal);
    window.removeEventListener('pageshow', this.handleReconnectSignal);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.reconnectSignalsBound = false;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimerId === null) {
      return;
    }

    globalThis.clearTimeout(this.reconnectTimerId);
    this.reconnectTimerId = null;
  }

  private nudgeReconnect() {
    this.clearReconnectTimer();
    this.scheduleReconnect(true);
  }

  private scheduleReconnect(immediate = false) {
    if (this.listeners.size === 0 || this.connection || this.connectionPromise || this.reconnectTimerId !== null) {
      return;
    }

    const delay = immediate
      ? 0
      : APP_SERVER_RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, APP_SERVER_RECONNECT_DELAYS_MS.length - 1)];

    if (!immediate) {
      this.reconnectAttempt += 1;
    }

    this.reconnectTimerId = globalThis.setTimeout(() => {
      this.reconnectTimerId = null;
      void this.restoreConnection();
    }, delay);
  }

  private async restoreConnection() {
    try {
      await this.ensureConnection();
      await this.restoreAfterReconnect();
    } catch {
      this.scheduleReconnect();
    }
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

      case 'turn/started': {
        const params = notification.params as RawTurnStartedNotification | undefined;
        if (!params) {
          return;
        }

        this.runningTurnIds.set(params.threadId, params.turn.id);
        return;
      }

      case 'thread/status/changed': {
        const params = notification.params as RawThreadStatusChangedNotification | undefined;
        if (!params) {
          return;
        }

        const status = normalizeStatus(params.status);
        if (params.status.type !== 'active') {
          this.runningTurnIds.delete(params.threadId);
          this.clearPendingRequestsForChat(params.threadId);
        }
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

        const message = this.mapLiveMessage(params.item, params.turnId);
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

        const message = this.mapLiveMessage(params.item, params.turnId);
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

        this.runningTurnIds.delete(params.threadId);
        this.clearPendingRequestsForChat(params.threadId);

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

  private handleServerRequest(request: JsonRpcServerRequest) {
    switch (request.method) {
      case 'item/commandExecution/requestApproval': {
        const params = request.params as RawCommandExecutionRequestApprovalParams | undefined;
        if (!params) {
          this.connection?.respondError(request.id, 'Missing approval request params.');
          return true;
        }

        this.pendingServerRequests.set(request.id, {
          chatId: params.threadId,
          kind: 'command-approval',
          negativeDecision: negativeDecision(params.availableDecisions),
          requestId: request.id,
        });
        this.emit({
          request: buildCommandApprovalRequest(request.id, params),
          type: 'interaction-request',
        });
        return true;
      }

      case 'item/fileChange/requestApproval': {
        const params = request.params as RawFileChangeRequestApprovalParams | undefined;
        if (!params) {
          this.connection?.respondError(request.id, 'Missing file approval request params.');
          return true;
        }

        this.pendingServerRequests.set(request.id, {
          chatId: params.threadId,
          kind: 'file-change-approval',
          negativeDecision: 'decline',
          requestId: request.id,
        });
        this.emit({
          request: buildFileChangeApprovalRequest(request.id, params),
          type: 'interaction-request',
        });
        return true;
      }

      case 'item/permissions/requestApproval': {
        const params = request.params as RawPermissionsRequestApprovalParams | undefined;
        if (!params) {
          this.connection?.respondError(request.id, 'Missing permissions approval params.');
          return true;
        }

        this.pendingServerRequests.set(request.id, {
          chatId: params.threadId,
          kind: 'permissions-approval',
          permissions: params.permissions,
          requestId: request.id,
        });
        this.emit({
          request: buildPermissionsApprovalRequest(request.id, params),
          type: 'interaction-request',
        });
        return true;
      }

      case 'item/tool/requestUserInput': {
        const params = request.params as RawToolRequestUserInputParams | undefined;
        if (!params) {
          this.connection?.respondError(request.id, 'Missing user input request params.');
          return true;
        }

        this.pendingServerRequests.set(request.id, {
          chatId: params.threadId,
          kind: 'user-input',
          requestId: request.id,
        });
        this.emit({
          request: buildUserInputRequest(request.id, params),
          type: 'interaction-request',
        });
        return true;
      }

      case 'execCommandApproval': {
        const params = request.params as RawLegacyExecCommandApprovalParams | undefined;
        if (!params) {
          this.connection?.respondError(request.id, 'Missing legacy command approval params.');
          return true;
        }

        this.pendingServerRequests.set(request.id, {
          chatId: params.conversationId,
          kind: 'legacy-command-approval',
          negativeDecision: 'denied',
          requestId: request.id,
        });
        this.emit({
          request: buildLegacyExecApprovalRequest(
            request.id,
            params,
            this.runningTurnIds.get(params.conversationId),
          ),
          type: 'interaction-request',
        });
        return true;
      }

      case 'applyPatchApproval': {
        const params = request.params as RawLegacyApplyPatchApprovalParams | undefined;
        if (!params) {
          this.connection?.respondError(request.id, 'Missing legacy file approval params.');
          return true;
        }

        this.pendingServerRequests.set(request.id, {
          chatId: params.conversationId,
          kind: 'legacy-apply-patch-approval',
          negativeDecision: 'denied',
          requestId: request.id,
        });
        this.emit({
          request: buildLegacyApplyPatchApprovalRequest(
            request.id,
            params,
            this.runningTurnIds.get(params.conversationId),
          ),
          type: 'interaction-request',
        });
        return true;
      }

      default:
        return false;
    }
  }

  private mapLiveMessage(item: RawThreadItem, turnId: string): Message | null {
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
        turnId,
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
      turnId,
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

  private storeMappedThread(rawThread: RawThread) {
    const thread = this.mergeThread(mapThread(rawThread));
    this.storeThread(thread);
    return thread;
  }

  private async readRawThread(chatId: string) {
    const connection = await this.ensureConnection();
    const response = await connection.request<RawThreadReadResponse>('thread/read', {
      includeTurns: true,
      threadId: chatId,
    });

    return response.thread;
  }

  private clearPendingRequestsForChat(chatId: string) {
    let cleared = false;

    for (const [requestId, request] of this.pendingServerRequests.entries()) {
      if (request.chatId !== chatId) {
        continue;
      }

      this.pendingServerRequests.delete(requestId);
      cleared = true;
    }

    if (cleared) {
      this.emit({
        chatId,
        type: 'interaction-cleared',
      });
    }
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

  private async refreshThread(threadId: string, options?: { suppressError?: boolean }) {
    if (this.refreshingThreadIds.has(threadId)) {
      return;
    }

    this.refreshingThreadIds.add(threadId);

    try {
      await this.getChat(threadId);
    } catch (error) {
      if (!options?.suppressError) {
        this.emit({
          chatId: threadId,
          message: error instanceof Error ? error.message : 'Unable to refresh chat',
          type: 'error',
        });
      }
    } finally {
      this.refreshingThreadIds.delete(threadId);
    }
  }

  private async restoreAfterReconnect() {
    const summaries = await this.listChats();
    summaries.forEach((summary) => {
      this.storeSummary(summary);
    });

    const activeThreadIds = new Set<string>();

    this.runningTurnIds.forEach((_, chatId) => {
      activeThreadIds.add(chatId);
    });

    this.summaryCache.forEach((summary) => {
      if (summary.status === 'running') {
        activeThreadIds.add(summary.id);
      }
    });

    this.threadCache.forEach((thread) => {
      if (thread.status === 'running') {
        activeThreadIds.add(thread.id);
      }
    });

    await Promise.allSettled(
      [...activeThreadIds].map((threadId) => this.refreshThread(threadId, { suppressError: true })),
    );
  }

  private async recoverTurnAfterDisconnect(chatId: string, turnId: string) {
    const deadline = Date.now() + TURN_RECOVERY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const rawThread = await this.readRawThread(chatId);
        const thread = this.storeMappedThread(rawThread);
        const turn = rawThread.turns.find((candidate) => candidate.id === turnId) ?? null;

        if (!turn) {
          if (thread.status !== 'running') {
            this.runningTurnIds.delete(chatId);
            this.clearPendingRequestsForChat(chatId);
            return thread;
          }
        } else if (turn.status === 'completed' || turn.status === 'interrupted') {
          this.runningTurnIds.delete(chatId);
          this.clearPendingRequestsForChat(chatId);
          return thread;
        } else if (turn.status === 'failed') {
          this.runningTurnIds.delete(chatId);
          this.clearPendingRequestsForChat(chatId);
          throw new Error(turn.error?.message ?? 'The app-server turn failed');
        }
      } catch (error) {
        if (!isAppServerConnectionClosedError(error) && !isAppServerUnavailableError(error)) {
          throw error;
        }
      }

      this.nudgeReconnect();
      await sleep(Math.min(TURN_RECOVERY_POLL_MS, Math.max(100, deadline - Date.now())));
    }

    throw new Error('Lost connection to the app-server and could not recover the active turn.');
  }
}

export const createAppServerClient = () => new AppServerClient();
