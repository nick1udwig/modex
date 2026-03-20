import { useEffect, useMemo, useState } from 'react';
import type {
  ActivityEntry,
  ApprovalDecision,
  ChatRuntimeSettings,
  InteractionRequest,
  ChatSummary,
  ChatThread,
  PendingAttachment,
  RemoteAppClient,
  RemoteTerminalClient,
  RemoteThreadEvent,
  TerminalSessionSummary,
  WorkspaceTab,
} from '../app/types';
import { chatTabId, createChatTab, createTerminalTab, isChatTab, isTerminalTab } from '../app/tabs';
import { isChatActiveStatus } from '../app/chatStatus';
import {
  appendMessageDelta,
  appendLiveActivityDelta,
  defaultOpenTabs,
  deriveLiveActivity,
  downgradeMissingThread,
  mergeLiveActivity,
  mergeBootstrapThread,
  mergeThreadSummary,
  replaceOrAppendMessage,
  sanitizeBootstrapThread,
  setThreadTokenUsage,
  shouldHoldIdleStatusUntilThreadSync,
  summarizeThread,
  upsertLiveActivity,
  updateChatSummary,
} from './modexState';
import { isAppServerThreadNotFoundError } from '../services/appServerClient';
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot } from './workspaceStorage';
import {
  ensureChatWorkspaceTab,
  ensureTerminalWorkspaceTab,
  setChatTabStatusIfOpen,
  setChatTabUnreadIfOpen,
  setTerminalTabStatusIfOpen,
} from './workspaceTabs';

interface ModexState {
  activeTabId: string | null;
  activeChatId: string | null;
  attachmentsByChatId: Record<string, PendingAttachment[]>;
  chatMap: Record<string, ChatThread>;
  chatSettingsByChatId: Record<string, ChatRuntimeSettings>;
  chats: ChatSummary[];
  draftsByChatId: Record<string, string>;
  error: string | null;
  interactionByChatId: Record<string, InteractionRequest | undefined>;
  liveActivityByChatId: Record<string, ActivityEntry[]>;
  loading: boolean;
  openTabs: WorkspaceTab[];
  terminalSessionsById: Record<string, TerminalSessionSummary>;
}

const DEFAULT_ACCESS_MODE: ChatRuntimeSettings['accessMode'] = 'workspace-write';
const bootstrapWorkspace = () => {
  const workspace = loadWorkspaceSnapshot();
  if (!workspace) {
    return null;
  }

  const cachedThreadsByChatId = Object.fromEntries(
    Object.entries(workspace.cachedThreadsByChatId).map(([chatId, thread]) => [chatId, sanitizeBootstrapThread(thread)] satisfies [string, ChatThread]),
  );
  const cachedChats = workspace.cachedChats.map((chat) => ({
    ...chat,
    status: cachedThreadsByChatId[chat.id]?.status ?? chat.status,
  }));
  const cachedStatusByChatId = new Map(cachedChats.map((chat) => [chat.id, chat.status] satisfies [string, ChatSummary['status']]));
  const terminalSessionsById = workspace.cachedTerminalSessionsById;
  const openTabs = workspace.openTabs.map((tab) => {
    if (isChatTab(tab)) {
      return createChatTab(tab.chatId, cachedThreadsByChatId[tab.chatId]?.status ?? cachedStatusByChatId.get(tab.chatId) ?? tab.status, {
        hasUnreadCompletion: tab.hasUnreadCompletion,
      });
    }

    return createTerminalTab(tab.sessionId, terminalSessionsById[tab.sessionId]?.status ?? tab.status);
  });
  const activeTabId = workspace.activeTabId ?? openTabs[0]?.id ?? (cachedChats[0] ? chatTabId(cachedChats[0].id) : null);
  const activeChatId =
    activeTabId && openTabs.some((tab) => tab.id === activeTabId && isChatTab(tab))
      ? ((openTabs.find((tab) => tab.id === activeTabId) as ReturnType<typeof createChatTab> | undefined)?.chatId ?? null)
      : null;

  return {
    activeChatId,
    activeTabId,
    attachmentsByChatId: {},
    chatMap: cachedThreadsByChatId,
    chatSettingsByChatId: workspace.chatSettingsByChatId,
    chats: cachedChats,
    draftsByChatId: workspace.draftsByChatId,
    error: null,
    interactionByChatId: {},
    liveActivityByChatId: Object.fromEntries(
      Object.entries(cachedThreadsByChatId).flatMap(([chatId, thread]) => {
        const liveActivity = deriveLiveActivity(thread);
        return liveActivity.length > 0 ? [[chatId, liveActivity] satisfies [string, ActivityEntry[]]] : [];
      }),
    ),
    loading: true,
    openTabs,
    terminalSessionsById,
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
  approvalPolicy: existing?.approvalPolicy ?? null,
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

const clearLiveActivityForChat = (
  liveActivityByChatId: Record<string, ActivityEntry[]>,
  chatId: string,
) => {
  if (!(chatId in liveActivityByChatId)) {
    return liveActivityByChatId;
  }

  const next = {
    ...liveActivityByChatId,
  };
  delete next[chatId];
  return next;
};

const activeChatIdForTab = (activeTabId: string | null, openTabs: WorkspaceTab[]) => {
  if (!activeTabId) {
    return null;
  }

  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  return activeTab && isChatTab(activeTab) ? activeTab.chatId : null;
};

const shouldMarkUnreadCompletion = (
  current: ModexState,
  chatId: string,
  nextStatus: ChatThread['status'],
) =>
  nextStatus === 'idle' &&
  current.activeChatId !== chatId &&
  current.openTabs.some((tab) => isChatTab(tab) && tab.chatId === chatId && isChatActiveStatus(tab.status));

const applyThread = (current: ModexState, thread: ChatThread): ModexState => {
  const shouldMarkUnread = shouldMarkUnreadCompletion(current, thread.id, thread.status);
  const openTabs = shouldMarkUnread
    ? setChatTabUnreadIfOpen(setChatTabStatusIfOpen(current.openTabs, thread.id, thread.status), thread.id, true)
    : setChatTabStatusIfOpen(current.openTabs, thread.id, thread.status);
  const backendLiveActivity = deriveLiveActivity(thread);
  const liveActivityByChatId =
    isChatActiveStatus(thread.status)
      ? {
          ...current.liveActivityByChatId,
          [thread.id]: mergeLiveActivity(current.liveActivityByChatId[thread.id] ?? [], backendLiveActivity),
        }
      : clearLiveActivityForChat(current.liveActivityByChatId, thread.id);

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
    liveActivityByChatId,
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
        openTabs: setChatTabStatusIfOpen(current.openTabs, event.summary.id, event.summary.status),
      };
    }

    case 'thread':
      return applyThread(current, event.thread);

    case 'status': {
      const holdIdleStatus = shouldHoldIdleStatusUntilThreadSync(
        current.chatMap[event.chatId],
        current.liveActivityByChatId[event.chatId],
        event.status,
      );
      const effectiveStatus = holdIdleStatus ? current.chatMap[event.chatId]?.status ?? 'running' : event.status;
      const chats = current.chats.map((chat) =>
        chat.id === event.chatId
          ? {
              ...chat,
              status: effectiveStatus,
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
                status: effectiveStatus,
              }),
            }
          : current.chatMap,
        interactionByChatId:
          effectiveStatus === 'idle'
            ? clearInteractionForChat(current.interactionByChatId, event.chatId)
            : current.interactionByChatId,
        liveActivityByChatId:
          effectiveStatus === 'idle'
            ? clearLiveActivityForChat(current.liveActivityByChatId, event.chatId)
            : current.liveActivityByChatId,
        openTabs: shouldMarkUnreadCompletion(current, event.chatId, effectiveStatus)
          ? setChatTabUnreadIfOpen(setChatTabStatusIfOpen(current.openTabs, event.chatId, effectiveStatus), event.chatId, true)
          : setChatTabStatusIfOpen(current.openTabs, event.chatId, effectiveStatus),
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

    case 'activity-upsert':
      return {
        ...current,
        liveActivityByChatId: {
          ...current.liveActivityByChatId,
          [event.chatId]: upsertLiveActivity(current.liveActivityByChatId[event.chatId] ?? [], event.entry),
        },
      };

    case 'activity-delta':
      return {
        ...current,
        liveActivityByChatId: {
          ...current.liveActivityByChatId,
          [event.chatId]: appendLiveActivityDelta(current.liveActivityByChatId[event.chatId] ?? [], {
            delta: event.delta,
            entryId: event.entryId,
            turnId: event.turnId,
          }),
        },
      };

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

export const useModexApp = (client: RemoteAppClient, terminalClient: RemoteTerminalClient) => {
  const [state, setState] = useState<ModexState>(
    () =>
      bootstrapWorkspace() ?? {
        activeTabId: null,
        activeChatId: null,
        attachmentsByChatId: {},
        chatMap: {},
        chatSettingsByChatId: {},
        chats: [],
        draftsByChatId: {},
        error: null,
        interactionByChatId: {},
        liveActivityByChatId: {},
        loading: true,
        openTabs: [],
        terminalSessionsById: {},
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

        if (seedChats.length === 0 && (workspace?.openTabs.length ?? 0) === 0) {
          const created = await client.createChat();
          if (cancelled) {
            return;
          }

          setState({
            activeTabId: chatTabId(created.id),
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
            liveActivityByChatId: {},
            loading: false,
            openTabs: [createChatTab(created.id, created.status)],
            terminalSessionsById: workspace?.cachedTerminalSessionsById ?? {},
          });
          return;
        }

        const openChatTabs = workspace
          ? workspace.openTabs.flatMap((tab) =>
              isChatTab(tab)
                ? [
                    createChatTab(
                      tab.chatId,
                      seedChats.find((chat) => chat.id === tab.chatId)?.status ??
                        workspace.cachedThreadsByChatId[tab.chatId]?.status ??
                        tab.status,
                      {
                        hasUnreadCompletion: tab.hasUnreadCompletion,
                      },
                    ),
                  ]
                : [],
            )
          : defaultOpenTabs(seedChats);
        const activeChatId = workspace
          ? activeChatIdForTab(workspace.activeTabId, workspace.openTabs) ?? openChatTabs[0]?.chatId ?? seedChats[0]?.id ?? null
          : openChatTabs[0]?.chatId ?? seedChats[0]?.id ?? null;

        const chatIdsToHydrate = [
          ...new Set([activeChatId, ...openChatTabs.map((tab) => tab.chatId)].filter((chatId): chatId is string => Boolean(chatId))),
        ];
        const hydratedResults = await Promise.allSettled(chatIdsToHydrate.map((chatId) => client.getChat(chatId)));
        const missingHydrationChatIds = new Set<string>();
        const hydratedThreads = hydratedResults.flatMap((result, index) => {
          if (result.status === 'fulfilled') {
            return [result.value];
          }

          if (isAppServerThreadNotFoundError(result.reason)) {
            const missingChatId = chatIdsToHydrate[index];
            if (missingChatId) {
              missingHydrationChatIds.add(missingChatId);
            }
          }

          return [];
        });

        if (cancelled) {
          return;
        }

        const hydratedChats = hydratedThreads.reduce(updateChatSummary, seedChats);
        const summaryByChatId = new Map(hydratedChats.map((chat) => [chat.id, chat] satisfies [string, ChatSummary]));
        const cachedThreads = Object.fromEntries(
          Object.entries(workspace?.cachedThreadsByChatId ?? {}).map(([chatId, thread]) => {
            const summary = summaryByChatId.get(chatId);
            const nextThread = summary
              ? mergeThreadSummary(thread, summary)
              : missingHydrationChatIds.has(chatId)
                ? downgradeMissingThread(thread)
                : thread;
            return [chatId, nextThread] satisfies [string, ChatThread];
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

        setState((current) => {
          const mergedChatMap = {
            ...chatMap,
          };

          Object.entries(current.chatMap).forEach(([chatId, thread]) => {
            if (missingHydrationChatIds.has(chatId)) {
              mergedChatMap[chatId] = downgradeMissingThread(mergedChatMap[chatId] ?? thread);
              return;
            }

            mergedChatMap[chatId] = mergeBootstrapThread(mergedChatMap[chatId] ?? thread, thread);
          });

          const mergedChats = Object.values(mergedChatMap).reduce(
            updateChatSummary,
            mergeSummaryLists(hydratedChats, current.chats),
          );
          const summaryByChatId = new Map(
            mergedChats.map((chat) => [chat.id, chat] satisfies [string, ChatSummary]),
          );
          const mergedOpenTabs = [...current.openTabs, ...(workspace?.openTabs ?? [])]
            .reduce<typeof current.openTabs>((tabs, tab) => {
              if (isChatTab(tab)) {
                if (!summaryByChatId.has(tab.chatId)) {
                  return tabs;
                }

                if (tabs.some((entry) => entry.id === tab.id)) {
                  return tabs.map((entry) =>
                    isChatTab(entry) && entry.chatId === tab.chatId
                      ? {
                          ...entry,
                          hasUnreadCompletion: entry.hasUnreadCompletion || tab.hasUnreadCompletion,
                          status: summaryByChatId.get(tab.chatId)?.status ?? entry.status,
                        }
                      : entry,
                  );
                }

                return [
                  ...tabs,
                  createChatTab(tab.chatId, summaryByChatId.get(tab.chatId)?.status ?? tab.status, {
                    hasUnreadCompletion: tab.hasUnreadCompletion,
                  }),
                ];
              }

              if (tabs.some((entry) => entry.id === tab.id)) {
                return tabs.map((entry) =>
                  isTerminalTab(entry) && entry.sessionId === tab.sessionId
                    ? {
                        ...entry,
                        status:
                          current.terminalSessionsById[tab.sessionId]?.status ??
                          workspace?.cachedTerminalSessionsById[tab.sessionId]?.status ??
                          entry.status,
                      }
                    : entry,
                );
              }

              return [
                ...tabs,
                createTerminalTab(
                  tab.sessionId,
                  current.terminalSessionsById[tab.sessionId]?.status ??
                    workspace?.cachedTerminalSessionsById[tab.sessionId]?.status ??
                    tab.status,
                ),
              ];
            }, [])
            .filter((tab) => (isChatTab(tab) ? summaryByChatId.has(tab.chatId) : true));
          const preservedOpenTabs = current.openTabs.filter((tab) => (isChatTab(tab) ? summaryByChatId.has(tab.chatId) : true));
          const nextOpenTabs =
            mergedOpenTabs.length > 0
              ? mergedOpenTabs
              : preservedOpenTabs.length > 0
                ? preservedOpenTabs
                : defaultOpenTabs(mergedChats);
          const nextChatSettingsByChatId = {
            ...chatSettingsByChatId,
            ...current.chatSettingsByChatId,
          };

          Object.values(mergedChatMap).forEach((thread) => {
            nextChatSettingsByChatId[thread.id] = inferSettings(thread, nextChatSettingsByChatId[thread.id]);
          });
          const nextActiveTabId =
            (current.activeTabId && nextOpenTabs.some((tab) => tab.id === current.activeTabId)
              ? current.activeTabId
              : workspace?.activeTabId && nextOpenTabs.some((tab) => tab.id === workspace.activeTabId)
                ? workspace.activeTabId
                : activeChatId && nextOpenTabs.some((tab) => tab.id === chatTabId(activeChatId))
                  ? chatTabId(activeChatId)
                  : nextOpenTabs[0]?.id ?? (mergedChats[0] ? chatTabId(mergedChats[0].id) : null));
          const nextActiveChatId = activeChatIdForTab(nextActiveTabId, nextOpenTabs);

          return {
            activeTabId: nextActiveTabId,
            activeChatId: nextActiveChatId,
            attachmentsByChatId: current.attachmentsByChatId,
            chatMap: mergedChatMap,
            chatSettingsByChatId: nextChatSettingsByChatId,
            chats: mergedChats,
            draftsByChatId: {
              ...(workspace?.draftsByChatId ?? {}),
              ...current.draftsByChatId,
            },
            error: current.error,
            interactionByChatId: current.interactionByChatId,
            liveActivityByChatId: Object.values(mergedChatMap).reduce<Record<string, ActivityEntry[]>>((accumulator, thread) => {
              const liveActivity = mergeLiveActivity(current.liveActivityByChatId[thread.id] ?? [], deriveLiveActivity(thread));
              if (liveActivity.length > 0) {
                accumulator[thread.id] = liveActivity;
              }
              return accumulator;
            }, {}),
            loading: false,
            openTabs: nextOpenTabs,
            terminalSessionsById: {
              ...(workspace?.cachedTerminalSessionsById ?? {}),
              ...current.terminalSessionsById,
            },
          };
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
    const sessionIds = state.openTabs.flatMap((tab) => (isTerminalTab(tab) ? [tab.sessionId] : []));
    if (sessionIds.length === 0) {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const results = await Promise.allSettled(sessionIds.map((sessionId) => terminalClient.getSession(sessionId)));
      if (cancelled) {
        return;
      }

      const sessions = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      if (sessions.length === 0) {
        return;
      }

      setState((current) => ({
        ...current,
        openTabs: sessions.reduce(
          (tabs, session) => setTerminalTabStatusIfOpen(tabs, session.idHash, session.status),
          current.openTabs,
        ),
        terminalSessionsById: sessions.reduce<Record<string, TerminalSessionSummary>>(
          (accumulator, session) => ({
            ...accumulator,
            [session.idHash]: session,
          }),
          current.terminalSessionsById,
        ),
      }));
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 2_500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [state.openTabs, terminalClient]);

  useEffect(() => {
    if (state.loading) {
      return;
    }

    saveWorkspaceSnapshot({
      activeTabId: state.activeTabId,
      cachedChats: state.chats,
      cachedThreadsByChatId: state.chatMap,
      cachedTerminalSessionsById: state.terminalSessionsById,
      chatSettingsByChatId: state.chatSettingsByChatId,
      draftsByChatId: state.draftsByChatId,
      openTabs: state.openTabs,
    });
  }, [
    state.activeTabId,
    state.chatMap,
    state.chatSettingsByChatId,
    state.chats,
    state.draftsByChatId,
    state.loading,
    state.openTabs,
    state.terminalSessionsById,
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
      activeTabId: chatTabId(chatId),
      activeChatId: chatId,
      openTabs: setChatTabUnreadIfOpen(
        ensureChatWorkspaceTab(current.openTabs, chatId, current.chats.find((chat) => chat.id === chatId)?.status ?? 'idle'),
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

  const activateTerminalSession = async (sessionId: string) => {
    setState((current) => {
      const openTabs = ensureTerminalWorkspaceTab(
        current.openTabs,
        sessionId,
        current.terminalSessionsById[sessionId]?.status ?? 'starting',
      );
      return {
        ...current,
        activeChatId: null,
        activeTabId: createTerminalTab(sessionId).id,
        openTabs,
      };
    });

    if (state.terminalSessionsById[sessionId]) {
      return;
    }

    try {
      const session = await terminalClient.getSession(sessionId);
      setState((current) => ({
        ...current,
        error: null,
        openTabs: setTerminalTabStatusIfOpen(current.openTabs, sessionId, session.status),
        terminalSessionsById: {
          ...current.terminalSessionsById,
          [session.idHash]: session,
        },
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to open tmuy session',
      }));
    }
  };

  const closeTab = (tabId: string) => {
    setState((current) => {
      const openTabs = current.openTabs.filter((tab) => tab.id !== tabId);
      const activeTabId = current.activeTabId === tabId ? openTabs[openTabs.length - 1]?.id ?? null : current.activeTabId;
      const activeChatId = activeChatIdForTab(activeTabId, openTabs);

      return {
        ...current,
        activeTabId,
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
        activeTabId: chatTabId(thread.id),
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
        liveActivityByChatId: clearLiveActivityForChat(current.liveActivityByChatId, thread.id),
        openTabs: ensureChatWorkspaceTab(current.openTabs, thread.id, thread.status, {
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

  const createTerminalSession = async (cwd: string) => {
    if (state.loading) {
      return null;
    }

    try {
      const session = await terminalClient.createSession({ cwd });
      setState((current) => ({
        ...current,
        activeChatId: null,
        activeTabId: createTerminalTab(session.idHash).id,
        error: null,
        openTabs: ensureTerminalWorkspaceTab(current.openTabs, session.idHash, session.status),
        terminalSessionsById: {
          ...current.terminalSessionsById,
          [session.idHash]: session,
        },
      }));
      return session;
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to create tmuy session',
      }));
      return null;
    }
  };

  const updateTerminalSession = (session: TerminalSessionSummary) => {
    setState((current) => ({
      ...current,
      openTabs: setTerminalTabStatusIfOpen(current.openTabs, session.idHash, session.status),
      terminalSessionsById: {
        ...current.terminalSessionsById,
        [session.idHash]: session,
      },
    }));
  };

  const setChatSettings = (chatId: string, settings: ChatRuntimeSettings) => {
    setState((current) => ({
      ...current,
      chatSettingsByChatId: {
        ...current.chatSettingsByChatId,
        [chatId]: {
          accessMode: settings.accessMode,
          approvalPolicy: settings.approvalPolicy,
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
    const activeTab = state.openTabs.find((tab) => isChatTab(tab) && tab.chatId === chatId);
    if (activeTab && isChatTab(activeTab) && isChatActiveStatus(activeTab.status)) {
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
      liveActivityByChatId: {
        ...current.liveActivityByChatId,
        [chatId]: [],
      },
      openTabs: ensureChatWorkspaceTab(current.openTabs, chatId, 'running', {
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
        liveActivityByChatId: clearLiveActivityForChat(current.liveActivityByChatId, chatId),
        openTabs: setChatTabStatusIfOpen(current.openTabs, chatId, 'idle'),
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
  const activeTab = state.activeTabId ? state.openTabs.find((tab) => tab.id === state.activeTabId) ?? null : null;
  const activeTerminalSession =
    activeTab && isTerminalTab(activeTab) ? state.terminalSessionsById[activeTab.sessionId] ?? null : null;
  const activeAttachments = state.activeChatId ? state.attachmentsByChatId[state.activeChatId] ?? [] : [];
  const activeDraft = state.activeChatId ? state.draftsByChatId[state.activeChatId] ?? '' : '';
  const activeChatSettings = state.activeChatId ? state.chatSettingsByChatId[state.activeChatId] ?? null : null;
  const activeInteraction = state.activeChatId ? state.interactionByChatId[state.activeChatId] ?? null : null;
  const activeLiveActivity = state.activeChatId ? state.liveActivityByChatId[state.activeChatId] ?? [] : [];

  return useMemo(
    () => ({
      ...state,
      activateChat,
      activateTerminalSession,
      activeChat,
      activeAttachments,
      activeChatSettings,
      activeInteraction,
      activeLiveActivity,
      activeTab,
      activeTerminalSession,
      addAttachments,
      closeTab,
      createChat,
      createTerminalSession,
      draft: activeDraft,
      interruptTurn,
      removeAttachment,
      respondToApproval,
      sendMessage,
      setChatSettings,
      setDraft,
      setDraftForChat,
      submitUserInput,
      updateTerminalSession,
    }),
    [activeChat, activeChatSettings, activeDraft, activeInteraction, activeLiveActivity, activeTab, activeTerminalSession, state],
  );
};
