import { createChatTab, createTerminalTab, isChatTab, isTerminalTab } from '../app/tabs';
import type { ChatStatus, TerminalSessionStatus, WorkspaceTab } from '../app/types';

export const ensureChatWorkspaceTab = (
  tabs: WorkspaceTab[],
  chatId: string,
  status: ChatStatus = 'idle',
  options?: {
    hasUnreadCompletion?: boolean;
  },
) => {
  const tabId = createChatTab(chatId).id;
  if (tabs.some((tab) => tab.id === tabId)) {
    return tabs.map((tab) =>
      isChatTab(tab) && tab.chatId === chatId
        ? {
            ...tab,
            hasUnreadCompletion: options?.hasUnreadCompletion ?? tab.hasUnreadCompletion,
            status,
          }
        : tab,
    );
  }

  return [...tabs, createChatTab(chatId, status, options)];
};

export const ensureTerminalWorkspaceTab = (
  tabs: WorkspaceTab[],
  sessionId: string,
  status: TerminalSessionStatus = 'starting',
) => {
  const tabId = createTerminalTab(sessionId).id;
  if (tabs.some((tab) => tab.id === tabId)) {
    return tabs.map((tab) => (isTerminalTab(tab) && tab.sessionId === sessionId ? { ...tab, status } : tab));
  }

  return [...tabs, createTerminalTab(sessionId, status)];
};

export const setChatTabStatusIfOpen = (tabs: WorkspaceTab[], chatId: string, status: ChatStatus) =>
  tabs.map((tab) => (isChatTab(tab) && tab.chatId === chatId ? { ...tab, status } : tab));

export const setChatTabUnreadIfOpen = (tabs: WorkspaceTab[], chatId: string, hasUnreadCompletion: boolean) =>
  tabs.map((tab) => (isChatTab(tab) && tab.chatId === chatId ? { ...tab, hasUnreadCompletion } : tab));

export const setTerminalTabStatusIfOpen = (tabs: WorkspaceTab[], sessionId: string, status: TerminalSessionStatus) =>
  tabs.map((tab) => (isTerminalTab(tab) && tab.sessionId === sessionId ? { ...tab, status } : tab));
