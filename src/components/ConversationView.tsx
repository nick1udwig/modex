import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { ActivityEntry, ChatThread } from '../app/types';
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

const LONG_PRESS_MS = 380;
const LONG_PRESS_MOVE_THRESHOLD = 12;

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'absolute';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};

const activityForMessage = (chat: ChatThread, messageId: string) => {
  const message = chat.messages.find((entry) => entry.id === messageId) ?? null;
  if (!message) {
    return [] as ActivityEntry[];
  }

  if (!message.turnId) {
    return chat.activity;
  }

  return chat.activity.filter((entry) => entry.turnId === message.turnId);
};

export const ConversationView = ({ activeSearchHitId = null, busy, chat, loading, searchQuery }: ConversationViewProps) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const longPressRef = useRef<{
    messageId: string;
    pointerId: number;
    startX: number;
    startY: number;
    timeoutId: number;
    triggered: boolean;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectionMessageId, setSelectionMessageId] = useState<string | null>(null);
  const [sheetState, setSheetState] = useState<{ messageId: string; mode: 'actions' | 'details' } | null>(null);

  useEffect(() => {
    setNotice(null);
    setSelectionMessageId(null);
    setSheetState(null);
  }, [chat?.id]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 1_600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (messageListRef.current) {
        messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
      }
      bottomRef.current?.scrollIntoView({ block: 'end' });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [chat?.id, chat?.messages.length, chat?.updatedAt, busy, searchQuery]);

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

  useEffect(
    () => () => {
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current.timeoutId);
        longPressRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectionMessageId) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setSelectionMessageId(null);
        return;
      }

      if (target.closest(`[data-message-id="${selectionMessageId}"]`)) {
        return;
      }

      setSelectionMessageId(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [selectionMessageId]);

  const cancelLongPress = () => {
    if (!longPressRef.current) {
      return;
    }

    window.clearTimeout(longPressRef.current.timeoutId);
    longPressRef.current = null;
  };

  const openMessageActions = (messageId: string) => {
    setSelectionMessageId(null);
    setSheetState({
      messageId,
      mode: 'actions',
    });
  };

  const handleMessagePointerDown = (event: PointerEvent<HTMLDivElement>, messageId: string) => {
    if (selectionMessageId === messageId) {
      return;
    }

    cancelLongPress();
    longPressRef.current = {
      messageId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timeoutId: window.setTimeout(() => {
        if (!longPressRef.current || longPressRef.current.messageId !== messageId) {
          return;
        }

        longPressRef.current.triggered = true;
        openMessageActions(messageId);
      }, LONG_PRESS_MS),
      triggered: false,
    };
  };

  const handleMessagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = longPressRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    if (
      Math.abs(event.clientX - current.startX) > LONG_PRESS_MOVE_THRESHOLD ||
      Math.abs(event.clientY - current.startY) > LONG_PRESS_MOVE_THRESHOLD
    ) {
      cancelLongPress();
    }
  };

  const handleMessagePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const current = longPressRef.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    if (current.triggered) {
      event.preventDefault();
    }

    cancelLongPress();
  };

  const selectedMessage = sheetState && chat ? chat.messages.find((message) => message.id === sheetState.messageId) ?? null : null;
  const selectedActivity = selectedMessage && chat ? activityForMessage(chat, selectedMessage.id) : [];

  return (
    <section className="chat-screen">
      <div className="model-row">
        <span className="model-row__label">GPT-5.2 / high</span>
        <span className="model-row__meta">{chat?.tokenUsageLabel ?? 'Live session'}</span>
      </div>

      <div ref={messageListRef} className="message-list">
        {notice ? <div className="message-notice">{notice}</div> : null}

        {loading && !chat ? <div className="message-empty">Syncing chats from the app-server.</div> : null}

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
              data-message-id={message.id}
              className={`message-card message-card--${message.role} ${
                isEnteringUserMessage ? 'message-card--enter' : ''
              } ${selectionMessageId === message.id ? 'message-card--selecting' : ''}`}
              onContextMenu={(event) => {
                event.preventDefault();
                openMessageActions(message.id);
              }}
              onPointerDown={(event) => handleMessagePointerDown(event, message.id)}
              onPointerMove={handleMessagePointerMove}
              onPointerUp={handleMessagePointerEnd}
              onPointerCancel={handleMessagePointerEnd}
              onPointerLeave={handleMessagePointerEnd}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openMessageActions(message.id);
                }
              }}
              aria-label={`${messageLabel(message.role)} message`}
            >
              <p className={`message-card__body ${selectionMessageId === message.id ? 'message-card__body--selectable' : ''}`}>
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

      {sheetState && selectedMessage ? (
        <div className="message-sheet" role="dialog" aria-modal="true" aria-label="Message actions">
          <button
            className="message-sheet__scrim"
            type="button"
            aria-label="Close message actions"
            onClick={() => setSheetState(null)}
          />

          <div className="message-sheet__panel">
            <div className="message-sheet__header">
              {sheetState.mode === 'details' ? (
                <button
                  className="message-sheet__back"
                  type="button"
                  onClick={() =>
                    setSheetState({
                      messageId: selectedMessage.id,
                      mode: 'actions',
                    })
                  }
                  aria-label="Back to message actions"
                >
                  <Icon name="arrow-left" size={16} />
                </button>
              ) : (
                <div className="message-sheet__label">{messageLabel(selectedMessage.role)}</div>
              )}

              <button className="message-sheet__close" type="button" onClick={() => setSheetState(null)} aria-label="Close">
                <Icon name="x" size={16} />
              </button>
            </div>

            {sheetState.mode === 'actions' ? (
              <>
                <div className="message-sheet__preview">{selectedMessage.content}</div>

                <div className="message-sheet__actions">
                  <button
                    className="message-sheet__action"
                    type="button"
                    onClick={() => {
                      void copyTextToClipboard(selectedMessage.content)
                        .then(() => {
                          setNotice('Message copied');
                          setSheetState(null);
                        })
                        .catch(() => {
                          setNotice('Copy failed');
                          setSheetState(null);
                        });
                    }}
                  >
                    Copy message
                  </button>

                  <button
                    className="message-sheet__action"
                    type="button"
                    onClick={() => {
                      setSelectionMessageId(selectedMessage.id);
                      setNotice('Text selection enabled');
                      setSheetState(null);
                    }}
                  >
                    Select text
                  </button>

                  <button
                    className="message-sheet__action"
                    type="button"
                    disabled={selectedActivity.length === 0}
                    onClick={() =>
                      setSheetState({
                        messageId: selectedMessage.id,
                        mode: 'details',
                      })
                    }
                  >
                    View agent activity
                  </button>
                </div>
              </>
            ) : (
              <div className="message-sheet__details">
                {selectedActivity.length === 0 ? (
                  <div className="message-sheet__empty">No saved agent activity is available for this reply yet.</div>
                ) : (
                  selectedActivity.map((entry) => (
                    <article key={entry.id} className="message-sheet__detail-card">
                      <div className="message-sheet__detail-header">
                        <span className="message-sheet__detail-title">{entry.title}</span>
                        <span className={`message-sheet__detail-status message-sheet__detail-status--${entry.status}`}>
                          {entry.status.replace('-', ' ')}
                        </span>
                      </div>
                      <div className="message-sheet__detail-kind">{entry.kind.replace('-', ' ')}</div>
                      <p className="message-sheet__detail-summary">{entry.summary}</p>
                      {entry.detail ? <pre className="message-sheet__detail-body">{entry.detail}</pre> : null}
                    </article>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
};
