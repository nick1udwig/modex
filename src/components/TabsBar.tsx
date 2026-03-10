import type { ChatSummary, ChatTab } from '../app/types';

interface TabsBarProps {
  tabs: ChatTab[];
  chats: ChatSummary[];
  activeChatId: string | null;
  onActivate: (chatId: string) => void;
  onClose: (chatId: string) => void;
}

const titleFor = (chatId: string, chats: ChatSummary[]) =>
  chats.find((chat) => chat.id === chatId)?.title ?? 'Chat';

export const TabsBar = ({
  tabs,
  chats,
  activeChatId,
  onActivate,
  onClose,
}: TabsBarProps) => (
  <div className="tabs-bar" role="tablist" aria-label="Open chats">
    {tabs.map((tab) => (
      <div
        key={tab.chatId}
        className={`tab-pill ${activeChatId === tab.chatId ? 'active' : ''}`}
        role="tab"
        aria-selected={activeChatId === tab.chatId}
      >
        <button className="tab-pill__button" type="button" onClick={() => onActivate(tab.chatId)}>
          <span className={`status-dot ${tab.status}`} aria-hidden="true" />
          <span className="tab-pill__label">{titleFor(tab.chatId, chats)}</span>
        </button>
        <button
          className="tab-pill__close"
          type="button"
          aria-label={`Close ${titleFor(tab.chatId, chats)}`}
          onClick={() => onClose(tab.chatId)}
        >
          ×
        </button>
      </div>
    ))}
  </div>
);
