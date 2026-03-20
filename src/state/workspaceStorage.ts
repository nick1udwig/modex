import type {
  ActivityEntry,
  ActivityKind,
  ActivityStatus,
  ChatRuntimeSettings,
  ChatStatus,
  ChatSummary,
  ChatThread,
  Message,
  MessageRole,
} from '../app/types';

interface WorkspaceSnapshot {
  activeChatId: string | null;
  cachedChats: ChatSummary[];
  cachedThreadsByChatId: Record<string, ChatThread>;
  chatSettingsByChatId: Record<string, ChatRuntimeSettings>;
  draftsByChatId: Record<string, string>;
  openChatIds: string[];
}

interface RawWorkspaceSnapshot {
  activeChatId?: string | null;
  cachedChats?: unknown;
  cachedThreadsByChatId?: Record<string, unknown>;
  chatSettingsByChatId?: Record<string, unknown>;
  draftsByChatId?: Record<string, unknown>;
  openChatIds?: string[];
}

const STORAGE_KEY = 'modex.workspace.v1';
const VALID_CHAT_STATUSES = new Set<ChatStatus>(['idle', 'running', 'waiting-approval', 'waiting-input']);
const VALID_MESSAGE_ROLES = new Set<MessageRole>(['assistant', 'system', 'user']);
const VALID_ACTIVITY_KINDS = new Set<ActivityKind>(['command', 'commentary', 'file-change', 'plan', 'reasoning']);
const VALID_ACTIVITY_STATUSES = new Set<ActivityStatus>(['completed', 'failed', 'in-progress']);
const MAX_STORED_CHAT_SUMMARIES = 60;
const MAX_STORED_THREADS = 6;
const MAX_STORED_MESSAGES = 40;
const MAX_STORED_ACTIVITY = 60;
const MAX_STORED_TEXT_CHARS = 4_000;
const MAX_STORED_SUMMARY_CHARS = 320;
const MAX_STORED_TITLE_CHARS = 120;
const MAX_STORED_CWD_CHARS = 512;
const MAX_STORED_TOKEN_USAGE_CHARS = 64;

const dedupeIds = (chatIds: string[]) => {
  const seen = new Set<string>();
  return chatIds.filter((chatId) => {
    if (seen.has(chatId)) {
      return false;
    }

    seen.add(chatId);
    return true;
  });
};

const truncateStoredText = (value: string, limit: number) => {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const isStoredChatId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const sanitizeRoots = (roots: unknown) => {
  if (!Array.isArray(roots)) {
    return [];
  }

  const seen = new Set<string>();
  return roots
    .filter((root): root is string => typeof root === 'string')
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

const normalizeIsoDate = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || Number.isNaN(Date.parse(normalized))) {
    return null;
  }

  return normalized;
};

const normalizeChatStatus = (value: unknown): ChatStatus | null =>
  typeof value === 'string' && VALID_CHAT_STATUSES.has(value as ChatStatus) ? (value as ChatStatus) : null;

const normalizeMessageRole = (value: unknown): MessageRole | null =>
  typeof value === 'string' && VALID_MESSAGE_ROLES.has(value as MessageRole) ? (value as MessageRole) : null;

const sanitizeChatSummary = (value: unknown): ChatSummary | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const summary = value as Partial<ChatSummary>;
  const cwd = typeof summary.cwd === 'string' ? summary.cwd : '';
  const id = typeof summary.id === 'string' ? summary.id.trim() : '';
  const title = typeof summary.title === 'string' ? summary.title.trim() : '';
  const preview = typeof summary.preview === 'string' ? summary.preview : '';
  const status = normalizeChatStatus(summary.status);
  const updatedAt = normalizeIsoDate(summary.updatedAt);

  if (!id || !title || status === null || updatedAt === null) {
    return null;
  }

  return {
    cwd,
    id,
    preview,
    status,
    title,
    updatedAt,
  };
};

const sanitizeMessage = (value: unknown): Message | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const message = value as Partial<Message>;
  const id = typeof message.id === 'string' ? message.id.trim() : '';
  const content = typeof message.content === 'string' ? message.content : '';
  const role = normalizeMessageRole(message.role);
  const createdAt = normalizeIsoDate(message.createdAt);
  const turnId = typeof message.turnId === 'string' && message.turnId.trim().length > 0 ? message.turnId : null;

  if (!id || role === null || createdAt === null) {
    return null;
  }

  return {
    content,
    createdAt,
    id,
    role,
    turnId,
  };
};

const sanitizeActivityEntry = (value: unknown): ActivityEntry | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const entry = value as Partial<ActivityEntry>;
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const kind =
    typeof entry.kind === 'string' && VALID_ACTIVITY_KINDS.has(entry.kind as ActivityKind)
      ? (entry.kind as ActivityKind)
      : null;
  const summary = typeof entry.summary === 'string' ? entry.summary : '';
  const detail = typeof entry.detail === 'string' ? entry.detail : '';
  const status =
    typeof entry.status === 'string' && VALID_ACTIVITY_STATUSES.has(entry.status as ActivityStatus)
      ? (entry.status as ActivityStatus)
      : null;
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const turnId = typeof entry.turnId === 'string' ? entry.turnId.trim() : '';

  if (!id || !kind || !status || !title || !turnId) {
    return null;
  }

  return {
    detail,
    id,
    kind,
    status,
    summary,
    title,
    turnId,
  };
};

const summarizeCachedThread = (thread: ChatThread): ChatSummary => ({
  cwd: thread.cwd,
  id: thread.id,
  preview: thread.preview,
  status: thread.status,
  title: thread.title,
  updatedAt: thread.updatedAt,
});

const sanitizeChatThread = (value: unknown): ChatThread | null => {
  const summary = sanitizeChatSummary(value);
  if (!summary || typeof value !== 'object' || value === null) {
    return null;
  }

  const thread = value as Partial<ChatThread>;
  const cwd = typeof thread.cwd === 'string' ? thread.cwd : '';
  const tokenUsageLabel = typeof thread.tokenUsageLabel === 'string' ? thread.tokenUsageLabel : null;
  const messages = Array.isArray(thread.messages)
    ? thread.messages.map(sanitizeMessage).filter((message): message is Message => Boolean(message))
    : [];
  const activity = Array.isArray(thread.activity)
    ? thread.activity
        .map(sanitizeActivityEntry)
        .filter((entry): entry is ActivityEntry => Boolean(entry))
    : [];

  return {
    ...summary,
    activity,
    cwd,
    messages,
    tokenUsageLabel,
  };
};

const compactStoredSummary = (summary: ChatSummary): ChatSummary => ({
  ...summary,
  cwd: truncateStoredText(summary.cwd, MAX_STORED_CWD_CHARS),
  preview: truncateStoredText(summary.preview, MAX_STORED_TEXT_CHARS),
  title: truncateStoredText(summary.title, MAX_STORED_TITLE_CHARS),
});

const compactStoredThread = (thread: ChatThread): ChatThread => ({
  ...thread,
  activity: thread.activity.slice(-MAX_STORED_ACTIVITY).map((entry) => ({
    ...entry,
    detail: truncateStoredText(entry.detail, MAX_STORED_TEXT_CHARS),
    summary: truncateStoredText(entry.summary, MAX_STORED_SUMMARY_CHARS),
    title: truncateStoredText(entry.title, MAX_STORED_TITLE_CHARS),
  })),
  cwd: truncateStoredText(thread.cwd, MAX_STORED_CWD_CHARS),
  messages: thread.messages.slice(-MAX_STORED_MESSAGES).map((message) => ({
    ...message,
    content: truncateStoredText(message.content, MAX_STORED_TEXT_CHARS),
  })),
  preview: truncateStoredText(thread.preview, MAX_STORED_TEXT_CHARS),
  title: truncateStoredText(thread.title, MAX_STORED_TITLE_CHARS),
  tokenUsageLabel: thread.tokenUsageLabel
    ? truncateStoredText(thread.tokenUsageLabel, MAX_STORED_TOKEN_USAGE_CHARS)
    : null,
});

const compactWorkspaceSnapshotForStorage = ({
  activeChatId,
  cachedChats,
  cachedThreadsByChatId,
  chatSettingsByChatId,
  draftsByChatId,
  openChatIds,
}: WorkspaceSnapshot): WorkspaceSnapshot => {
  const threadIds = dedupeIds([activeChatId ?? '', ...openChatIds].filter(isStoredChatId)).slice(0, MAX_STORED_THREADS);
  const compactThreads = Object.fromEntries(
    threadIds.flatMap((chatId) => {
      const thread = cachedThreadsByChatId[chatId];
      return thread ? [[chatId, compactStoredThread(thread)] satisfies [string, ChatThread]] : [];
    }),
  ) as Record<string, ChatThread>;
  const compactChats = dedupeAndSortSummaries([
    ...cachedChats.map(compactStoredSummary),
    ...Object.values(compactThreads).map(summarizeCachedThread).map(compactStoredSummary),
  ]).slice(0, MAX_STORED_CHAT_SUMMARIES);

  return {
    activeChatId,
    cachedChats: compactChats,
    cachedThreadsByChatId: compactThreads,
    chatSettingsByChatId,
    draftsByChatId,
    openChatIds,
  };
};

const dedupeAndSortSummaries = (summaries: ChatSummary[]) => {
  const summaryMap = new Map<string, ChatSummary>();

  summaries.forEach((summary) => {
    const current = summaryMap.get(summary.id);
    if (!current || current.updatedAt.localeCompare(summary.updatedAt) < 0) {
      summaryMap.set(summary.id, summary);
    }
  });

  return [...summaryMap.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const deriveValidChatIds = (snapshot: RawWorkspaceSnapshot) => {
  const ids = new Set<string>();

  if (typeof snapshot.activeChatId === 'string' && snapshot.activeChatId.trim().length > 0) {
    ids.add(snapshot.activeChatId);
  }

  (snapshot.openChatIds ?? []).forEach((chatId) => {
    if (typeof chatId === 'string' && chatId.trim().length > 0) {
      ids.add(chatId);
    }
  });

  Object.keys(snapshot.chatSettingsByChatId ?? {}).forEach((chatId) => ids.add(chatId));
  Object.keys(snapshot.draftsByChatId ?? {}).forEach((chatId) => ids.add(chatId));
  Object.keys(snapshot.cachedThreadsByChatId ?? {}).forEach((chatId) => ids.add(chatId));

  if (Array.isArray(snapshot.cachedChats)) {
    snapshot.cachedChats.forEach((value) => {
      const summary = sanitizeChatSummary(value);
      if (summary) {
        ids.add(summary.id);
      }
    });
  }

  return [...ids];
};

const deriveRecoverableChatIds = (snapshot: RawWorkspaceSnapshot) => {
  const cachedSummaryIds = new Set(
    Array.isArray(snapshot.cachedChats)
      ? snapshot.cachedChats.flatMap((value) => {
          const summary = sanitizeChatSummary(value);
          return summary ? [summary.id] : [];
        })
      : [],
  );

  const hasLocalState = (chatId: string) => {
    if ((snapshot.cachedThreadsByChatId ?? {})[chatId] !== undefined) {
      return true;
    }

    if (cachedSummaryIds.has(chatId)) {
      return true;
    }

    const draft = (snapshot.draftsByChatId ?? {})[chatId];
    if (typeof draft === 'string' && draft.trim().length > 0) {
      return true;
    }

    const settings = (snapshot.chatSettingsByChatId ?? {})[chatId];
    return typeof settings === 'object' && settings !== null;
  };

  const ids = new Set<string>();
  if (isStoredChatId(snapshot.activeChatId) && hasLocalState(snapshot.activeChatId)) {
    ids.add(snapshot.activeChatId);
  }

  (snapshot.openChatIds ?? []).forEach((chatId) => {
    if (isStoredChatId(chatId) && hasLocalState(chatId)) {
      ids.add(chatId);
    }
  });

  return [...ids];
};

export const sanitizeWorkspaceSnapshot = (
  snapshot: RawWorkspaceSnapshot,
  validChatIds: string[] = deriveValidChatIds(snapshot),
): WorkspaceSnapshot => {
  const validIdSet = new Set([...validChatIds, ...deriveRecoverableChatIds(snapshot)]);
  const openChatIds = dedupeIds(snapshot.openChatIds ?? []).filter((chatId) => validIdSet.has(chatId));
  const activeChatId =
    snapshot.activeChatId && validIdSet.has(snapshot.activeChatId) ? snapshot.activeChatId : null;

  if (activeChatId && !openChatIds.includes(activeChatId)) {
    openChatIds.unshift(activeChatId);
  }

  const draftEntries = Object.entries(snapshot.draftsByChatId ?? {}).filter(
    (entry): entry is [string, string] => {
      const [chatId, draft] = entry;
      return validIdSet.has(chatId) && typeof draft === 'string' && draft.length > 0;
    },
  );

  const draftsByChatId = Object.fromEntries(draftEntries) as Record<string, string>;
  const chatSettingsByChatId = Object.fromEntries(
    Object.entries(snapshot.chatSettingsByChatId ?? {}).flatMap(([chatId, value]) => {
      if (!validIdSet.has(chatId) || typeof value !== 'object' || value === null) {
        return [];
      }

      const accessMode =
        'accessMode' in value && (value.accessMode === 'read-only' || value.accessMode === 'workspace-write')
          ? value.accessMode
          : null;
      const approvalPolicy =
        'approvalPolicy' in value &&
        (value.approvalPolicy === 'untrusted' ||
          value.approvalPolicy === 'on-failure' ||
          value.approvalPolicy === 'on-request' ||
          value.approvalPolicy === 'never')
          ? value.approvalPolicy
          : null;
      const model = 'model' in value && typeof value.model === 'string' && value.model.trim().length > 0 ? value.model : null;
      const reasoningEffort =
        'reasoningEffort' in value &&
        (value.reasoningEffort === 'none' ||
          value.reasoningEffort === 'minimal' ||
          value.reasoningEffort === 'low' ||
          value.reasoningEffort === 'medium' ||
          value.reasoningEffort === 'high' ||
          value.reasoningEffort === 'xhigh')
          ? value.reasoningEffort
          : null;

      if (!accessMode) {
        return [];
      }

      return [
        [
          chatId,
          {
            accessMode,
            approvalPolicy,
            model,
            reasoningEffort,
            roots: sanitizeRoots('roots' in value ? value.roots : undefined),
          } satisfies ChatRuntimeSettings,
        ] satisfies [string, ChatRuntimeSettings],
      ];
    }),
  ) as Record<string, ChatRuntimeSettings>;
  const cachedThreadsByChatId = Object.fromEntries(
    Object.entries(snapshot.cachedThreadsByChatId ?? {}).flatMap(([chatId, value]) => {
      if (!validIdSet.has(chatId)) {
        return [];
      }

      const thread = sanitizeChatThread(value);
      if (!thread) {
        return [];
      }

      return [[chatId, thread] satisfies [string, ChatThread]];
    }),
  ) as Record<string, ChatThread>;
  const cachedChats = dedupeAndSortSummaries([
    ...(Array.isArray(snapshot.cachedChats)
      ? snapshot.cachedChats
          .map(sanitizeChatSummary)
          .filter((summary): summary is ChatSummary => Boolean(summary))
          .filter((summary) => validIdSet.has(summary.id))
      : []),
    ...Object.values(cachedThreadsByChatId).map(summarizeCachedThread),
  ]);

  return {
    activeChatId: activeChatId ?? openChatIds[0] ?? null,
    cachedChats,
    cachedThreadsByChatId,
    chatSettingsByChatId,
    draftsByChatId,
    openChatIds,
  };
};

export const loadWorkspaceSnapshot = (validChatIds?: string[]) => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as RawWorkspaceSnapshot;
    return sanitizeWorkspaceSnapshot(parsed, validChatIds);
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
    return null;
  }
};

export const saveWorkspaceSnapshot = ({
  activeChatId,
  cachedChats,
  cachedThreadsByChatId,
  chatSettingsByChatId,
  draftsByChatId,
  openChatIds,
}: WorkspaceSnapshot) => {
  try {
    const compactSnapshot = compactWorkspaceSnapshotForStorage({
      activeChatId,
      cachedChats,
      cachedThreadsByChatId,
      chatSettingsByChatId,
      draftsByChatId,
      openChatIds,
    });

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeChatId: compactSnapshot.activeChatId,
        cachedChats: compactSnapshot.cachedChats,
        cachedThreadsByChatId: compactSnapshot.cachedThreadsByChatId,
        chatSettingsByChatId: Object.fromEntries(
          Object.entries(compactSnapshot.chatSettingsByChatId).filter(([, settings]) => settings.accessMode && settings.roots),
        ),
        draftsByChatId: Object.fromEntries(
          Object.entries(compactSnapshot.draftsByChatId).filter(([, draft]) => draft.trim().length > 0),
        ),
        openChatIds: compactSnapshot.openChatIds,
      } satisfies WorkspaceSnapshot),
    );
  } catch {
    // Ignore storage quota and availability errors.
  }
};
