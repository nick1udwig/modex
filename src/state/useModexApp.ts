import { useEffect, useMemo, useState } from 'react';
import type { ChatSummary, ChatTab, ChatThread, RemoteAppClient } from '../app/types';
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot } from './workspaceStorage';

interface ModexState {
  chats: ChatSummary[];
  openTabs: ChatTab[];
  activeChatId: string | null;
  chatMap: Record<string, ChatThread>;
  draftsByChatId: Record<string, string>;
  loading: boolean;
  error: string | null;
}

const ensureTab = (tabs: ChatTab[], chatId: string, status: ChatTab['status'] = 'idle') => {
  if (tabs.some((tab) => tab.chatId === chatId)) {
    return tabs.map((tab) => (tab.chatId === chatId ? { ...tab, status } : tab));
  }

  return [...tabs, { chatId, status }];
};

const setTabStatusIfOpen = (tabs: ChatTab[], chatId: string, status: ChatTab['status']) =>
  tabs.map((tab) => (tab.chatId === chatId ? { ...tab, status } : tab));

const updateChatSummary = (chats: ChatSummary[], thread: ChatThread) => {
  const summary: ChatSummary = {
    id: thread.id,
    title: thread.title,
    updatedAt: thread.updatedAt,
    preview: thread.preview,
  };

  const existing = chats.filter((chat) => chat.id !== thread.id);
  return [summary, ...existing].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const useModexApp = (client: RemoteAppClient) => {
  const [state, setState] = useState<ModexState>({
    chats: [],
    openTabs: [],
    activeChatId: null,
    chatMap: {},
    draftsByChatId: {},
    loading: true,
    error: null,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
            chats: [created],
            openTabs: [{ chatId: created.id, status: 'idle' }],
            activeChatId: created.id,
            chatMap: { [created.id]: created },
            draftsByChatId: {},
            loading: false,
            error: null,
          });
          return;
        }

        const workspace = loadWorkspaceSnapshot(chats.map((chat) => chat.id));
        const openTabs = workspace
          ? workspace.openChatIds.map((chatId) => ({ chatId, status: 'idle' as const }))
          : [{ chatId: chats[0].id, status: 'idle' as const }];
        const activeChatId = workspace ? workspace.activeChatId : chats[0].id;

        const chatMap: Record<string, ChatThread> = {};
        if (activeChatId) {
          const thread = await client.getChat(activeChatId);
          if (cancelled) {
            return;
          }

          chatMap[activeChatId] = thread;
        }

        if (cancelled) {
          return;
        }

        setState({
          chats,
          openTabs,
          activeChatId,
          chatMap,
          draftsByChatId: workspace?.draftsByChatId ?? {},
          loading: false,
          error: null,
        });
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to bootstrap Modex',
          }));
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (state.loading) {
      return;
    }

    saveWorkspaceSnapshot({
      activeChatId: state.activeChatId,
      draftsByChatId: state.draftsByChatId,
      openChatIds: state.openTabs.map((tab) => tab.chatId),
    });
  }, [state.activeChatId, state.draftsByChatId, state.loading, state.openTabs]);

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

  const activateChat = async (chatId: string) => {
    setSidebarOpen(false);
    setState((current) => ({
      ...current,
      activeChatId: chatId,
      openTabs: ensureTab(current.openTabs, chatId),
    }));

    if (state.chatMap[chatId]) {
      return;
    }

    try {
      const thread = await client.getChat(chatId);
      setState((current) => ({
        ...current,
        chatMap: {
          ...current.chatMap,
          [chatId]: thread,
        },
      }));
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
        openTabs,
        activeChatId,
      };
    });
  };

  const createChat = async () => {
    if (state.loading) {
      return;
    }

    try {
      const thread = await client.createChat();
      setState((current) => ({
        ...current,
        chats: updateChatSummary(current.chats, thread),
        openTabs: ensureTab(current.openTabs, thread.id),
        activeChatId: thread.id,
        chatMap: {
          ...current.chatMap,
          [thread.id]: thread,
        },
        draftsByChatId: {
          ...current.draftsByChatId,
          [thread.id]: '',
        },
        error: null,
      }));
      setSidebarOpen(false);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to create chat',
      }));
    }
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
            [chatId]: {
              ...current.chatMap[chatId],
              messages: [
                ...current.chatMap[chatId].messages,
                {
                  id: `optimistic-${Date.now()}`,
                  role: 'user',
                  content,
                  createdAt: new Date().toISOString(),
                },
              ],
            },
          }
        : current.chatMap,
    }));

    try {
      const thread = await client.sendMessage({ chatId, content });
      setState((current) => ({
        ...current,
        chats: updateChatSummary(current.chats, thread),
        openTabs: setTabStatusIfOpen(current.openTabs, chatId, 'idle'),
        chatMap: {
          ...current.chatMap,
          [chatId]: thread,
        },
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to send message',
        openTabs: setTabStatusIfOpen(current.openTabs, chatId, 'idle'),
      }));
    }
  };

  const activeChat = state.activeChatId ? state.chatMap[state.activeChatId] ?? null : null;
  const activeDraft = state.activeChatId ? state.draftsByChatId[state.activeChatId] ?? '' : '';

  return useMemo(
    () => ({
      ...state,
      activeChat,
      draft: activeDraft,
      sidebarOpen,
      setDraft,
      setSidebarOpen,
      activateChat,
      closeTab,
      createChat,
      sendMessage,
    }),
    [activeChat, activeDraft, sidebarOpen, state],
  );
};
