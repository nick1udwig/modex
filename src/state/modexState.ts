import type { ActivityEntry, ActivityStatus, ChatStatus, ChatSummary, ChatTab, ChatThread, Message } from '../app/types';

export const mergeThreadSummary = (thread: ChatThread, summary: ChatSummary): ChatThread => ({
  ...thread,
  cwd: summary.cwd,
  preview: summary.preview,
  status: summary.status,
  title: summary.title,
  updatedAt: summary.updatedAt,
});

const hasTransientLocalMessages = (thread: Pick<ChatThread, 'messages'>) =>
  thread.messages.some((message) => message.id.startsWith('optimistic-') || (message.role === 'assistant' && message.turnId === null));

const ACTIVITY_STATUS_PRIORITY: Record<ActivityStatus, number> = {
  completed: 2,
  failed: 2,
  'in-progress': 1,
};

const compactActivitySummary = (text: string) => text.replace(/\s+/g, ' ').trim();
const isActiveChatStatus = (status: ChatStatus) => status !== 'idle';

export const mergeBootstrapThread = (hydrated: ChatThread, current?: ChatThread): ChatThread => {
  if (!current) {
    return hydrated;
  }

  const keepCurrentLiveState =
    hasTransientLocalMessages(current) || current.updatedAt.localeCompare(hydrated.updatedAt) > 0;

  if (!keepCurrentLiveState) {
    return hydrated;
  }

  return {
    ...hydrated,
    activity: current.activity,
    messages: current.messages,
    preview: current.preview,
    status: current.status,
    tokenUsageLabel: current.tokenUsageLabel ?? hydrated.tokenUsageLabel,
    updatedAt: current.updatedAt,
  };
};

const mergeActivityEntry = (current: ActivityEntry, incoming: ActivityEntry): ActivityEntry => {
  const detail = incoming.detail.length >= current.detail.length ? incoming.detail : current.detail;
  const summary = compactActivitySummary(detail) || incoming.summary || current.summary;
  const status =
    ACTIVITY_STATUS_PRIORITY[incoming.status] >= ACTIVITY_STATUS_PRIORITY[current.status] ? incoming.status : current.status;

  return {
    ...current,
    ...incoming,
    detail,
    status,
    summary,
    title: incoming.title || current.title,
  };
};

export const deriveLiveActivity = (thread: Pick<ChatThread, 'activity' | 'status'>) =>
  isActiveChatStatus(thread.status) ? thread.activity.filter((entry) => entry.status === 'in-progress') : [];

export const downgradeMissingThread = (thread: ChatThread): ChatThread => ({
  ...thread,
  status: 'idle',
});

export const sanitizeBootstrapThread = (thread: ChatThread): ChatThread => {
  if (!isActiveChatStatus(thread.status)) {
    return thread;
  }

  if (deriveLiveActivity(thread).length > 0 || hasTransientLocalMessages(thread)) {
    return thread;
  }

  return downgradeMissingThread(thread);
};

export const shouldHoldIdleStatusUntilThreadSync = (
  thread: Pick<ChatThread, 'messages' | 'status'> | undefined,
  liveActivity: ActivityEntry[] | undefined,
  nextStatus: ChatStatus,
) => nextStatus === 'idle' && Boolean(thread && isActiveChatStatus(thread.status) && (liveActivity?.length ?? 0) > 0);

export const upsertLiveActivity = (entries: ActivityEntry[], incoming: ActivityEntry) => {
  const index = entries.findIndex((entry) => entry.id === incoming.id);
  if (index === -1) {
    return [...entries, incoming];
  }

  return entries.map((entry, entryIndex) => (entryIndex === index ? mergeActivityEntry(entry, incoming) : entry));
};

export const mergeLiveActivity = (current: ActivityEntry[], incoming: ActivityEntry[]) => {
  const turnId = incoming[incoming.length - 1]?.turnId ?? current[current.length - 1]?.turnId ?? null;
  const currentEntries = turnId ? current.filter((entry) => entry.turnId === turnId) : current;
  const incomingEntries = turnId ? incoming.filter((entry) => entry.turnId === turnId) : incoming;

  return incomingEntries.reduce(upsertLiveActivity, currentEntries);
};

export const appendLiveActivityDelta = (
  entries: ActivityEntry[],
  payload: {
    delta: string;
    entryId: string;
    turnId: string;
  },
) => {
  const existing = entries.find((entry) => entry.id === payload.entryId);
  const detail = `${existing?.detail ?? ''}${payload.delta}`;

  return upsertLiveActivity(entries, {
    detail,
    id: payload.entryId,
    kind: existing?.kind ?? 'commentary',
    status: existing?.status ?? 'in-progress',
    summary: compactActivitySummary(detail),
    title: existing?.title ?? 'Agent reply',
    turnId: existing?.turnId ?? payload.turnId,
  });
};

export const ensureTab = (
  tabs: ChatTab[],
  chatId: string,
  status: ChatTab['status'] = 'idle',
  options?: {
    hasUnreadCompletion?: boolean;
  },
) => {
  if (tabs.some((tab) => tab.chatId === chatId)) {
    return tabs.map((tab) =>
      tab.chatId === chatId
        ? {
            ...tab,
            hasUnreadCompletion: options?.hasUnreadCompletion ?? tab.hasUnreadCompletion,
            status,
          }
        : tab,
    );
  }

  return [
    ...tabs,
    {
      chatId,
      hasUnreadCompletion: options?.hasUnreadCompletion ?? false,
      status,
    },
  ];
};

export const setTabStatusIfOpen = (tabs: ChatTab[], chatId: string, status: ChatTab['status']) =>
  tabs.map((tab) => (tab.chatId === chatId ? { ...tab, status } : tab));

export const setTabUnreadIfOpen = (tabs: ChatTab[], chatId: string, hasUnreadCompletion: boolean) =>
  tabs.map((tab) => (tab.chatId === chatId ? { ...tab, hasUnreadCompletion } : tab));

export const updateChatSummary = (chats: ChatSummary[], thread: ChatThread) => {
  const summary = summarizeThread(thread);

  const existing = chats.filter((chat) => chat.id !== thread.id);
  return [summary, ...existing].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const summarizeThread = (thread: ChatThread): ChatSummary => ({
  cwd: thread.cwd,
  id: thread.id,
  preview: thread.preview,
  status: thread.status,
  title: thread.title,
  updatedAt: thread.updatedAt,
});

export const replaceOrAppendMessage = (thread: ChatThread, message: Message): ChatThread => {
  const existingIndex = thread.messages.findIndex((entry) => entry.id === message.id);
  if (existingIndex >= 0) {
    return {
      ...thread,
      messages: thread.messages.map((entry) => (entry.id === message.id ? message : entry)),
    };
  }

  const optimisticIndex = [...thread.messages]
    .reverse()
    .findIndex((entry) => entry.id.startsWith('optimistic-') && entry.role === message.role && entry.content === message.content);

  if (optimisticIndex >= 0) {
    const index = thread.messages.length - optimisticIndex - 1;
    return {
      ...thread,
      messages: thread.messages.map((entry, entryIndex) => (entryIndex === index ? message : entry)),
    };
  }

  return {
    ...thread,
    messages: [...thread.messages, message],
  };
};

export const appendMessageDelta = (thread: ChatThread, messageId: string, delta: string): ChatThread => {
  const index = thread.messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    return {
      ...thread,
      messages: [
        ...thread.messages,
        {
          content: delta,
          createdAt: new Date().toISOString(),
          id: messageId,
          role: 'assistant',
          turnId: null,
        },
      ],
    };
  }

  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            content: `${message.content}${delta}`,
          }
        : message,
    ),
  };
};

export const setThreadTokenUsage = (thread: ChatThread, label: string | null): ChatThread => ({
  ...thread,
  tokenUsageLabel: label,
});

export const defaultOpenTabs = (chats: ChatSummary[]) =>
  chats.slice(0, Math.min(chats.length, 2)).map((chat) => ({
    chatId: chat.id,
    hasUnreadCompletion: false,
    status: chat.status,
  }));
