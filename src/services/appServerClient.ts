import type {
  AccessMode,
  ActivityEntry,
  ActivityStatus,
  ApprovalDecision,
  ApprovalPolicy,
  ApprovalRequest,
  ChatRuntimeSettings,
  ChatStatus,
  ChatSummary,
  ChatThread,
  CreateChatPayload,
  JsonRpcId,
  Message,
  ModelOption,
  PendingAttachment,
  ReasoningEffort,
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
const APP_SERVER_THREAD_REFRESH_MS = 2_000;
const APP_SERVER_ITEM_REFRESH_MS = 250;
const TURN_RECOVERY_POLL_MS = 1_000;
const TURN_RECOVERY_TIMEOUT_MS = 10 * 60 * 1_000;
const TURN_MATERIALIZATION_POLL_MS = 350;
const TURN_MATERIALIZATION_TIMEOUT_MS = 15_000;

interface AppServerConfig {
  approvalPolicy?: ApprovalPolicy;
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

interface RawModelListResponse {
  data: RawModel[];
  nextCursor?: string | null;
}

interface RawModel {
  defaultReasoningEffort: ReasoningEffort;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
  model: string;
  supportedReasoningEfforts: Array<{
    description: string;
    reasoningEffort: ReasoningEffort;
  }>;
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
      text: unknown;
      type: 'agentMessage';
    }
  | {
      id: string;
      text: unknown;
      type: 'plan';
    }
  | {
      content?: unknown[] | null;
      id: string;
      summary?: unknown[] | null;
      type: 'reasoning';
    }
  | {
      aggregatedOutput?: unknown;
      command?: unknown;
      cwd?: unknown;
      exitCode?: number | null;
      id: string;
      status?: 'completed' | 'declined' | 'failed' | 'inProgress' | null;
      type: 'commandExecution';
    }
  | {
      changes?: Array<{
        diff?: unknown;
        kind?: unknown;
        path?: unknown;
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
      text: unknown;
      type: 'text';
    }
  | {
      type: 'image';
      url: unknown;
    }
  | {
      path: unknown;
      type: 'localImage';
    }
  | {
      name: unknown;
      path: unknown;
      type: 'skill';
    }
  | {
      name: unknown;
      path: unknown;
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
  proposedExecpolicyAmendment?: string[] | null;
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
    }
  | {
      kind: 'file-change-approval';
      requestId: JsonRpcId;
      chatId: string;
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
    }
  | {
      kind: 'legacy-apply-patch-approval';
      requestId: JsonRpcId;
      chatId: string;
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

export const isAppServerTurnWaitTimeoutError = (error: unknown) =>
  error instanceof Error && error.message === 'Timed out waiting for the app-server to finish the turn';

const omitUndefined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

const isoFromSeconds = (seconds: number) => new Date(seconds * 1000).toISOString();
const textFragmentFromUnknown = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => textFragmentFromUnknown(entry)).join('');
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;

  if ('text' in record) {
    return textFragmentFromUnknown(record.text);
  }

  if ('content' in record) {
    return textFragmentFromUnknown(record.content);
  }

  return '';
};

const textSectionFromUnknown = (value: unknown) => textFragmentFromUnknown(value).trim();

const textSectionsFromUnknown = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => textSectionFromUnknown(entry)).filter((entry) => entry.length > 0);
  }

  const section = textSectionFromUnknown(value);
  return section.length > 0 ? [section] : [];
};

const compactSummaryText = (text: unknown) => textSectionFromUnknown(text).replace(/\s+/g, ' ').trim();

const fileChangeKindText = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  const kind = textSectionFromUnknown(record.type ?? record.kind);
  const movePath = textSectionFromUnknown(record.move_path ?? record.movePath);

  if (!kind) {
    return '';
  }

  if (kind === 'move') {
    return movePath ? `moved to ${movePath}` : 'moved';
  }

  if (kind === 'update') {
    return 'updated';
  }

  if (kind === 'create') {
    return 'created';
  }

  if (kind === 'delete') {
    return 'deleted';
  }

  return kind;
};

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

const normalizeApprovalPolicy = (settings: ChatRuntimeSettings | undefined, config: AppServerConfig) =>
  settings?.approvalPolicy ?? config.approvalPolicy;

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
        readableRoots: roots,
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
    writableRoots: roots,
  };
};

const buildThreadStartParams = (config: AppServerConfig, settings: ChatRuntimeSettings | undefined) => {
  const accessMode = normalizeAccessMode(settings, config);

  return omitUndefined({
    approvalPolicy: normalizeApprovalPolicy(settings, config),
    cwd: primaryRoot(settings, config.cwd),
    experimentalRawEvents: false,
    model: settings?.model ?? config.model,
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
    approvalPolicy: normalizeApprovalPolicy(settings, config),
    cwd: primaryRoot(settings, config.cwd),
    model: settings?.model ?? config.model,
    modelProvider: config.modelProvider,
    persistExtendedHistory: true,
    sandbox: coarseSandboxMode(accessMode),
    threadId: chatId,
  });
};

const buildTextInput = (text: string) => ({
  text,
  textElements: [],
  type: 'text' as const,
});

const attachmentText = (attachment: PendingAttachment) => {
  if (attachment.kind !== 'text-file') {
    return null;
  }

  const body = attachment.text?.trim();
  if (!body) {
    return null;
  }

  return `Attached file: ${attachment.name}\n\n${body}`;
};

const buildTurnInputs = (content: string, attachments: PendingAttachment[]) => {
  const inputs: Array<
    | {
        text: string;
        textElements: never[];
        type: 'text';
      }
    | {
        type: 'image';
        url: string;
      }
  > = [];

  attachments.forEach((attachment) => {
    if (attachment.kind === 'image') {
      if (attachment.url) {
        inputs.push({
          type: 'image',
          url: attachment.url,
        });
      }
      return;
    }

    const text = attachmentText(attachment);
    if (text) {
      inputs.push(buildTextInput(text));
    }
  });

  const prompt = content.trim();

  if (prompt.length > 0 || inputs.length === 0) {
    inputs.unshift(buildTextInput(prompt));
  }

  return inputs;
};

const buildTurnStartParams = (
  config: AppServerConfig,
  payload: SendMessagePayload,
) =>
  omitUndefined({
    approvalPolicy: normalizeApprovalPolicy(payload.settings, config),
    cwd: primaryRoot(payload.settings, config.cwd),
    effort: payload.settings?.reasoningEffort ?? undefined,
    input: buildTurnInputs(payload.content, payload.attachments ?? []),
    model: payload.settings?.model ?? config.model,
    sandboxPolicy: buildSandboxPolicy(config, payload.settings),
    threadId: payload.chatId,
  });

const compactPreview = (text: string) => compactSummaryText(text) || 'Start a new request';

export const shouldResumeAfterTurnStartError = (error: unknown) =>
  error instanceof Error && error.message.includes('thread not found:');

export const isAppServerThreadNotFoundError = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes('thread not found:') ||
    error.message.includes('invalid thread id:') ||
    error.message.includes('thread not loaded:'));

const isAppServerUnavailableError = (error: unknown) =>
  error instanceof Error && error.message.startsWith('Unable to connect to app-server at ');

const sleep = (durationMs: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, durationMs);
  });

const detailLine = (label: string, value: string | null | undefined) => {
  const text = textSectionFromUnknown(value);
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

const allowsDeclineDecision = (availableDecisions: RawCommandExecutionApprovalDecision[] | null | undefined) =>
  !availableDecisions || availableDecisions.some((decision) => decision === 'decline');

const allowsCancelDecision = (availableDecisions: RawCommandExecutionApprovalDecision[] | null | undefined) =>
  !availableDecisions || availableDecisions.some((decision) => decision === 'cancel');

const allowsExecPolicyAmendmentDecision = (
  availableDecisions: RawCommandExecutionApprovalDecision[] | null | undefined,
) =>
  !availableDecisions ||
  availableDecisions.some(
    (decision) =>
      typeof decision === 'object' &&
      decision !== null &&
      'acceptWithExecpolicyAmendment' in decision,
  );

export const buildCommandApprovalRequest = (
  requestId: JsonRpcId,
  params: RawCommandExecutionRequestApprovalParams,
): ApprovalRequest => ({
  allowCancelDecision: allowsCancelDecision(params.availableDecisions),
  allowDeclineDecision: allowsDeclineDecision(params.availableDecisions),
  allowSessionDecision: allowsSessionDecision(params.availableDecisions),
  chatId: params.threadId,
  detailLines: [
    detailLine('Command', params.command),
    detailLine('Directory', params.cwd),
    ...permissionDetailLines(params.additionalPermissions),
  ].flatMap((line) => (line ? [line] : [])),
  execPolicyAmendment:
    params.proposedExecpolicyAmendment?.length && allowsExecPolicyAmendmentDecision(params.availableDecisions)
      ? params.proposedExecpolicyAmendment
      : null,
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
  allowCancelDecision: true,
  allowDeclineDecision: true,
  allowSessionDecision: true,
  chatId: params.threadId,
  detailLines: [detailLine('Writable root', params.grantRoot)].flatMap((line) => (line ? [line] : [])),
  execPolicyAmendment: null,
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
  allowCancelDecision: false,
  allowDeclineDecision: true,
  allowSessionDecision: true,
  chatId: params.threadId,
  detailLines: permissionDetailLines(params.permissions),
  execPolicyAmendment: null,
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
  allowCancelDecision: false,
  allowDeclineDecision: true,
  allowSessionDecision: true,
  chatId: params.conversationId,
  detailLines: [
    params.command.length > 0 ? `Command: ${params.command.join(' ')}` : null,
    detailLine('Directory', params.cwd),
  ].flatMap((line) => (line ? [line] : [])),
  execPolicyAmendment: null,
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
  allowCancelDecision: false,
  allowDeclineDecision: true,
  allowSessionDecision: true,
  chatId: params.conversationId,
  detailLines: [detailLine('Writable root', params.grantRoot)].flatMap((line) => (line ? [line] : [])),
  execPolicyAmendment: null,
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

const latestTurn = (thread: Pick<RawThread, 'turns'>) => thread.turns[thread.turns.length - 1] ?? null;

export const findActiveTurnId = (thread: Pick<RawThread, 'turns'>) =>
  [...thread.turns].reverse().find((turn) => turn.status === 'inProgress')?.id ?? null;

export const latestTurnFailure = (thread: Pick<RawThread, 'turns'>) => {
  const turn = latestTurn(thread);
  if (!turn || turn.status !== 'failed') {
    return null;
  }

  return {
    message: turn.error?.message ?? 'The app-server turn failed',
    turnId: turn.id,
  };
};

const hasTransientLocalMessages = (thread: Pick<ChatThread, 'messages'>) =>
  thread.messages.some((message) => message.id.startsWith('optimistic-') || (message.role === 'assistant' && message.turnId === null));

const summaryDiffersFromThread = (
  summary: Pick<ChatSummary, 'cwd' | 'preview' | 'status' | 'title' | 'updatedAt'>,
  thread: Pick<ChatThread, 'cwd' | 'preview' | 'status' | 'title' | 'updatedAt'>,
) =>
  summary.cwd !== thread.cwd ||
  summary.preview !== thread.preview ||
  summary.status !== thread.status ||
  summary.title !== thread.title ||
  summary.updatedAt !== thread.updatedAt;

export const collectThreadIdsToRefresh = (
  runningChatIds: Iterable<string>,
  summaries: Iterable<Pick<ChatSummary, 'cwd' | 'id' | 'preview' | 'status' | 'title' | 'updatedAt'>>,
  threads: Iterable<Pick<ChatThread, 'cwd' | 'id' | 'messages' | 'preview' | 'status' | 'title' | 'updatedAt'>>,
) => {
  const ids = new Set<string>();
  const summaryById = new Map<string, Pick<ChatSummary, 'cwd' | 'id' | 'preview' | 'status' | 'title' | 'updatedAt'>>();

  for (const chatId of runningChatIds) {
    ids.add(chatId);
  }

  for (const summary of summaries) {
    summaryById.set(summary.id, summary);
    if (summary.status === 'running') {
      ids.add(summary.id);
    }
  }

  for (const thread of threads) {
    const summary = summaryById.get(thread.id);
    if (thread.status === 'running' || hasTransientLocalMessages(thread)) {
      ids.add(thread.id);
      continue;
    }

    if (summary && summaryDiffersFromThread(summary, thread)) {
      ids.add(thread.id);
    }
  }

  return [...ids];
};

const isUserMessageItem = (
  item: RawThreadItem,
): item is Extract<RawThreadItem, { type: 'userMessage' }> => item.type === 'userMessage' && 'content' in item;

const isAgentMessageItem = (
  item: RawThreadItem,
): item is Extract<RawThreadItem, { type: 'agentMessage' }> => item.type === 'agentMessage' && 'text' in item;

const isCommentaryAgentMessageItem = (
  item: RawThreadItem,
): item is Extract<RawThreadItem, { type: 'agentMessage' }> =>
  isAgentMessageItem(item) && item.phase === 'commentary';

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

const activityEntryFromItem = (
  item: RawThreadItem,
  turnId: string,
  options?: {
    fallbackStatus?: ActivityStatus;
    includeVisibleAgentMessages?: boolean;
  },
): ActivityEntry | null => {
  if (isCommentaryAgentMessageItem(item) || (options?.includeVisibleAgentMessages && isVisibleAgentMessageItem(item))) {
    const detail = textSectionFromUnknown(item.text);
    if (!detail) {
      return null;
    }

    return {
      detail,
      id: item.id,
      kind: 'commentary',
      status: options?.fallbackStatus ?? 'completed',
      summary: compactPreview(detail),
      title: isCommentaryAgentMessageItem(item) ? 'Agent update' : 'Draft reply',
      turnId,
    } satisfies ActivityEntry;
  }

  if (isPlanItem(item)) {
    const detail = textSectionFromUnknown(item.text);
    if (!detail) {
      return null;
    }

    return {
      detail,
      id: item.id,
      kind: 'plan',
      status: options?.fallbackStatus ?? 'completed',
      summary: compactPreview(detail),
      title: 'Plan',
      turnId,
    } satisfies ActivityEntry;
  }

  if (isReasoningItem(item)) {
    const sections = [...textSectionsFromUnknown(item.summary ?? []), ...textSectionsFromUnknown(item.content ?? [])];

    if (sections.length === 0) {
      return null;
    }

    return {
      detail: sections.join('\n\n'),
      id: item.id,
      kind: 'reasoning',
      status: options?.fallbackStatus ?? 'completed',
      summary: compactPreview(sections[0]),
      title: 'Reasoning',
      turnId,
    } satisfies ActivityEntry;
  }

  if (isCommandExecutionItem(item)) {
    const command = textSectionFromUnknown(item.command);
    const cwd = textSectionFromUnknown(item.cwd);
    const output = textSectionFromUnknown(item.aggregatedOutput);
    const detailLines = [
      command ? `Command: ${command}` : null,
      cwd ? `Directory: ${cwd}` : null,
      item.exitCode === null || item.exitCode === undefined ? null : `Exit code: ${item.exitCode}`,
      output.length > 0 ? '' : null,
      output.length > 0 ? output : null,
    ].filter((line): line is string => line !== null);

    return {
      detail: detailLines.join('\n'),
      id: item.id,
      kind: 'command',
      status: item.status ? normalizeActivityStatus(item.status) : options?.fallbackStatus ?? 'completed',
      summary: compactPreview(command || output || 'Shell command'),
      title: command || 'Shell command',
      turnId,
    } satisfies ActivityEntry;
  }

  if (isFileChangeItem(item)) {
    const changes = (item.changes ?? [])
      .map((change) => {
        const path = textSectionFromUnknown(change.path);
        const kind = fileChangeKindText(change.kind);
        const diff = textSectionFromUnknown(change.diff);
        if (!path) {
          return null;
        }

        return `${kind ? `${kind}: ` : ''}${path}${diff ? `\n${diff}` : ''}`;
      })
      .filter((entry): entry is string => Boolean(entry));

    if (changes.length === 0) {
      return null;
    }

    const fileList = (item.changes ?? [])
      .map((change) => textSectionFromUnknown(change.path))
      .filter((path): path is string => path.length > 0);

    return {
      detail: changes.join('\n\n'),
      id: item.id,
      kind: 'file-change',
      status: item.status ? normalizeActivityStatus(item.status) : options?.fallbackStatus ?? 'completed',
      summary: compactPreview(fileList.join(', ')),
      title: fileList.length > 1 ? 'File changes' : fileList[0] ?? 'File change',
      turnId,
    } satisfies ActivityEntry;
  }

  return null;
};

const mapThreadActivity = (thread: RawThread): ActivityEntry[] =>
  thread.turns.flatMap((turn) =>
    turn.items.flatMap<ActivityEntry>((item) => {
      const entry = activityEntryFromItem(item, turn.id, {
        fallbackStatus: turn.status === 'inProgress' ? 'in-progress' : 'completed',
        includeVisibleAgentMessages: turn.status === 'inProgress',
      });
      return entry ? [entry] : [];
    }),
  );

const turnHasRenderableOutput = (turn: RawTurn) =>
  turn.items.some((item) => {
    if (isUserMessageItem(item)) {
      return false;
    }

    if (isVisibleAgentMessageItem(item)) {
      return compactSummaryText(item.text).length > 0;
    }

    return activityEntryFromItem(item, turn.id, { fallbackStatus: 'completed' }) !== null;
  });

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
          return textSectionFromUnknown(input.text);
        case 'image': {
          return '[Image] Uploaded photo';
        }
        case 'localImage': {
          const path = textSectionFromUnknown(input.path);
          return path ? `[Local image] ${path}` : '[Local image]';
        }
        case 'skill': {
          const name = textSectionFromUnknown(input.name);
          return name ? `$${name}` : '';
        }
        case 'mention': {
          const name = textSectionFromUnknown(input.name);
          return name ? `@${name}` : '';
        }
        default:
          return '';
      }
    })
    .filter((text) => text.length > 0)
    .join('\n');

export const mapThreadSummary = (thread: RawThread): ChatSummary => ({
  cwd: thread.cwd,
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
        if (turn.status === 'inProgress') {
          continue;
        }

        const content = textSectionFromUnknown(item.text);
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
        continue;
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
  cwd: thread.cwd,
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
  private reportedFailureTurnIds = new Map<string, string>();
  private reconnectAttempt = 0;
  private reconnectTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private refreshingThreadIds = new Set<string>();
  private runningTurnIds = new Map<string, string>();
  private itemRefreshTimerIds = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
  private threadRefreshTimerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private summaryCache = new Map<string, ChatSummary>();
  private threadCache = new Map<string, ChatThread>();
  private reconnectSignalsBound = false;
  private wasBackgrounded = false;
  private readonly handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      this.wasBackgrounded = true;
      return;
    }

    const shouldRestartConnection = this.wasBackgrounded;
    this.wasBackgrounded = false;
    this.handleForegroundResume(shouldRestartConnection);
  };
  private readonly handlePageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) {
      return;
    }

    this.handleForegroundResume(true);
  };
  private readonly handleReconnectSignal = () => {
    this.handleForegroundResume(true);
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
        this.clearItemRefreshTimers();
        this.clearReconnectTimer();
        this.clearThreadRefreshTimer();
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
    try {
      const rawThread = await this.readRawThread(chatId);
      const thread = this.storeMappedThread(rawThread);
      return thread;
    } catch (error) {
      if (!isAppServerThreadNotFoundError(error)) {
        throw error;
      }

      const thread = this.markThreadIdleIfCached(chatId);
      if (thread) {
        return thread;
      }

      throw error;
    }
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

  async listModels() {
    const connection = await this.ensureConnection();
    const models: RawModel[] = [];
    let cursor: string | null = null;

    do {
      const response: RawModelListResponse = await connection.request<RawModelListResponse>('model/list', {
        cursor,
        includeHidden: false,
        limit: 100,
      });
      models.push(...response.data.filter((model: RawModel) => !model.hidden));
      cursor = response.nextCursor ?? null;
    } while (cursor);

    return models.map((model) => ({
      defaultReasoningEffort: model.defaultReasoningEffort ?? null,
      displayName: model.displayName,
      id: model.model,
      isDefault: model.isDefault,
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
    })) satisfies ModelOption[];
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
    this.syncThreadRefreshTimer();
    try {
      await connection.waitForTurnCompletion(payload.chatId, started.turn.id);
      return await this.awaitTurnOutputMaterialized(payload.chatId, started.turn.id);
    } catch (error) {
      if (!isAppServerConnectionClosedError(error) && !isAppServerTurnWaitTimeoutError(error)) {
        throw error;
      }

      return await this.recoverTurnAfterDisconnect(payload.chatId, started.turn.id);
    }
  }

  async interruptTurn(chatId: string) {
    const connection = await this.ensureConnection();
    let turnId: string | null = this.runningTurnIds.get(chatId) ?? null;
    if (!turnId) {
      try {
        const rawThread = await this.readRawThread(chatId);
        this.storeMappedThread(rawThread, { reportRecoveredFailure: true });
        turnId = findActiveTurnId(rawThread);
        if (!turnId) {
          return;
        }
      } catch (error) {
        if (isAppServerThreadNotFoundError(error)) {
          this.markThreadIdleIfCached(chatId);
          return;
        }

        throw error;
      }
    }

    try {
      await connection.request<Record<string, never>>('turn/interrupt', {
        threadId: chatId,
        turnId,
      });
      this.clearPendingRequestsForChat(chatId);
    } catch (error) {
      let refreshedTurnId: string | null;

      try {
        const rawThread = await this.readRawThread(chatId);
        this.storeMappedThread(rawThread, { reportRecoveredFailure: true });
        refreshedTurnId = findActiveTurnId(rawThread);
      } catch {
        throw error;
      }

      if (!refreshedTurnId) {
        return;
      }

      if (refreshedTurnId === turnId) {
        throw error;
      }

      this.runningTurnIds.set(chatId, refreshedTurnId);
      await connection.request<Record<string, never>>('turn/interrupt', {
        threadId: chatId,
        turnId: refreshedTurnId,
      });
      this.clearPendingRequestsForChat(chatId);
    }
  }

  async respondToApproval(request: ApprovalRequest, decision: ApprovalDecision) {
    const connection = await this.ensureConnection();
    const pending = this.pendingServerRequests.get(request.requestId);
    if (!pending) {
      throw new Error('That approval request is no longer active.');
    }

    switch (pending.kind) {
      case 'command-approval':
        connection.respond(request.requestId, {
          decision,
        });
        break;

      case 'file-change-approval':
        if (typeof decision !== 'string') {
          throw new Error('File change approvals do not support command policy amendments.');
        }

        connection.respond(request.requestId, {
          decision,
        });
        break;

      case 'legacy-command-approval':
        if (typeof decision !== 'string') {
          throw new Error('That approval path does not support command policy amendments.');
        }

        connection.respond(request.requestId, {
          decision:
            decision === 'accept'
              ? 'approved'
              : decision === 'acceptForSession'
                ? 'approved_for_session'
                : decision === 'cancel'
                  ? 'abort'
                  : 'denied',
        });
        break;

      case 'legacy-apply-patch-approval':
        if (typeof decision !== 'string') {
          throw new Error('That approval path does not support command policy amendments.');
        }

        connection.respond(request.requestId, {
          decision:
            decision === 'accept'
              ? 'approved'
              : decision === 'acceptForSession'
                ? 'approved_for_session'
                : decision === 'cancel'
                  ? 'abort'
                  : 'denied',
        });
        break;

      case 'permissions-approval':
        if (decision === 'decline' || decision === 'cancel') {
          connection.respondError(request.requestId, 'User declined additional permissions.', 4001);
          break;
        }

        if (typeof decision !== 'string') {
          throw new Error('That approval path does not support command policy amendments.');
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
      requestId: request.requestId,
      turnId: request.turnId,
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
      requestId: request.requestId,
      turnId: request.turnId,
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

          this.clearPendingRequests();
          this.syncThreadRefreshTimer();
          this.scheduleReconnect();
        });

        this.syncThreadRefreshTimer();
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
    window.addEventListener('pageshow', this.handlePageShow);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.reconnectSignalsBound = true;
  }

  private unbindReconnectSignals() {
    if (!this.reconnectSignalsBound || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('online', this.handleReconnectSignal);
    window.removeEventListener('pageshow', this.handlePageShow);
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

  private clearThreadRefreshTimer() {
    if (this.threadRefreshTimerId === null) {
      return;
    }

    globalThis.clearTimeout(this.threadRefreshTimerId);
    this.threadRefreshTimerId = null;
  }

  private clearItemRefreshTimers(threadId?: string) {
    if (threadId) {
      const timerId = this.itemRefreshTimerIds.get(threadId);
      if (timerId !== undefined) {
        globalThis.clearTimeout(timerId);
        this.itemRefreshTimerIds.delete(threadId);
      }
      return;
    }

    this.itemRefreshTimerIds.forEach((timerId) => {
      globalThis.clearTimeout(timerId);
    });
    this.itemRefreshTimerIds.clear();
  }

  private queueThreadRefresh(threadId: string, delayMs = APP_SERVER_ITEM_REFRESH_MS) {
    if (this.listeners.size === 0 || this.itemRefreshTimerIds.has(threadId)) {
      return;
    }

    this.itemRefreshTimerIds.set(
      threadId,
      globalThis.setTimeout(() => {
        this.itemRefreshTimerIds.delete(threadId);
        void this.refreshThread(threadId, { suppressError: true });
      }, delayMs),
    );
  }

  private syncThreadRefreshTimer() {
    if (this.listeners.size === 0) {
      this.clearThreadRefreshTimer();
      return;
    }

    if (this.collectThreadIdsToRefresh().length === 0) {
      this.clearThreadRefreshTimer();
      return;
    }

    if (this.threadRefreshTimerId !== null) {
      return;
    }

    this.threadRefreshTimerId = globalThis.setTimeout(() => {
      this.threadRefreshTimerId = null;
      void this.refreshTrackedThreads();
    }, APP_SERVER_THREAD_REFRESH_MS);
  }

  private async refreshTrackedThreads() {
    const threadIds = this.collectThreadIdsToRefresh();
    if (threadIds.length === 0) {
      this.syncThreadRefreshTimer();
      return;
    }

    await Promise.allSettled(threadIds.map((threadId) => this.refreshThread(threadId, { suppressError: true })));
    this.syncThreadRefreshTimer();
  }

  private handleForegroundResume(forceRestart = false) {
    if (this.connection && (forceRestart || this.hasPotentiallyStaleSessionState())) {
      this.restartConnection();
      return;
    }

    this.nudgeReconnect();
  }

  private hasPotentiallyStaleSessionState() {
    return this.collectThreadIdsToRefresh().length > 0;
  }

  private restartConnection() {
    if (!this.connection) {
      this.nudgeReconnect();
      return;
    }

    const connection = this.connection;
    this.connection = null;
    this.connectionPromise = null;
    this.clearPendingRequests();
    this.clearItemRefreshTimers();
    this.clearThreadRefreshTimer();
    connection.close();
    this.scheduleReconnect(true);
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

        this.reportedFailureTurnIds.delete(params.threadId);
        this.runningTurnIds.set(params.threadId, params.turn.id);
        this.syncThreadRefreshTimer();
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
        this.syncThreadRefreshTimer();
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

        this.queueThreadRefresh(params.threadId);
        const activity = this.mapLiveActivityEntry(params.item, params.turnId, 'in-progress');
        if (activity) {
          this.emit({
            chatId: params.threadId,
            entry: activity,
            type: 'activity-upsert',
          });
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

        this.queueThreadRefresh(params.threadId);
        this.emit({
          chatId: params.threadId,
          delta: params.delta,
          entryId: params.itemId,
          turnId: params.turnId,
          type: 'activity-delta',
        });
        return;
      }

      case 'item/completed': {
        const params = notification.params as RawItemNotification | undefined;
        if (!params) {
          return;
        }

        this.queueThreadRefresh(params.threadId);
        const activity = this.mapLiveActivityEntry(params.item, params.turnId, 'completed');
        if (activity) {
          this.emit({
            chatId: params.threadId,
            entry: activity,
            type: 'activity-upsert',
          });
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
          this.reportedFailureTurnIds.set(params.threadId, params.turn.id);
          this.emit({
            chatId: params.threadId,
            message: params.turn.error?.message ?? 'The app-server turn failed',
            type: 'error',
          });
        }

        this.syncThreadRefreshTimer();
        if (params.turn.status === 'completed' || params.turn.status === 'interrupted') {
          void this.reconcileCompletedTurn(params.threadId, params.turn.id);
          return;
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

    const content = textSectionFromUnknown(item.text);
    if (content.length === 0) {
      return null;
    }

    return {
      content,
      createdAt: new Date().toISOString(),
      id: item.id,
      role: 'assistant',
      turnId,
    };
  }

  private mapLiveActivityEntry(item: RawThreadItem, turnId: string, fallbackStatus: ActivityStatus) {
    return activityEntryFromItem(item, turnId, {
      fallbackStatus,
      includeVisibleAgentMessages: true,
    });
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

  private collectThreadIdsToRefresh() {
    return collectThreadIdsToRefresh(this.runningTurnIds.keys(), this.summaryCache.values(), this.threadCache.values());
  }

  private storeMappedThread(rawThread: RawThread, options?: { reportRecoveredFailure?: boolean }) {
    const activeTurnId = findActiveTurnId(rawThread);
    if (activeTurnId) {
      this.runningTurnIds.set(rawThread.id, activeTurnId);
      this.reportedFailureTurnIds.delete(rawThread.id);
    } else {
      this.runningTurnIds.delete(rawThread.id);
      this.clearPendingRequestsForChat(rawThread.id);
      if (!latestTurnFailure(rawThread)) {
        this.reportedFailureTurnIds.delete(rawThread.id);
      }
    }

    const thread = this.mergeThread(mapThread(rawThread));
    this.storeThread(thread);

    const failure = latestTurnFailure(rawThread);
    if (
      options?.reportRecoveredFailure &&
      failure &&
      this.reportedFailureTurnIds.get(rawThread.id) !== failure.turnId
    ) {
      this.reportedFailureTurnIds.set(rawThread.id, failure.turnId);
      this.emit({
        chatId: rawThread.id,
        message: failure.message,
        type: 'error',
      });
    }

    this.syncThreadRefreshTimer();
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

    this.syncThreadRefreshTimer();
  }

  private clearPendingRequests() {
    if (this.pendingServerRequests.size === 0) {
      return;
    }

    const chatIds = new Set<string>();
    for (const request of this.pendingServerRequests.values()) {
      chatIds.add(request.chatId);
    }

    this.pendingServerRequests.clear();

    chatIds.forEach((chatId) => {
      this.emit({
        chatId,
        type: 'interaction-cleared',
      });
    });

    this.syncThreadRefreshTimer();
  }

  private storeSummary(summary: ChatSummary) {
    this.summaryCache.set(summary.id, summary);
    this.emit({
      summary,
      type: 'summary',
    });
    this.syncThreadRefreshTimer();
  }

  private storeThread(thread: ChatThread) {
    this.threadCache.set(thread.id, thread);
    this.summaryCache.set(thread.id, summaryFromThread(thread));
    this.emit({
      thread,
      type: 'thread',
    });
    this.syncThreadRefreshTimer();
  }

  private markThreadIdleIfCached(threadId: string) {
    this.runningTurnIds.delete(threadId);
    this.clearPendingRequestsForChat(threadId);

    const cachedThread = this.threadCache.get(threadId);
    if (cachedThread) {
      const nextThread = {
        ...cachedThread,
        status: 'idle' as const,
      };
      this.storeThread(nextThread);
      return nextThread;
    }

    const cachedSummary = this.summaryCache.get(threadId);
    if (cachedSummary && cachedSummary.status !== 'idle') {
      this.storeSummary({
        ...cachedSummary,
        status: 'idle',
      });
    }

    return null;
  }

  private async refreshThread(threadId: string, options?: { suppressError?: boolean }) {
    if (this.refreshingThreadIds.has(threadId)) {
      return;
    }

    this.refreshingThreadIds.add(threadId);

    try {
      const rawThread = await this.readRawThread(threadId);
      this.storeMappedThread(rawThread, { reportRecoveredFailure: true });
    } catch (error) {
      if (isAppServerThreadNotFoundError(error)) {
        this.markThreadIdleIfCached(threadId);
        return;
      }

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

  private async awaitTurnOutputMaterialized(chatId: string, turnId: string, initialRawThread?: RawThread) {
    const deadline = Date.now() + TURN_MATERIALIZATION_TIMEOUT_MS;
    let lastRawThread = initialRawThread ?? null;
    let useInitialRawThread = initialRawThread !== undefined;

    while (Date.now() < deadline) {
      try {
        const nextRawThread =
          useInitialRawThread && lastRawThread ? lastRawThread : await this.readRawThread(chatId);
        useInitialRawThread = false;

        const turn = nextRawThread.turns.find((candidate) => candidate.id === turnId) ?? null;
        if (turn?.status === 'failed') {
          this.storeMappedThread(nextRawThread, { reportRecoveredFailure: true });
          throw new Error(turn.error?.message ?? 'The app-server turn failed');
        }

        if (turn?.status === 'interrupted') {
          return this.storeMappedThread(nextRawThread, { reportRecoveredFailure: true });
        }

        if (turn?.status === 'completed' && turnHasRenderableOutput(turn)) {
          return this.storeMappedThread(nextRawThread, { reportRecoveredFailure: true });
        }

        lastRawThread = nextRawThread;
      } catch (error) {
        if (!isAppServerConnectionClosedError(error) && !isAppServerUnavailableError(error)) {
          throw error;
        }

        lastRawThread = null;
        useInitialRawThread = false;
        this.nudgeReconnect();
      }

      await sleep(Math.min(TURN_MATERIALIZATION_POLL_MS, Math.max(100, deadline - Date.now())));
    }

    if (lastRawThread) {
      return this.storeMappedThread(lastRawThread, { reportRecoveredFailure: true });
    }

    return await this.getChat(chatId);
  }

  private async reconcileCompletedTurn(chatId: string, turnId: string) {
    try {
      await this.awaitTurnOutputMaterialized(chatId, turnId);
    } catch (error) {
      this.emit({
        chatId,
        message: error instanceof Error ? error.message : 'Unable to finish syncing the completed turn',
        type: 'error',
      });
    }
  }

  private async restoreAfterReconnect() {
    const summaries = await this.listChats();
    summaries.forEach((summary) => {
      this.storeSummary(summary);
    });

    await Promise.allSettled(
      this.collectThreadIdsToRefresh().map((threadId) => this.refreshThread(threadId, { suppressError: true })),
    );
  }

  private async recoverTurnAfterDisconnect(chatId: string, turnId: string) {
    const deadline = Date.now() + TURN_RECOVERY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const rawThread = await this.readRawThread(chatId);
        const turn = rawThread.turns.find((candidate) => candidate.id === turnId) ?? null;

        if (!turn) {
          const thread = this.storeMappedThread(rawThread, { reportRecoveredFailure: true });
          if (thread.status !== 'running') {
            this.runningTurnIds.delete(chatId);
            this.clearPendingRequestsForChat(chatId);
            return thread;
          }
        } else if (turn.status === 'completed' || turn.status === 'interrupted') {
          this.runningTurnIds.delete(chatId);
          this.clearPendingRequestsForChat(chatId);
          return await this.awaitTurnOutputMaterialized(chatId, turnId, rawThread);
        } else if (turn.status === 'failed') {
          this.storeMappedThread(rawThread, { reportRecoveredFailure: true });
          this.runningTurnIds.delete(chatId);
          this.clearPendingRequestsForChat(chatId);
          throw new Error(turn.error?.message ?? 'The app-server turn failed');
        }

        this.storeMappedThread(rawThread, { reportRecoveredFailure: true });
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
