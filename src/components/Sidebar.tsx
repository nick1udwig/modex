import type { ChatSummary } from '../app/types';

interface SidebarProps {
  chats: ChatSummary[];
  activeChatId: string | null;
  openTabs: string[];
  isOpen: boolean;
  loading: boolean;
  onClose: () => void;
  onCreateChat: () => void;
  onSelectChat: (chatId: string) => void;
}

const relativeTime = (iso: string) =>
  new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
    Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60)),
    'minute',
  );

export const Sidebar = ({
  chats,
  activeChatId,
  openTabs,
  isOpen,
  loading,
  onClose,
  onCreateChat,
  onSelectChat,
}: SidebarProps) => (
  <>
    <div className={`sidebar-scrim ${isOpen ? 'visible' : ''}`} onClick={onClose} />
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar__header">
        <div>
          <p className="eyebrow">Threads</p>
          <h1>Modex</h1>
        </div>
        <button className="secondary-button" type="button" onClick={onCreateChat} disabled={loading}>
          New chat
        </button>
      </div>

      <div className="sidebar__list">
        {chats.map((chat) => {
          const isActive = chat.id === activeChatId;
          const isOpenInTabs = openTabs.includes(chat.id);

          return (
            <button
              key={chat.id}
              className={`chat-row ${isActive ? 'active' : ''}`}
              type="button"
              onClick={() => onSelectChat(chat.id)}
            >
              <div className="chat-row__main">
                <span className="chat-row__title">{chat.title}</span>
                {isOpenInTabs ? <span className="chat-row__badge">Open</span> : null}
              </div>
              <span className="chat-row__preview">{chat.preview}</span>
              <span className="chat-row__meta">{relativeTime(chat.updatedAt)}</span>
            </button>
          );
        })}
      </div>
    </aside>
  </>
);
