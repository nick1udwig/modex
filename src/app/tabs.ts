import { chatStatusLabel, isChatActiveStatus } from './chatStatus';
import type {
  ChatStatus,
  ChatTab,
  TerminalSessionStatus,
  TerminalSessionSummary,
  TerminalTab,
  WorkspaceTab,
} from './types';

export const chatTabId = (chatId: string) => `chat:${chatId}`;
export const terminalTabId = (sessionId: string) => `terminal:${sessionId}`;

export const isChatTab = (tab: WorkspaceTab): tab is ChatTab => tab.kind === 'chat';
export const isTerminalTab = (tab: WorkspaceTab): tab is TerminalTab => tab.kind === 'terminal';

export const createChatTab = (
  chatId: string,
  status: ChatStatus = 'idle',
  options?: {
    hasUnreadCompletion?: boolean;
  },
): ChatTab => ({
  chatId,
  hasUnreadCompletion: options?.hasUnreadCompletion ?? false,
  id: chatTabId(chatId),
  kind: 'chat',
  status,
});

export const createTerminalTab = (sessionId: string, status: TerminalSessionStatus = 'starting'): TerminalTab => ({
  id: terminalTabId(sessionId),
  kind: 'terminal',
  sessionId,
  status,
});

export const isTerminalSessionLive = (status: TerminalSessionStatus) => status === 'starting' || status === 'live';

export const terminalStatusLabel = (status: TerminalSessionStatus) => {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'live':
      return 'Live';
    case 'failed':
      return 'Failed';
    default:
      return 'Exited';
  }
};

export const tabStatusLabel = (tab: WorkspaceTab) =>
  tab.kind === 'chat' ? chatStatusLabel(tab.status) : terminalStatusLabel(tab.status);

export const isTabActive = (tab: WorkspaceTab) =>
  tab.kind === 'chat' ? isChatActiveStatus(tab.status) : isTerminalSessionLive(tab.status);

export const terminalSessionPreview = (session: TerminalSessionSummary) => {
  const cwd = session.cwd.trim();
  if (session.status === 'failed') {
    return cwd || 'Terminal session failed to start.';
  }

  if (session.status === 'exited') {
    return session.exitCode === null ? cwd || 'Terminal session exited.' : `Exit ${session.exitCode}`;
  }

  return cwd || 'Interactive shell session';
};
