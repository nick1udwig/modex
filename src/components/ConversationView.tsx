import { useEffect, useRef } from 'react';
import type { ChatThread } from '../app/types';
import { HighlightedText } from './HighlightedText';
import { Icon } from './Icon';

interface ConversationViewProps {
  activeSearchHitId?: string | null;
  busy: boolean;
  chat: ChatThread | null;
  loading: boolean;
  searchQuery: string;
}

const formatMeta = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

const messageLabel = (role: ChatThread['messages'][number]['role']) => {
  if (role === 'assistant') {
    return 'Codex';
  }

  if (role === 'system') {
    return 'System';
  }

  return 'You';
};

export const ConversationView = ({ activeSearchHitId = null, busy, chat, loading, searchQuery }: ConversationViewProps) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      return;
    }

    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat?.id, chat?.messages.length, busy, searchQuery]);

  useEffect(() => {
    if (!activeSearchHitId) {
      return;
    }

    const node = document.getElementById(activeSearchHitId);
    node?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
    });
  }, [activeSearchHitId]);

  return (
    <section className="chat-screen">
      <div className="model-row">
        <span className="model-row__label">GPT-5.2 / high</span>
        <span className="model-row__meta">{chat?.tokenUsageLabel ?? 'Live session'}</span>
      </div>

      <div className="message-list">
        {loading ? <div className="message-empty">Syncing chats from the app-server.</div> : null}

        {!loading && !chat ? (
          <div className="message-empty">Open a chat from the drawer or create a fresh tab to continue.</div>
        ) : null}

        {busy ? (
          <div className="run-row">
            <Icon name="loader" size={14} spin />
            <span>Agent running • {chat?.title ?? 'active session'}</span>
          </div>
        ) : null}

        {chat?.messages.filter((message) => message.role !== 'system').map((message, index, messages) => {
          const isLastAssistant = message.role === 'assistant' && index === messages.length - 1;
          const isEnteringUserMessage = message.role === 'user' && message.id.startsWith('optimistic-');

          return (
            <div
              key={message.id}
              className={`message-card message-card--${message.role} ${
                isEnteringUserMessage ? 'message-card--enter' : ''
              }`}
              aria-label={`${messageLabel(message.role)} message`}
            >
              <p>
                <HighlightedText
                  activeHitId={activeSearchHitId}
                  hitIdPrefix={`search-hit-${message.id}`}
                  query={searchQuery}
                  text={message.content}
                />
              </p>
              {isLastAssistant ? <span className="message-card__meta">{formatMeta(chat.updatedAt)}</span> : null}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </section>
  );
};
