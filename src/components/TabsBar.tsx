import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { ChatSummary, ChatTab } from '../app/types';
import { HighlightedText } from './HighlightedText';
import { Icon } from './Icon';

interface TabsOverviewProps {
  activeChatId: string | null;
  chats: ChatSummary[];
  maskedChatId?: string | null;
  onActivate: (chatId: string) => void;
  onClose: (chatId: string) => void;
  registerTabNode?: (chatId: string, node: HTMLButtonElement | null) => void;
  searchQuery: string;
  selectedSearchChatId?: string | null;
  tabs: ChatTab[];
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

const snippetFor = (chat: ChatSummary | undefined) => {
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

interface TabCardProps {
  active: boolean;
  chat: ChatSummary | undefined;
  masked: boolean;
  onActivate: () => void;
  onClose: () => void;
  registerNode?: (node: HTMLButtonElement | null) => void;
  searchQuery: string;
  searchSelected: boolean;
  tab: ChatTab;
}

const SWIPE_THRESHOLD = 72;

const TabCard = ({ active, chat, masked, onActivate, onClose, registerNode, searchQuery, searchSelected, tab }: TabCardProps) => {
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartX = useRef<number | null>(null);
  const moved = useRef(false);
  const snippet = useMemo(() => snippetFor(chat), [chat]);

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
      className={`tab-card ${tab.status === 'running' ? 'tab-card--running' : ''} ${
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
          <HighlightedText query={searchQuery} text={chat?.title ?? 'Untitled'} />
        </span>
        {tab.status === 'running' ? (
          <Icon name="loader" size={14} spin className="tab-card__icon tab-card__icon--running" />
        ) : tab.hasUnreadCompletion ? (
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
        className={`tab-card__state ${tab.status === 'running' ? 'tab-card__state--running' : ''} ${
          tab.hasUnreadCompletion ? 'tab-card__state--unread' : ''
        }`}
      >
        {tab.status === 'running' ? 'In progress' : tab.hasUnreadCompletion ? 'New reply' : 'Ready'}
      </span>
    </button>
  );
};

export const TabsBar = ({
  activeChatId,
  chats,
  maskedChatId = null,
  onActivate,
  onClose,
  registerTabNode,
  searchQuery,
  selectedSearchChatId = null,
  tabs,
}: TabsOverviewProps) => {
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!selectedSearchChatId) {
      return;
    }

    cardRefs.current[selectedSearchChatId]?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedSearchChatId]);

  return (
    <section className="tabs-screen">
      <div className="tabs-grid" role="list" aria-label="Open chats">
        {tabs.length === 0 ? (
          <div className="tabs-empty">No tabs are open yet. Create a new chat to start a session.</div>
        ) : null}

        {tabs.map((tab) => {
          const chat = chats.find((item) => item.id === tab.chatId);

          return (
            <TabCard
              key={tab.chatId}
              active={activeChatId === tab.chatId}
              chat={chat}
              masked={maskedChatId === tab.chatId}
              searchQuery={searchQuery}
              searchSelected={selectedSearchChatId === tab.chatId}
              tab={tab}
              onActivate={() => onActivate(tab.chatId)}
              onClose={() => onClose(tab.chatId)}
              registerNode={(node) => {
                cardRefs.current[tab.chatId] = node;
                registerTabNode?.(tab.chatId, node);
              }}
            />
          );
        })}
      </div>
    </section>
  );
};
