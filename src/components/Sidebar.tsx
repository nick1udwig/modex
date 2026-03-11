import { useEffect, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { ChatSummary } from '../app/types';
import { HighlightedText } from './HighlightedText';
import { Icon } from './Icon';

interface SidebarProps {
  activeChatId: string | null;
  chats: ChatSummary[];
  dragging: boolean;
  onClose: () => void;
  onCreateChat: () => void;
  onPanelPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onSelectChat: (chatId: string) => void;
  phase: 'opening' | 'open' | 'closing';
  registerPanel?: (node: HTMLElement | null) => void;
  searchQuery: string;
  selectedSearchChatId?: string | null;
  style?: CSSProperties;
}

const relativeDay = (iso: string) => {
  const delta = Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(delta, 'day');
};

export const Sidebar = ({
  activeChatId,
  chats,
  dragging,
  onClose,
  onCreateChat,
  onPanelPointerDown,
  onPointerCancel,
  onPointerMove,
  onPointerUp,
  onSelectChat,
  phase,
  registerPanel,
  searchQuery,
  selectedSearchChatId = null,
  style,
}: SidebarProps) => {
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!selectedSearchChatId) {
      return;
    }

    itemRefs.current[selectedSearchChatId]?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedSearchChatId]);

  return (
    <section
      className={`drawer-screen drawer-screen--${phase} ${dragging ? 'drawer-screen--dragging' : ''}`}
      style={style}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="drawer-overlay">
        <aside
          ref={registerPanel}
          className="drawer-panel"
          aria-label="All chats"
          onPointerDown={onPanelPointerDown}
        >
          <div className="drawer-panel__top">
            <button className="drawer-top__back" type="button" onClick={onClose} aria-label="Back to chat">
              <Icon name="arrow-left" size={17} />
            </button>

            <span className="drawer-top__title">All Chats</span>

            <button className="drawer-top__create" type="button" onClick={onCreateChat} aria-label="Create new chat">
              <Icon name="plus" size={14} />
            </button>
          </div>

          <div className="drawer-list">
            {chats.map((chat) => {
              const active = chat.id === activeChatId;
              const searchActive = searchQuery.trim().length > 0;

              return (
                <button
                  key={chat.id}
                  ref={(node) => {
                    itemRefs.current[chat.id] = node;
                  }}
                  className={`drawer-list__item ${active ? 'drawer-list__item--active' : ''} ${
                    selectedSearchChatId === chat.id ? 'drawer-list__item--search' : ''
                  }`}
                  type="button"
                  onClick={() => onSelectChat(chat.id)}
                >
                  <span className="drawer-list__title">
                    <HighlightedText query={searchQuery} text={chat.title} />
                  </span>
                  {searchActive ? (
                    <span className="drawer-list__preview">
                      <HighlightedText query={searchQuery} text={chat.preview} />
                    </span>
                  ) : null}
                  <span className="drawer-list__meta">{active ? relativeDay(chat.updatedAt) : chat.status === 'running' ? 'Running' : 'Ready'}</span>
                </button>
              );
            })}
          </div>

          <div className="drawer-user">
            <span className="drawer-user__avatar" aria-hidden="true" />
            <span className="drawer-user__name">Nick Ludwig</span>
          </div>
        </aside>

        <button className="drawer-scrim" type="button" onClick={onClose} aria-label="Close chats list" />
      </div>
    </section>
  );
};
