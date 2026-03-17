import { useEffect, useMemo, useState } from 'react';
import type {
  ApprovalDecision,
  ChatTab,
  ChatRuntimeSettings,
  InteractionRequest,
  ChatSummary,
  ChatThread,
  PendingAttachment,
  RemoteAppClient,
  RemoteThreadEvent,
} from '../app/types';
import {
  appendMessageDelta,
  defaultOpenTabs,
  ensureTab,
  mergeThreadSummary,
  replaceOrAppendMessage,
  setTabStatusIfOpen,
  setTabUnreadIfOpen,
  setThreadTokenUsage,
  summarizeThread,
  updateChatSummary,
} from './modexState';
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot } from './workspaceStorage';

interface ModexState {
  activeChatId: string | null;
  attachmentsByChatId: Record<string, PendingAttachment[]>;
  chatMap: Record<string, ChatThread>;
  chatSettingsByChatId: Record<string, ChatRuntimeSettings>;
  chats: ChatSummary[];
  draftsByChatId: Record<string, string>;
  error: string | null;
  interactionByChatId: Record<string, InteractionRequest | undefined>;
  loading: boolean;
  openTabs: ChatTab[];
}

const DEFAULT_ACCESS_MODE: ChatRuntimeSettings['accessMode'] = 'workspace-write';
const bootstrapWorkspace = () => {
  const workspace = loadWorkspaceSnapshot();
  if (!workspace) {
    return null;
  }

  const cachedStatusByChatId = new Map(workspace.cachedChats.map((chat) => [chat.id, chat.status] satisfies [string, ChatSummary['status']]));
  const openTabs = workspace.openChatIds.map((chatId) => ({
    chatId,
    hasUnreadCompletion: false,
    status: workspace.cachedThreadsByChatId[chatId]?.status ?? cachedStatusByChatId.get(chatId) ?? 'idle',
  }));

  return {
    activeChatId: workspace.activeChatId ?? openTabs[0]?.chatId ?? workspace.cachedChats[0]?.id ?? null,
    attachmentsByChatId: {},
    chatMap: workspace.cachedThreadsByChatId,
    chatSettingsByChatId: workspace.chatSettingsByChatId,
    chats: workspace.cachedChats,
    draftsByChatId: workspace.draftsByChatId,
    error: null,
    interactionByChatId: {},
    loading: true,
    openTabs,
  } satisfies ModexState;
};

const compactText = (text: string) => text.replace(/\s+/g, ' ').trim();
const previewFromContent = (text: string) => compactText(text) || 'Start a new request';

const mergeSummaryLists = (...lists: ChatSummary[][]) => {
  const summaries = new Map<string, ChatSummary>();

  lists.forEach((list) => {
    list.forEach((summary) => {
      const current = summaries.get(summary.id);
      if (!current || current.updatedAt.localeCompare(summary.updatedAt) < 0) {
        summaries.set(summary.id, summary);
      }
    });
  });

  return [...summaries.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

const inferSettings = (
  thread: ChatThread,
  existing?: ChatRuntimeSettings,
): ChatRuntimeSettings => ({
  accessMode: existing?.accessMode ?? DEFAULT_ACCESS_MODE,
  model: existing?.model ?? null,
  reasoningEffort: existing?.reasoningEffort ?? null,
  roots: existing?.roots.length ? existing.roots : thread.cwd ? [thread.cwd] : [],
});

const optimisticPreviewFromInputs = (content: string, attachments: PendingAttachment[]) => {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  const attachmentLines = attachments.map((attachment) =>
    attachment.kind === 'image' ? `[Image] ${attachment.name}` : `[File] ${attachment.name}`,
  );
  return [normalizedContent, ...attachmentLines].filter((entry) => entry.length > 0).join('\n') || 'Start a new request';
};

const withThreadMetadata = (
  thread: ChatThread,
  updates: Partial<Pick<ChatThread, 'preview' | 'status' | 'tokenUsageLabel' | 'updatedAt'>>,
) => ({
  ...thread,
  ...updates,
});

const clearInteractionForChat = (
  interactions: Record<string, InteractionRequest | undefined>,
  chatId: string,
) => {
  if (!(chatId in interactions)) {
    return interactions;
  }

  const next = {
    ...interactions,
  };
  delete next[chatId];
  return next;
};

const clearInteractionRequest = (
  interactions: Record<string, InteractionRequest | undefined>,
  request: Pick<InteractionRequest, 'chatId' | 'requestId' | 'turnId'>,
) => {
  const activeRequest = interactions[request.chatId];
  if (!activeRequest || activeRequest.requestId !== request.requestId || activeRequest.turnId !== request.turnId) {
    return interactions;
  }

  return clearInteractionForChat(interactions, request.chatId);
};

const shouldMarkUnreadCompletion = (
  current: ModexState,
  chatId: string,
  nextStatus: ChatThread['status'],
) =>
  nextStatus === 'idle' &&
  current.activeChatId !== chatId &&
  current.openTabs.some((tab) => tab.chatId === chatId && tab.status === 'running');

const applyThread = (current: ModexState, thread: ChatThread): ModexState => {
  const shouldMarkUnread = shouldMarkUnreadCompletion(current, thread.id, thread.status);
  const openTabs = shouldMarkUnread
    ? setTabUnreadIfOpen(setTabStatusIfOpen(current.openTabs, thread.id, thread.status), thread.id, true)
    : setTabStatusIfOpen(current.openTabs, thread.id, thread.status);

  return {
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
    interactionByChatId:
      thread.status === 'idle' ? clearInteractionForChat(current.interactionByChatId, thread.id) : current.interactionByChatId,
    openTabs,
  };
};

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
        interactionByChatId:
          event.status === 'idle'
            ? clearInteractionForChat(current.interactionByChatId, event.chatId)
            : current.interactionByChatId,
        openTabs: shouldMarkUnreadCompletion(current, event.chatId, event.status)
          ? setTabUnreadIfOpen(setTabStatusIfOpen(current.openTabs, event.chatId, event.status), event.chatId, true)
          : setTabStatusIfOpen(current.openTabs, event.chatId, event.status),
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

    case 'interaction-request':
      return {
        ...current,
        error: null,
        interactionByChatId: {
          ...current.interactionByChatId,
          [event.request.chatId]: event.request,
        },
      };

    case 'interaction-cleared':
      return {
        ...current,
        interactionByChatId:
          event.requestId === undefined || event.turnId === undefined
            ? clearInteractionForChat(current.interactionByChatId, event.chatId)
            : clearInteractionRequest(current.interactionByChatId, {
                chatId: event.chatId,
                requestId: event.requestId,
                turnId: event.turnId,
              }),
      };

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
  const [state, setState] = useState<ModexState>(
    () =>
      bootstrapWorkspace() ?? {
        activeChatId: null,
        attachmentsByChatId: {},
        chatMap: {},
        chatSettingsByChatId: {},
        chats: [],
        draftsByChatId: {},
        error: null,
        interactionByChatId: {},
        loading: true,
        openTabs: [],
      },
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const chats = await client.listChats();
        if (cancelled) {
          return;
        }

        const workspace = loadWorkspaceSnapshot(chats.map((chat) => chat.id));
        const seedChats = mergeSummaryLists(chats, workspace?.cachedChats ?? []);

        if (seedChats.length === 0) {
          const created = await client.createChat();
          if (cancelled) {
            return;
          }

          setState({
            activeChatId: created.id,
            attachmentsByChatId: {},
            chatMap: {
              [created.id]: created,
            },
            chatSettingsByChatId: {
              [created.id]: inferSettings(created),
            },
            chats: [summarizeThread(created)],
            draftsByChatId: {},
            error: null,
            interactionByChatId: {},
            loading: false,
            openTabs: [{ chatId: created.id, hasUnreadCompletion: false, status: created.status }],
          });
          return;
        }

        const openTabs = workspace
          ? workspace.openChatIds.map((chatId) => ({
              chatId,
              hasUnreadCompletion: false,
              status:
                seedChats.find((chat) => chat.id === chatId)?.status ??
                workspace.cachedThreadsByChatId[chatId]?.status ??
                'idle',
            }))
          : defaultOpenTabs(seedChats);
        const activeChatId = workspace
          ? workspace.activeChatId ?? openTabs[0]?.chatId ?? seedChats[0]?.id ?? null
          : openTabs[0]?.chatId ?? seedChats[0]?.id ?? null;

        const chatIdsToHydrate = [
          ...new Set([activeChatId, ...openTabs.map((tab) => tab.chatId)].filter((chatId): chatId is string => Boolean(chatId))),
        ];
        const hydratedThreads = (
          await Promise.allSettled(chatIdsToHydrate.map((chatId) => client.getChat(chatId)))
        )
          .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));

        if (cancelled) {
          return;
        }

        const hydratedChats = hydratedThreads.reduce(updateChatSummary, seedChats);
        const summaryByChatId = new Map(hydratedChats.map((chat) => [chat.id, chat] satisfies [string, ChatSummary]));
        const cachedThreads = Object.fromEntries(
          Object.entries(workspace?.cachedThreadsByChatId ?? {}).map(([chatId, thread]) => {
            const summary = summaryByChatId.get(chatId);
            return [chatId, summary ? mergeThreadSummary(thread, summary) : thread] satisfies [string, ChatThread];
          }),
        );
        const chatMap = {
          ...cachedThreads,
          ...Object.fromEntries(
            hydratedThreads.map((thread) => [thread.id, thread] satisfies [string, ChatThread]),
          ),
        };
        const chatSettingsByChatId = {
          ...(workspace?.chatSettingsByChatId ?? {}),
        };

        hydratedThreads.forEach((thread) => {
          chatSettingsByChatId[thread.id] = inferSettings(thread, chatSettingsByChatId[thread.id]);
        });

        setState({
          activeChatId,
          attachmentsByChatId: {},
          chatMap,
          chatSettingsByChatId,
          chats: hydratedChats,
          draftsByChatId: workspace?.draftsByChatId ?? {},
          error: null,
          interactionByChatId: {},
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
      cachedChats: state.chats,
      cachedThreadsByChatId: state.chatMap,
      chatSettingsByChatId: state.chatSettingsByChatId,
      draftsByChatId: state.draftsByChatId,
      openChatIds: state.openTabs.map((tab) => tab.chatId),
    });
  }, [
    state.activeChatId,
    state.chatMap,
    state.chatSettingsByChatId,
    state.chats,
    state.draftsByChatId,
    state.loading,
    state.openTabs,
  ]);

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
      openTabs: setTabUnreadIfOpen(
        ensureTab(current.openTabs, chatId, current.chats.find((chat) => chat.id === chatId)?.status ?? 'idle'),
        chatId,
        false,
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
        openTabs: ensureTab(current.openTabs, thread.id, thread.status, {
          hasUnreadCompletion: false,
        }),
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
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          roots: settings.roots,
        },
      },
    }));
  };

  const addAttachments = (chatId: string, attachments: PendingAttachment[]) => {
    if (attachments.length === 0) {
      return;
    }

    setState((current) => ({
      ...current,
      attachmentsByChatId: {
        ...current.attachmentsByChatId,
        [chatId]: [...(current.attachmentsByChatId[chatId] ?? []), ...attachments],
      },
    }));
  };

  const removeAttachment = (chatId: string, attachmentId: string) => {
    setState((current) => ({
      ...current,
      attachmentsByChatId: {
        ...current.attachmentsByChatId,
        [chatId]: (current.attachmentsByChatId[chatId] ?? []).filter((attachment) => attachment.id !== attachmentId),
      },
    }));
  };

  const sendMessage = async () => {
    const activeDraft = state.activeChatId ? state.draftsByChatId[state.activeChatId] ?? '' : '';
    const activeAttachments = state.activeChatId ? state.attachmentsByChatId[state.activeChatId] ?? [] : [];
    if (!state.activeChatId || (!activeDraft.trim() && activeAttachments.length === 0)) {
      return;
    }

    const chatId = state.activeChatId;
    const activeTab = state.openTabs.find((tab) => tab.chatId === chatId);
    if (activeTab?.status === 'running') {
      return;
    }

    const content = activeDraft.trim();
    const optimisticContent = optimisticPreviewFromInputs(content, activeAttachments);
    const optimisticMessageId = `optimistic-${Date.now()}`;
    setState((current) => ({
      ...current,
      attachmentsByChatId: {
        ...current.attachmentsByChatId,
        [chatId]: [],
      },
      error: null,
      openTabs: ensureTab(current.openTabs, chatId, 'running', {
        hasUnreadCompletion: false,
      }),
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
                    content: optimisticContent,
                    createdAt: new Date().toISOString(),
                    turnId: null,
                  },
                ],
              },
              {
                preview: previewFromContent(optimisticContent),
                status: 'running',
                updatedAt: new Date().toISOString(),
              },
            ),
          }
        : current.chatMap,
    }));

    try {
      const thread = await client.sendMessage({
        attachments: activeAttachments,
        chatId,
        content,
        settings: state.chatSettingsByChatId[chatId],
      });
      setState((current) => applyThread(current, thread));
    } catch (error) {
      setState((current) => ({
        ...current,
        attachmentsByChatId: {
          ...current.attachmentsByChatId,
          [chatId]: activeAttachments,
        },
        error: error instanceof Error ? error.message : 'Unable to send message',
        draftsByChatId: {
          ...current.draftsByChatId,
          [chatId]: content,
        },
        openTabs: setTabStatusIfOpen(current.openTabs, chatId, 'idle'),
        chatMap: current.chatMap[chatId]
          ? {
              ...current.chatMap,
              [chatId]: withThreadMetadata(current.chatMap[chatId], {
                status: 'idle',
              }),
            }
          : current.chatMap,
      }));
    }
  };

  const interruptTurn = async () => {
    const chatId = state.activeChatId;
    if (!chatId) {
      return;
    }

    try {
      await client.interruptTurn(chatId);
      setState((current) => ({
        ...current,
        error: null,
        interactionByChatId: clearInteractionForChat(current.interactionByChatId, chatId),
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to stop the active run',
      }));
    }
  };

  const respondToApproval = async (decision: ApprovalDecision) => {
    const activeRequest = state.activeChatId ? state.interactionByChatId[state.activeChatId] : null;
    if (!activeRequest || activeRequest.kind !== 'approval') {
      return;
    }

    try {
      await client.respondToApproval(activeRequest, decision);
      setState((current) => ({
        ...current,
        error: null,
        interactionByChatId: clearInteractionRequest(current.interactionByChatId, activeRequest),
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to answer the approval request',
      }));
    }
  };

  const submitUserInput = async (answers: Record<string, string[]>) => {
    const activeRequest = state.activeChatId ? state.interactionByChatId[state.activeChatId] : null;
    if (!activeRequest || activeRequest.kind !== 'user-input') {
      return;
    }

    try {
      await client.submitUserInput(activeRequest, answers);
      setState((current) => ({
        ...current,
        error: null,
        interactionByChatId: clearInteractionRequest(current.interactionByChatId, activeRequest),
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to answer the request',
      }));
    }
  };

  const activeChat = state.activeChatId ? state.chatMap[state.activeChatId] ?? null : null;
  const activeAttachments = state.activeChatId ? state.attachmentsByChatId[state.activeChatId] ?? [] : [];
  const activeDraft = state.activeChatId ? state.draftsByChatId[state.activeChatId] ?? '' : '';
  const activeChatSettings = state.activeChatId ? state.chatSettingsByChatId[state.activeChatId] ?? null : null;
  const activeInteraction = state.activeChatId ? state.interactionByChatId[state.activeChatId] ?? null : null;

  return useMemo(
    () => ({
      ...state,
      activateChat,
      activeChat,
      activeAttachments,
      activeChatSettings,
      activeInteraction,
      addAttachments,
      closeTab,
      createChat,
      draft: activeDraft,
      interruptTurn,
      removeAttachment,
      respondToApproval,
      sendMessage,
      setChatSettings,
      setDraft,
      setDraftForChat,
      submitUserInput,
    }),
    [activeChat, activeChatSettings, activeDraft, activeInteraction, state],
  );
};
