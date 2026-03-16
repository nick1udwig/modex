import type { ChatSummary, ChatTab, ChatThread, Message } from '../app/types';

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
