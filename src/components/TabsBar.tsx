import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { isChatTab, isTabActive, terminalSessionPreview } from '../app/tabs';
import type { ChatSummary, TerminalSessionSummary, WorkspaceTab } from '../app/types';
import { HighlightedText } from './HighlightedText';
import { Icon } from './Icon';

interface TabsOverviewProps {
  activeTabId: string | null;
  chats: ChatSummary[];
  maskedTabId?: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOpenChats: () => void;
  registerTabNode?: (tabId: string, node: HTMLButtonElement | null) => void;
  searchQuery: string;
  selectedSearchTabId?: string | null;
  tabs: WorkspaceTab[];
  terminalSessionsById: Record<string, TerminalSessionSummary>;
}

const relativeTime = (iso: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60)));

  if (minutes >= 60 * 24) {
    return `${Math.round(minutes / (60 * 24))}d ago`;
  }

  if (minutes >= 60) {
    return `${Math.round(minutes / 60)}h ago`;
  }

  return `${minutes}m ago`;
};

const splitSnippet = (text: string, limit: number) => {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return {
      chunk: trimmed,
      remainder: '',
    };
  }

  const breakpoint = trimmed.lastIndexOf(' ', limit);
  const sliceEnd = breakpoint > Math.floor(limit * 0.6) ? breakpoint : limit;
  return {
    chunk: `${trimmed.slice(0, sliceEnd).trimEnd()}…`,
    remainder: trimmed.slice(sliceEnd).trimStart(),
  };
};

const snippetForChat = (chat: ChatSummary | undefined) => {
  if (!chat) {
    return {
      primary: 'Waiting for the next remote task.',
      secondary: 'Open a chat to reconnect.',
    };
  }

  const preview = chat.preview.trim();
  const primary = splitSnippet(preview, 56);
  const secondary = splitSnippet(primary.remainder, 68);

  return {
    primary: primary.chunk || 'Ready for the next prompt.',
    secondary: secondary.chunk || relativeTime(chat.updatedAt),
  };
};

const snippetForTerminal = (session: TerminalSessionSummary | undefined) => {
  if (!session) {
    return {
      primary: 'Terminal session unavailable.',
      secondary: 'Reconnect to refresh its state.',
    };
  }

  const primary = splitSnippet(terminalSessionPreview(session), 56);
  return {
    primary: primary.chunk || 'Interactive shell session',
    secondary: session.status === 'live' ? 'Attached to tmuy' : relativeTime(session.updatedAt),
  };
};

interface TabCardProps {
  active: boolean;
  chat: ChatSummary | undefined;
  masked: boolean;
  onActivate: () => void;
  onClose: () => void;
  registerNode?: (node: HTMLButtonElement | null) => void;
  searchQuery: string;
  searchSelected: boolean;
  session: TerminalSessionSummary | undefined;
  tab: WorkspaceTab;
}

const SWIPE_THRESHOLD = 72;

const TabCard = ({ active, chat, masked, onActivate, onClose, registerNode, searchQuery, searchSelected, session, tab }: TabCardProps) => {
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartX = useRef<number | null>(null);
  const moved = useRef(false);
  const snippet = useMemo(() => (isChatTab(tab) ? snippetForChat(chat) : snippetForTerminal(session)), [chat, session, tab]);
  const title = isChatTab(tab) ? chat?.title ?? 'Untitled' : session?.currentName ?? 'Terminal session';

  const resetDrag = () => {
    dragStartX.current = null;
    moved.current = false;
    setDragOffset(0);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    dragStartX.current = event.clientX;
    moved.current = false;
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragStartX.current === null) {
      return;
    }

    const nextOffset = event.clientX - dragStartX.current;
    if (Math.abs(nextOffset) > 6) {
      moved.current = true;
    }

    setDragOffset(nextOffset);
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (Math.abs(dragOffset) >= SWIPE_THRESHOLD) {
      onClose();
      resetDrag();
      return;
    }

    if (!moved.current) {
      onActivate();
    }

    resetDrag();
  };

  return (
    <button
      ref={registerNode}
      className={`tab-card ${isTabActive(tab) ? 'tab-card--running' : ''} ${
        active ? 'tab-card--active' : ''
      } ${masked ? 'tab-card--masked' : ''} ${searchSelected ? 'tab-card--search' : ''}`}
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetDrag}
      onClick={(event) => {
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      style={{
        transform: `translateX(${dragOffset}px)`,
        opacity: masked ? 0 : 1 - Math.min(Math.abs(dragOffset) / 160, 0.42),
      }}
      aria-description="Swipe sideways to close tab"
    >
      <div className="tab-card__header">
        <span className="tab-card__title">
          <HighlightedText query={searchQuery} text={title} />
        </span>
        {tab.kind === 'terminal' ? (
          <Icon name="terminal" size={14} className="tab-card__icon tab-card__icon--terminal" />
        ) : isTabActive(tab) ? (
          <Icon name="loader" size={14} spin className="tab-card__icon tab-card__icon--running" />
        ) : isChatTab(tab) && tab.hasUnreadCompletion ? (
          <span className="tab-card__dot tab-card__dot--unread" aria-hidden="true" />
        ) : (
          <span className="tab-card__dot tab-card__dot--idle" aria-hidden="true" />
        )}
      </div>

      <p className="tab-card__line tab-card__line--muted">
        <HighlightedText query={searchQuery} text={snippet.primary} />
      </p>
      <p className="tab-card__line">
        <HighlightedText query={searchQuery} text={snippet.secondary} />
      </p>
      <span
        className={`tab-card__state ${isTabActive(tab) ? 'tab-card__state--running' : ''} ${
          isChatTab(tab) && tab.hasUnreadCompletion ? 'tab-card__state--unread' : ''
        }`}
      >
        {isChatTab(tab) ? (isTabActive(tab) ? 'In progress' : tab.hasUnreadCompletion ? 'New reply' : 'Ready') : snippet.secondary}
      </span>
    </button>
  );
};

export const TabsBar = ({
  activeTabId,
  chats,
  maskedTabId = null,
  onActivate,
  onClose,
  onOpenChats,
  registerTabNode,
  searchQuery,
  selectedSearchTabId = null,
  tabs,
  terminalSessionsById,
}: TabsOverviewProps) => {
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!selectedSearchTabId) {
      return;
    }

    cardRefs.current[selectedSearchTabId]?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedSearchTabId]);

  return (
    <section className="tabs-screen">
      <div className="tabs-top">
        <button className="header-icon tabs-top__menu" type="button" onClick={onOpenChats} aria-label="Open chats">
          <Icon name="menu" size={18} />
        </button>
        <span className="tabs-top__title">Open Tabs</span>
      </div>

      <div className="tabs-grid" role="list" aria-label="Open chats">
        {tabs.length === 0 ? (
          <div className="tabs-empty">No tabs are open yet. Create a Codex or terminal tab to get started.</div>
        ) : null}

        {tabs.map((tab) => {
          const chat = isChatTab(tab) ? chats.find((item) => item.id === tab.chatId) : undefined;
          const session = tab.kind === 'terminal' ? terminalSessionsById[tab.sessionId] : undefined;

          return (
            <TabCard
              key={tab.id}
              active={activeTabId === tab.id}
              chat={chat}
              masked={maskedTabId === tab.id}
              searchQuery={searchQuery}
              searchSelected={selectedSearchTabId === tab.id}
              session={session}
              tab={tab}
              onActivate={() => onActivate(tab.id)}
              onClose={() => onClose(tab.id)}
              registerNode={(node) => {
                cardRefs.current[tab.id] = node;
                registerTabNode?.(tab.id, node);
              }}
            />
          );
        })}
      </div>
    </section>
  );
};
