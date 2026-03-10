import { useEffect, useRef } from 'react';
import type { ChatThread } from '../app/types';

interface ConversationViewProps {
  chat: ChatThread | null;
  draft: string;
  busy: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}

const formatTimestamp = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

export const ConversationView = ({
  chat,
  draft,
  busy,
  error,
  onDraftChange,
  onSend,
}: ConversationViewProps) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat?.id, chat?.messages.length]);

  if (!chat) {
    return (
      <section className="conversation conversation--empty">
        <p className="eyebrow">No active tab</p>
        <h2>Open a chat from the sidebar or restore one of your saved tabs.</h2>
      </section>
    );
  }

  return (
    <section className="conversation">
      <header className="conversation__header">
        <div>
          <p className="eyebrow">Remote session</p>
          <h2>{chat.title}</h2>
        </div>
        <p className="conversation__status">{busy ? 'Running…' : 'Idle'}</p>
      </header>

      <div className="message-list">
        {chat.messages.map((message) => (
          <article key={message.id} className={`message-card ${message.role}`}>
            <div className="message-card__meta">
              <span>{message.role}</span>
              <time>{formatTimestamp(message.createdAt)}</time>
            </div>
            <p>{message.content}</p>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        {error ? <p className="error-banner">{error}</p> : null}
        <label className="composer__label" htmlFor="composer-input">
          Message
        </label>
        <textarea
          id="composer-input"
          rows={4}
          value={draft}
          placeholder="Ask the remote app-server to inspect, edit, or summarize work."
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (!busy && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div className="composer__actions">
          <p>Cmd/Ctrl + Enter to send</p>
          <button className="primary-button" type="button" onClick={onSend} disabled={busy}>
            {busy ? 'Waiting…' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  );
};
