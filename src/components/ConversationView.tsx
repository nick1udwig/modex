import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { renderMessageMarkdown } from '../app/messageMarkdown';
import { positionMessageMenu } from '../app/messageMenuPosition';
import type { ActivityEntry, ChatThread, ModelOption, ReasoningEffort } from '../app/types';
import { Icon } from './Icon';
import { LiveActivityStack } from './LiveActivityStack';

interface ConversationViewProps {
  activeSearchHitId?: string | null;
  busy: boolean;
  chat: ChatThread | null;
  liveActivity: ActivityEntry[];
  loading: boolean;
  modelOptions: ModelOption[];
  onSelectModel: (modelId: string) => void;
  onSelectReasoningEffort: (effort: ReasoningEffort) => void;
  searchQuery: string;
  selectedModelId: string;
  selectedReasoningEffort: ReasoningEffort | null;
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
const MESSAGE_MENU_ESTIMATE = {
  height: 112,
  width: 180,
};

interface MessageMenuState {
  anchorRect: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
  menuLeft: number;
  menuTop: number;
  messageId: string;
}

const formatReasoningEffort = (effort: ReasoningEffort | null) => (effort ? effort.replace(/^./, (letter) => letter.toUpperCase()) : 'Default');

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

const clearNativeSelection = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  selection.removeAllRanges();
};

export const ConversationView = ({
  activeSearchHitId = null,
  busy,
  chat,
  liveActivity,
  loading,
  modelOptions,
  onSelectModel,
  onSelectReasoningEffort,
  searchQuery,
  selectedModelId,
  selectedReasoningEffort,
}: ConversationViewProps) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageBodyNodesRef = useRef<Record<string, HTMLDivElement | null>>({});
  const messageMenuRef = useRef<HTMLDivElement | null>(null);
  const messageNodesRef = useRef<Record<string, HTMLDivElement | null>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const longPressRef = useRef<{
    messageId: string;
    mode: 'menu' | 'selection';
    pointerId: number;
    startX: number;
    startY: number;
    timeoutId: number;
    triggered: boolean;
  } | null>(null);
  const suppressContextMenuRef = useRef<{
    expiresAt: number;
    messageId: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailsMessageId, setDetailsMessageId] = useState<string | null>(null);
  const [detailsStackExpanded, setDetailsStackExpanded] = useState(false);
  const [expandedStackMessageId, setExpandedStackMessageId] = useState<string | null>(null);
  const [messageMenu, setMessageMenu] = useState<MessageMenuState | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectionMessageId, setSelectionMessageId] = useState<string | null>(null);
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId) ?? modelOptions[0] ?? null;

  useEffect(() => {
    setNotice(null);
    setDetailsMessageId(null);
    setDetailsStackExpanded(false);
    setExpandedStackMessageId(null);
    setMessageMenu(null);
    setModelMenuOpen(false);
    setSelectionMessageId(null);
    clearNativeSelection();
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

    const scrollToLatest = () => {
      if (messageListRef.current) {
        messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
      }
      bottomRef.current?.scrollIntoView({ block: 'end' });
    };

    const frameId = window.requestAnimationFrame(scrollToLatest);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [chat?.id, chat?.messages.length, chat?.updatedAt, busy, searchQuery]);

  useEffect(() => {
    if (searchQuery.trim().length > 0 || !busy) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (messageListRef.current) {
        messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
      }
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [busy, chat?.id, searchQuery]);

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
        clearNativeSelection();
        setSelectionMessageId(null);
        return;
      }

      if (target.closest(`[data-message-id="${selectionMessageId}"]`)) {
        return;
      }

      clearNativeSelection();
      setSelectionMessageId(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [selectionMessageId]);

  useEffect(() => {
    if (!modelMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setModelMenuOpen(false);
        return;
      }

      if (modelMenuRef.current?.contains(target)) {
        return;
      }

      setModelMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!messageMenu) {
      return;
    }

    const handleReposition = () => {
      setMessageMenu(null);
      setDetailsMessageId(null);
    };

    const listNode = messageListRef.current;
    listNode?.addEventListener('scroll', handleReposition);
    window.addEventListener('resize', handleReposition);

    return () => {
      listNode?.removeEventListener('scroll', handleReposition);
      window.removeEventListener('resize', handleReposition);
    };
  }, [messageMenu]);

  useEffect(() => {
    if (!messageMenu || !messageMenuRef.current) {
      return;
    }

    const nextPosition = positionMessageMenu(
      messageMenu.anchorRect,
      {
        height: messageMenuRef.current.offsetHeight,
        width: messageMenuRef.current.offsetWidth,
      },
      {
        height: window.innerHeight,
        width: window.innerWidth,
      },
    );

    if (nextPosition.left === messageMenu.menuLeft && nextPosition.top === messageMenu.menuTop) {
      return;
    }

    setMessageMenu((current) =>
      current && current.messageId === messageMenu.messageId
        ? {
            ...current,
            menuLeft: nextPosition.left,
            menuTop: nextPosition.top,
          }
        : current,
    );
  }, [messageMenu]);

  const cancelLongPress = () => {
    if (!longPressRef.current) {
      return;
    }

    window.clearTimeout(longPressRef.current.timeoutId);
    longPressRef.current = null;
  };

  const openMessageActions = (messageId: string) => {
    const node = messageNodesRef.current[messageId];
    const rect = node?.getBoundingClientRect();
    clearNativeSelection();
    setSelectionMessageId(null);
    setDetailsMessageId(null);
    if (!rect) {
      return;
    }

    const anchorRect = {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    };
    const position = positionMessageMenu(
      anchorRect,
      MESSAGE_MENU_ESTIMATE,
      {
        height: window.innerHeight,
        width: window.innerWidth,
      },
    );
    setMessageMenu({
      anchorRect,
      menuLeft: position.left,
      menuTop: position.top,
      messageId,
    });
  };

  const enableMessageSelection = (messageId: string, options?: { preserveMenu?: boolean }) => {
    const bodyNode = messageBodyNodesRef.current[messageId];
    clearNativeSelection();
    if (!options?.preserveMenu) {
      setMessageMenu(null);
    }
    setDetailsMessageId(null);
    setSelectionMessageId(messageId);
    setNotice('Text selection enabled');
    suppressContextMenuRef.current = {
      expiresAt: Date.now() + 900,
      messageId,
    };

    if (!bodyNode) {
      return;
    }

    window.requestAnimationFrame(() => {
      const selection = window.getSelection();
      if (!selection) {
        return;
      }

      const range = document.createRange();
      range.selectNodeContents(bodyNode);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  };

  const handleMessagePointerDown = (event: PointerEvent<HTMLDivElement>, messageId: string) => {
    if (selectionMessageId === messageId) {
      return;
    }

    const target = event.target;
    if (event.pointerType === 'mouse' || !(target instanceof Element)) {
      return;
    }

    const longPressMode: 'menu' | 'selection' =
      messageMenu?.messageId === messageId && target.closest('.message-card__body') ? 'selection' : 'menu';

    cancelLongPress();
    longPressRef.current = {
      messageId,
      mode: longPressMode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timeoutId: window.setTimeout(() => {
        if (!longPressRef.current || longPressRef.current.messageId !== messageId) {
          return;
        }

        longPressRef.current.triggered = true;
        if (longPressRef.current.mode === 'selection') {
          enableMessageSelection(messageId, { preserveMenu: true });
          return;
        }

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

  const spotlightMessageId = detailsMessageId ?? messageMenu?.messageId ?? selectionMessageId;
  const selectedMessage =
    spotlightMessageId && chat ? chat.messages.find((message) => message.id === spotlightMessageId) ?? null : null;
  const selectedActivity = selectedMessage && chat ? activityForMessage(chat, selectedMessage.id) : [];
  const commentaryActivity = [...selectedActivity.filter((entry) => entry.kind === 'commentary')].reverse();
  const structuredActivity = selectedActivity.filter((entry) => entry.kind !== 'commentary');

  return (
    <section className="chat-screen">
      <div className="model-row">
        <div ref={modelMenuRef} className="model-picker">
          <button
            className="model-picker__trigger"
            type="button"
            onClick={() => setModelMenuOpen((current) => !current)}
            aria-haspopup="dialog"
            aria-expanded={modelMenuOpen}
            aria-label="Choose model and reasoning level"
          >
            <span className="model-row__label">
              {selectedModel?.displayName ?? selectedModelId} / {formatReasoningEffort(selectedReasoningEffort)}
            </span>
            <Icon name="arrow-down" size={12} />
          </button>

          {modelMenuOpen ? (
            <div className="model-picker__menu" role="dialog" aria-label="Model settings">
              <div className="model-picker__section">
                <span className="model-picker__title">Model</span>
                <div className="model-picker__options">
                  {modelOptions.map((model) => (
                    <button
                      key={model.id}
                      className={`model-picker__option ${selectedModelId === model.id ? 'model-picker__option--active' : ''}`}
                      type="button"
                      onClick={() => {
                        onSelectModel(model.id);
                        setModelMenuOpen(false);
                      }}
                    >
                      {model.displayName}
                    </button>
                  ))}
                </div>
              </div>

              <div className="model-picker__section">
                <span className="model-picker__title">Thinking</span>
                <div className="model-picker__options">
                  {(selectedModel?.supportedReasoningEfforts ?? []).map((effort) => (
                    <button
                      key={effort}
                      className={`model-picker__option ${
                        selectedReasoningEffort === effort ? 'model-picker__option--active' : ''
                      }`}
                      type="button"
                      onClick={() => {
                        onSelectReasoningEffort(effort);
                        setModelMenuOpen(false);
                      }}
                    >
                      {formatReasoningEffort(effort)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
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
          const messageActivity = activityForMessage(chat, message.id);
          const stackEntries = [...messageActivity].reverse();
          const isIntermediateMessage = message.role === 'assistant' && chat.activity.some((entry) => entry.id === message.id);
          const showInlineStack = message.role === 'assistant' && !isIntermediateMessage && stackEntries.length > 0;
          const inlineStackExpanded = expandedStackMessageId === message.id;
          const topStackEntry = stackEntries[0] ?? null;

          return (
            <div key={message.id} className="message-block">
              {showInlineStack && topStackEntry ? (
                <div className="message-inline-stack">
                  <button
                    className={`message-stack__summary ${inlineStackExpanded ? 'message-stack__summary--expanded' : ''}`}
                    type="button"
                    onClick={() => setExpandedStackMessageId((current) => (current === message.id ? null : message.id))}
                  >
                    <div className="message-stack__summary-header">
                      <span className="message-stack__title">Agent activity</span>
                      <span className="message-stack__count">
                        {inlineStackExpanded ? 'Hide stack' : `${stackEntries.length} saved`}
                      </span>
                    </div>
                    <div className="message-stack__layers" aria-hidden="true">
                      <span />
                      <span />
                    </div>
                    <article className="message-sheet__detail-card message-sheet__detail-card--stack">
                      <div className="message-sheet__detail-header">
                        <span className="message-sheet__detail-title">{topStackEntry.title}</span>
                        <span className={`message-sheet__detail-status message-sheet__detail-status--${topStackEntry.status}`}>
                          {topStackEntry.status.replace('-', ' ')}
                        </span>
                      </div>
                      <div className="message-sheet__detail-kind">{topStackEntry.kind.replace('-', ' ')}</div>
                      <p className="message-sheet__detail-summary">{topStackEntry.summary}</p>
                      {topStackEntry.detail ? <pre className="message-sheet__detail-body">{topStackEntry.detail}</pre> : null}
                    </article>
                  </button>

                  {inlineStackExpanded ? (
                    <div className="message-inline-stack__items">
                      {stackEntries.slice(1).map((entry) => (
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
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div
                ref={(node) => {
                  messageNodesRef.current[message.id] = node;
                }}
                data-message-id={message.id}
                className={`message-card message-card--${message.role} ${
                  isEnteringUserMessage ? 'message-card--enter' : ''
                } ${selectionMessageId === message.id ? 'message-card--selecting' : ''} ${
                  spotlightMessageId === message.id ? 'message-card--spotlight' : ''
                } ${isIntermediateMessage ? 'message-card--progress' : ''}`}
                onContextMenu={(event) => {
                  const suppressed = suppressContextMenuRef.current;
                  if (suppressed && suppressed.messageId === message.id && suppressed.expiresAt > Date.now()) {
                    event.preventDefault();
                    return;
                  }

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
                <div
                  ref={(node) => {
                    messageBodyNodesRef.current[message.id] = node;
                  }}
                  className={`message-card__body message-markdown ${
                    selectionMessageId === message.id ? 'message-card__body--selectable' : ''
                  }`}
                >
                  {renderMessageMarkdown(message.content, {
                    activeHitId: activeSearchHitId,
                    hitIdPrefix: `search-hit-${message.id}`,
                    query: searchQuery,
                  })}
                </div>
                {isLastAssistant ? <span className="message-card__meta">{formatMeta(chat.updatedAt)}</span> : null}
              </div>
            </div>
          );
        })}

        {busy && liveActivity.length > 0 ? <LiveActivityStack entries={liveActivity} searchQuery={searchQuery} /> : null}

        <div ref={bottomRef} />
      </div>

      {messageMenu && selectedMessage ? (
        <div className="message-overlay" role="dialog" aria-modal="true" aria-label="Message actions">
          <button
            className="message-overlay__scrim"
            type="button"
            aria-label="Close message actions"
            onClick={() => {
              setMessageMenu(null);
              setDetailsMessageId(null);
            }}
          />

          <div
            ref={messageMenuRef}
            className="message-overlay__menu"
            style={{
              left: `${messageMenu.menuLeft}px`,
              top: `${messageMenu.menuTop}px`,
            }}
          >
            <button
              className="message-overlay__action"
              type="button"
              onClick={() => {
                void copyTextToClipboard(selectedMessage.content)
                  .then(() => setNotice('Message copied'))
                  .catch(() => setNotice('Copy failed'))
                  .finally(() => setMessageMenu(null));
              }}
            >
              Copy
            </button>
            <button
              className="message-overlay__action"
              type="button"
              disabled={selectedActivity.length === 0}
              onClick={() => {
                setDetailsMessageId(selectedMessage.id);
                setDetailsStackExpanded(false);
                setMessageMenu(null);
              }}
            >
              Activity
            </button>
          </div>
        </div>
      ) : null}

      {detailsMessageId && selectedMessage ? (
        <div className="message-detail-sheet" role="dialog" aria-modal="true" aria-label="Agent activity">
          <button
            className="message-detail-sheet__scrim"
            type="button"
            aria-label="Close agent activity"
            onClick={() => {
              setDetailsMessageId(null);
              setDetailsStackExpanded(false);
            }}
          />

          <div className="message-detail-sheet__panel">
            <div className="message-detail-sheet__header">
              <span className="message-detail-sheet__label">{messageLabel(selectedMessage.role)}</span>
              <button
                className="message-detail-sheet__close"
                type="button"
                onClick={() => {
                  setDetailsMessageId(null);
                  setDetailsStackExpanded(false);
                }}
                aria-label="Close"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="message-sheet__details">
              {selectedActivity.length === 0 ? (
                <div className="message-sheet__empty">No saved agent activity is available for this reply yet.</div>
              ) : (
                <>
                  {commentaryActivity.length > 0 ? (
                    <div className="message-stack">
                      <button
                        className={`message-stack__summary ${detailsStackExpanded ? 'message-stack__summary--expanded' : ''}`}
                        type="button"
                        onClick={() => setDetailsStackExpanded((current) => !current)}
                      >
                        <div className="message-stack__summary-header">
                          <span className="message-stack__title">Agent updates</span>
                          <span className="message-stack__count">
                            {detailsStackExpanded ? 'Hide updates' : `${commentaryActivity.length} saved`}
                          </span>
                        </div>
                        <div className="message-stack__layers" aria-hidden="true">
                          <span />
                          <span />
                        </div>
                        <article className="message-sheet__detail-card message-sheet__detail-card--stack">
                          <div className="message-sheet__detail-header">
                            <span className="message-sheet__detail-title">{commentaryActivity[0]?.title ?? 'Agent update'}</span>
                            <span
                              className={`message-sheet__detail-status message-sheet__detail-status--${
                                commentaryActivity[0]?.status ?? 'completed'
                              }`}
                            >
                              {(commentaryActivity[0]?.status ?? 'completed').replace('-', ' ')}
                            </span>
                          </div>
                          <div className="message-sheet__detail-kind">intermediate message</div>
                          <p className="message-sheet__detail-summary">{commentaryActivity[0]?.summary ?? ''}</p>
                          {commentaryActivity[0]?.detail ? (
                            <pre className="message-sheet__detail-body">{commentaryActivity[0].detail}</pre>
                          ) : null}
                        </article>
                      </button>

                      {detailsStackExpanded
                        ? commentaryActivity.slice(1).map((entry) => (
                            <article key={entry.id} className="message-sheet__detail-card">
                              <div className="message-sheet__detail-header">
                                <span className="message-sheet__detail-title">{entry.title}</span>
                                <span className={`message-sheet__detail-status message-sheet__detail-status--${entry.status}`}>
                                  {entry.status.replace('-', ' ')}
                                </span>
                              </div>
                              <div className="message-sheet__detail-kind">intermediate message</div>
                              <p className="message-sheet__detail-summary">{entry.summary}</p>
                              {entry.detail ? <pre className="message-sheet__detail-body">{entry.detail}</pre> : null}
                            </article>
                          ))
                        : null}
                    </div>
                  ) : null}

                  {structuredActivity.map((entry) => (
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
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
