import { useEffect, useMemo, useState } from 'react';
import type {
  ChatRuntimeSettings,
  ChatSummary,
  ChatThread,
  RemoteAppClient,
  RemoteThreadEvent,
} from '../app/types';
import {
  appendMessageDelta,
  defaultOpenTabs,
  ensureTab,
  replaceOrAppendMessage,
  setTabStatusIfOpen,
  setThreadTokenUsage,
  summarizeThread,
  updateChatSummary,
} from './modexState';
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot } from './workspaceStorage';

interface ModexState {
  activeChatId: string | null;
  chatMap: Record<string, ChatThread>;
  chatSettingsByChatId: Record<string, ChatRuntimeSettings>;
  chats: ChatSummary[];
  draftsByChatId: Record<string, string>;
  error: string | null;
  loading: boolean;
  openTabs: Array<{
    chatId: string;
    status: 'idle' | 'running';
  }>;
}

const DEFAULT_ACCESS_MODE: ChatRuntimeSettings['accessMode'] = 'workspace-write';

const compactText = (text: string) => text.replace(/\s+/g, ' ').trim();
const previewFromContent = (text: string) => compactText(text) || 'Start a new request';

const inferSettings = (
  thread: ChatThread,
  existing?: ChatRuntimeSettings,
): ChatRuntimeSettings => ({
  accessMode: existing?.accessMode ?? DEFAULT_ACCESS_MODE,
  roots: existing?.roots.length ? existing.roots : thread.cwd ? [thread.cwd] : [],
});

const withThreadMetadata = (
  thread: ChatThread,
  updates: Partial<Pick<ChatThread, 'preview' | 'status' | 'tokenUsageLabel' | 'updatedAt'>>,
) => ({
  ...thread,
  ...updates,
});

const applyThread = (current: ModexState, thread: ChatThread): ModexState => ({
  ...current,
  chatMap: {
    ...current.chatMap,
    [thread.id]: thread,
  },
  chatSettingsByChatId: {
    ...current.chatSettingsByChatId,
    [thread.id]: inferSettings(thread, current.chatSettingsByChatId[thread.id]),
  },
  chats: updateChatSummary(current.chats, thread),
  openTabs: setTabStatusIfOpen(current.openTabs, thread.id, thread.status),
});

const applyRemoteEvent = (current: ModexState, event: RemoteThreadEvent): ModexState => {
  switch (event.type) {
    case 'summary': {
      const existingThread = current.chatMap[event.summary.id];
      const chats = current.chats
        .filter((chat) => chat.id !== event.summary.id)
        .concat(event.summary)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      return {
        ...current,
        chats,
        chatMap: existingThread
          ? {
              ...current.chatMap,
              [event.summary.id]: withThreadMetadata(existingThread, {
                preview: event.summary.preview,
                status: event.summary.status,
                updatedAt: event.summary.updatedAt,
              }),
            }
          : current.chatMap,
        openTabs: setTabStatusIfOpen(current.openTabs, event.summary.id, event.summary.status),
      };
    }

    case 'thread':
      return applyThread(current, event.thread);

    case 'status': {
      const chats = current.chats.map((chat) =>
        chat.id === event.chatId
          ? {
              ...chat,
              status: event.status,
            }
          : chat,
      );

      return {
        ...current,
        chats,
        chatMap: current.chatMap[event.chatId]
          ? {
              ...current.chatMap,
              [event.chatId]: withThreadMetadata(current.chatMap[event.chatId], {
                status: event.status,
              }),
            }
          : current.chatMap,
        openTabs: setTabStatusIfOpen(current.openTabs, event.chatId, event.status),
      };
    }

    case 'message-started':
    case 'message-completed': {
      const thread = current.chatMap[event.chatId];
      if (!thread) {
        return current;
      }

      const updatedAt = new Date().toISOString();
      const nextThread = withThreadMetadata(replaceOrAppendMessage(thread, event.message), {
        preview: previewFromContent(event.message.content),
        updatedAt,
      });

      return {
        ...current,
        chatMap: {
          ...current.chatMap,
          [event.chatId]: nextThread,
        },
        chats: updateChatSummary(current.chats, nextThread),
      };
    }

    case 'message-delta': {
      const thread = current.chatMap[event.chatId];
      if (!thread) {
        return current;
      }

      const updatedAt = new Date().toISOString();
      const nextThread = withThreadMetadata(appendMessageDelta(thread, event.messageId, event.delta), {
        updatedAt,
      });
      const lastMessage = nextThread.messages[nextThread.messages.length - 1];
      const normalizedThread = withThreadMetadata(nextThread, {
        preview: lastMessage ? previewFromContent(lastMessage.content) : nextThread.preview,
      });

      return {
        ...current,
        chatMap: {
          ...current.chatMap,
          [event.chatId]: normalizedThread,
        },
        chats: updateChatSummary(current.chats, normalizedThread),
      };
    }

    case 'token-usage': {
      const thread = current.chatMap[event.chatId];
      if (!thread) {
        return current;
      }

      return {
        ...current,
        chatMap: {
          ...current.chatMap,
          [event.chatId]: setThreadTokenUsage(thread, event.label),
        },
      };
    }

    case 'error':
      return {
        ...current,
        error: event.message,
      };

    default:
      return current;
  }
};

export const useModexApp = (client: RemoteAppClient) => {
  const [state, setState] = useState<ModexState>({
    activeChatId: null,
    chatMap: {},
    chatSettingsByChatId: {},
    chats: [],
    draftsByChatId: {},
    error: null,
    loading: true,
    openTabs: [],
  });

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const chats = await client.listChats();
        if (cancelled) {
          return;
        }

        if (chats.length === 0) {
          const created = await client.createChat();
          if (cancelled) {
            return;
          }

          setState({
            activeChatId: created.id,
            chatMap: {
              [created.id]: created,
            },
            chatSettingsByChatId: {
              [created.id]: inferSettings(created),
            },
            chats: [summarizeThread(created)],
            draftsByChatId: {},
            error: null,
            loading: false,
            openTabs: [{ chatId: created.id, status: created.status }],
          });
          return;
        }

        const workspace = loadWorkspaceSnapshot(chats.map((chat) => chat.id));
        const openTabs = workspace
          ? workspace.openChatIds.map((chatId) => ({
              chatId,
              status: chats.find((chat) => chat.id === chatId)?.status ?? 'idle',
            }))
          : defaultOpenTabs(chats);
        const activeChatId = workspace
          ? workspace.activeChatId ?? openTabs[0]?.chatId ?? null
          : openTabs[0]?.chatId ?? chats[0].id;

        const chatIdsToHydrate = [...new Set(openTabs.map((tab) => tab.chatId))];
        const hydratedThreads = (
          await Promise.allSettled(chatIdsToHydrate.map((chatId) => client.getChat(chatId)))
        )
          .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));

        if (cancelled) {
          return;
        }

        const chatMap = Object.fromEntries(
          hydratedThreads.map((thread) => [thread.id, thread] satisfies [string, ChatThread]),
        );
        const hydratedChats = hydratedThreads.reduce(updateChatSummary, chats);
        const chatSettingsByChatId = {
          ...(workspace?.chatSettingsByChatId ?? {}),
        };

        hydratedThreads.forEach((thread) => {
          chatSettingsByChatId[thread.id] = inferSettings(thread, chatSettingsByChatId[thread.id]);
        });

        setState({
          activeChatId,
          chatMap,
          chatSettingsByChatId,
          chats: hydratedChats,
          draftsByChatId: workspace?.draftsByChatId ?? {},
          error: null,
          loading: false,
          openTabs,
        });
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : 'Failed to bootstrap Modex',
            loading: false,
          }));
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => client.subscribe((event) => {
    setState((current) => applyRemoteEvent(current, event));
  }), [client]);

  useEffect(() => {
    if (state.loading) {
      return;
    }

    saveWorkspaceSnapshot({
      activeChatId: state.activeChatId,
      chatSettingsByChatId: state.chatSettingsByChatId,
      draftsByChatId: state.draftsByChatId,
      openChatIds: state.openTabs.map((tab) => tab.chatId),
    });
  }, [state.activeChatId, state.chatSettingsByChatId, state.draftsByChatId, state.loading, state.openTabs]);

  const setDraft = (value: string) => {
    setState((current) => {
      if (!current.activeChatId) {
        return current;
      }

      return {
        ...current,
        draftsByChatId: {
          ...current.draftsByChatId,
          [current.activeChatId]: value,
        },
      };
    });
  };

  const setDraftForChat = (chatId: string, value: string) => {
    setState((current) => ({
      ...current,
      draftsByChatId: {
        ...current.draftsByChatId,
        [chatId]: value,
      },
    }));
  };

  const activateChat = async (chatId: string) => {
    setState((current) => ({
      ...current,
      activeChatId: chatId,
      openTabs: ensureTab(
        current.openTabs,
        chatId,
        current.chats.find((chat) => chat.id === chatId)?.status ?? 'idle',
      ),
    }));

    if (state.chatMap[chatId]) {
      return;
    }

    try {
      const thread = await client.getChat(chatId);
      setState((current) => applyThread(current, thread));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to open chat',
      }));
    }
  };

  const closeTab = (chatId: string) => {
    setState((current) => {
      const openTabs = current.openTabs.filter((tab) => tab.chatId !== chatId);
      const activeChatId =
        current.activeChatId === chatId
          ? openTabs[openTabs.length - 1]?.chatId ?? null
          : current.activeChatId;

      return {
        ...current,
        activeChatId,
        openTabs,
      };
    });
  };

  const createChat = async (settings?: ChatRuntimeSettings) => {
    if (state.loading) {
      return null;
    }

    try {
      const thread = await client.createChat({ settings });
      setState((current) => ({
        ...current,
        activeChatId: thread.id,
        chatMap: {
          ...current.chatMap,
          [thread.id]: thread,
        },
        chatSettingsByChatId: {
          ...current.chatSettingsByChatId,
          [thread.id]: inferSettings(thread, settings),
        },
        chats: updateChatSummary(current.chats, thread),
        draftsByChatId: {
          ...current.draftsByChatId,
          [thread.id]: '',
        },
        error: null,
        openTabs: ensureTab(current.openTabs, thread.id, thread.status),
      }));
      return thread;
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to create chat',
      }));
      return null;
    }
  };

  const setChatSettings = (chatId: string, settings: ChatRuntimeSettings) => {
    setState((current) => ({
      ...current,
      chatSettingsByChatId: {
        ...current.chatSettingsByChatId,
        [chatId]: {
          accessMode: settings.accessMode,
          roots: settings.roots,
        },
      },
    }));
  };

  const sendMessage = async () => {
    const activeDraft = state.activeChatId ? state.draftsByChatId[state.activeChatId] ?? '' : '';
    if (!state.activeChatId || !activeDraft.trim()) {
      return;
    }

    const chatId = state.activeChatId;
    const activeTab = state.openTabs.find((tab) => tab.chatId === chatId);
    if (activeTab?.status === 'running') {
      return;
    }

    const content = activeDraft.trim();
    const optimisticMessageId = `optimistic-${Date.now()}`;
    setState((current) => ({
      ...current,
      error: null,
      openTabs: ensureTab(current.openTabs, chatId, 'running'),
      draftsByChatId: {
        ...current.draftsByChatId,
        [chatId]: '',
      },
      chatMap: current.chatMap[chatId]
        ? {
            ...current.chatMap,
            [chatId]: withThreadMetadata(
              {
                ...current.chatMap[chatId],
                messages: [
                  ...current.chatMap[chatId].messages,
                  {
                    id: optimisticMessageId,
                    role: 'user',
                    content,
                    createdAt: new Date().toISOString(),
                  },
                ],
              },
              {
                preview: previewFromContent(content),
                status: 'running',
                updatedAt: new Date().toISOString(),
              },
            ),
          }
        : current.chatMap,
    }));

    try {
      const thread = await client.sendMessage({
        chatId,
        content,
        settings: state.chatSettingsByChatId[chatId],
      });
      setState((current) => applyThread(current, thread));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to send message',
        draftsByChatId: {
          ...current.draftsByChatId,
          [chatId]: content,
        },
        openTabs: setTabStatusIfOpen(current.openTabs, chatId, 'idle'),
        chatMap: current.chatMap[chatId]
          ? {
              ...current.chatMap,
              [chatId]: withThreadMetadata(
                {
                  ...current.chatMap[chatId],
                  messages: current.chatMap[chatId].messages.filter((message) => message.id !== optimisticMessageId),
                },
                {
                  status: 'idle',
                },
              ),
            }
          : current.chatMap,
      }));
    }
  };

  const activeChat = state.activeChatId ? state.chatMap[state.activeChatId] ?? null : null;
  const activeDraft = state.activeChatId ? state.draftsByChatId[state.activeChatId] ?? '' : '';
  const activeChatSettings = state.activeChatId ? state.chatSettingsByChatId[state.activeChatId] ?? null : null;

  return useMemo(
    () => ({
      ...state,
      activateChat,
      activeChat,
      activeChatSettings,
      closeTab,
      createChat,
      draft: activeDraft,
      sendMessage,
      setChatSettings,
      setDraft,
      setDraftForChat,
    }),
    [activeChat, activeChatSettings, activeDraft, state],
  );
};
