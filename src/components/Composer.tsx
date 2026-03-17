import { useEffect, useRef, useState } from 'react';
import type { AccessMode, ApprovalDecision, InteractionRequest, PendingAttachment } from '../app/types';
import { Icon } from './Icon';
import { InteractionPrompt } from './InteractionPrompt';

type FooterAction = 'tabs' | 'new-tab';

interface ComposerProps {
  accessMode: AccessMode | null;
  attachments: PendingAttachment[];
  busy: boolean;
  draft: string;
  error: string | null;
  footerAction: FooterAction;
  inputDisabled?: boolean;
  interactionRequest: InteractionRequest | null;
  maskFooterAction?: boolean;
  onAttachFiles: (files: FileList) => void;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onCloseSearch: () => void;
  onCreateChat: () => void;
  onDraftChange: (value: string) => void;
  onEditDirectories?: () => void;
  onOpenSearch: () => void;
  onOpenTabs: () => void;
  onSearchNext: () => void;
  onSearchPrevious: () => void;
  onSearchQueryChange: (value: string) => void;
  onSend: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onStopRun: () => void;
  onSubmitUserInput: (answers: Record<string, string[]>) => void;
  onToggleVoiceInput: () => void;
  onToggleAccessMode: (mode: AccessMode) => void;
  openTabCount: number;
  recording: boolean;
  recordingStatus?: 'connecting' | 'processing' | 'recording' | null;
  registerFooterActionNode?: (node: HTMLButtonElement | null) => void;
  searchActive: boolean;
  searchHitLabel: string | null;
  searchQuery: string;
}

export const Composer = ({
  accessMode,
  attachments,
  busy,
  draft,
  error,
  footerAction,
  inputDisabled = false,
  interactionRequest,
  maskFooterAction = false,
  onAttachFiles,
  onApprovalDecision,
  onCloseSearch,
  onCreateChat,
  onDraftChange,
  onEditDirectories,
  onOpenSearch,
  onOpenTabs,
  onSearchNext,
  onSearchPrevious,
  onSearchQueryChange,
  onSend,
  onRemoveAttachment,
  onStopRun,
  onSubmitUserInput,
  onToggleVoiceInput,
  onToggleAccessMode,
  openTabCount,
  recording,
  recordingStatus = null,
  registerFooterActionNode,
  searchActive,
  searchHitLabel,
  searchQuery,
}: ComposerProps) => {
  const composerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasDraft = draft.trim().length > 0;
  const voiceProcessing = recordingStatus === 'processing';
  const showStop = busy && !recording;
  const showSend = !showStop && !searchActive && (hasDraft || attachments.length > 0) && !recording;
  const recordingLabel = recordingStatus === 'connecting' ? 'Starting voice' : voiceProcessing ? 'Finishing voice' : 'Transcribing';

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    inputRef.current.style.height = '24px';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 96)}px`;
    inputRef.current.scrollTop = inputRef.current.scrollHeight;
  }, [draft, searchActive, searchQuery]);

  useEffect(() => {
    if (footerAction !== 'new-tab') {
      registerFooterActionNode?.(null);
    }
  }, [footerAction, registerFooterActionNode]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (composerRef.current?.contains(event.target as Node)) {
        return;
      }

      setMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (searchActive) {
      setMenuOpen(false);
    }
  }, [searchActive]);

  return (
    <div ref={composerRef} className={`composer-shell ${searchActive ? 'composer-shell--search' : ''}`}>
      {interactionRequest ? (
        <InteractionPrompt
          request={interactionRequest}
          onApprovalDecision={onApprovalDecision}
          onSubmitUserInput={onSubmitUserInput}
        />
      ) : null}

      {error ? <p className="composer-error">{error}</p> : null}

      {attachments.length > 0 ? (
        <div className="composer-attachments" aria-label="Pending attachments">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="composer-attachment">
              <span className="composer-attachment__name">{attachment.name}</span>
              <button
                className="composer-attachment__remove"
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
                aria-label={`Remove ${attachment.name}`}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="composer-row">
        <button
          className="footer-icon footer-icon--muted"
          type="button"
          onClick={() => {
            if (searchActive) {
              onCloseSearch();
              return;
            }

            fileInputRef.current?.click();
          }}
          aria-label={searchActive ? 'Exit search' : 'Attach a file or photo'}
        >
          <Icon name={searchActive ? 'arrow-left' : 'plus'} size={16} />
        </button>

        <div className="composer-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={searchActive ? searchQuery : draft}
            disabled={inputDisabled}
            placeholder={searchActive ? 'Search query' : 'Ask anything'}
            aria-label={searchActive ? 'Search query' : 'Ask anything'}
            onChange={(event) => (searchActive ? onSearchQueryChange(event.target.value) : onDraftChange(event.target.value))}
            onKeyDown={(event) => {
              if (inputDisabled) {
                return;
              }

              if (searchActive) {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSearchNext();
                }
                return;
              }

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (hasDraft && !busy) {
                  onSend();
                }
              }
            }}
          />

          <button
            className={`composer-send ${showSend ? 'composer-send--active' : ''} ${
              recording ? 'composer-send--recording' : ''
            } ${showStop ? 'composer-send--stop' : ''}`}
            type="button"
            onClick={() => {
              if (showStop) {
                onStopRun();
                return;
              }

              if (showSend && !busy) {
                onSend();
                return;
              }

              if (voiceProcessing) {
                return;
              }

              onToggleVoiceInput();
            }}
            aria-label={
              showStop
                ? 'Stop current run'
                : showSend
                  ? 'Send message'
                  : voiceProcessing
                    ? 'Finishing voice input'
                    : recording
                    ? `${recordingLabel}. Tap to stop voice input`
                    : 'Voice input'
            }
            aria-pressed={recording || showStop}
            aria-disabled={showSend ? busy : voiceProcessing}
          >
            <Icon name={showStop ? 'stop' : showSend ? 'arrow-up' : 'mic'} size={16} />
            {recording ? <span className="composer-send__label">{recordingLabel}</span> : null}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="composer-file-input"
        type="file"
        multiple
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            onAttachFiles(event.target.files);
          }
          event.target.value = '';
        }}
      />

      <div className={`footer-nav ${searchActive ? 'footer-nav--search' : ''}`}>
        {searchActive ? (
          <>
            <button className="footer-icon footer-icon--light" type="button" onClick={onSearchPrevious} aria-label="Previous search result">
              <Icon name="arrow-up" size={16} />
            </button>

            <div className="footer-search-meta">{searchHitLabel ?? 'No hits'}</div>

            <button className="footer-icon footer-icon--light" type="button" onClick={onSearchNext} aria-label="Next search result">
              <Icon name="arrow-down" size={16} />
            </button>
          </>
        ) : (
          <>
            <button className="footer-icon footer-icon--light" type="button" onClick={onOpenSearch} aria-label="Search">
              <Icon name="search" size={18} />
            </button>

            {footerAction === 'new-tab' ? (
              <button
                ref={registerFooterActionNode}
                className={`footer-action footer-action--primary ${maskFooterAction ? 'footer-action--masked' : ''}`}
                type="button"
                onClick={onCreateChat}
                aria-label="Create a new tab"
              >
                <Icon name="plus" size={14} />
              </button>
            ) : (
              <button
                className="footer-action footer-action--tabs"
                type="button"
                onClick={onOpenTabs}
                aria-label="Open tabs"
              >
                <span>{openTabCount}</span>
              </button>
            )}

            <div className="footer-menu">
              <button
                className="footer-icon footer-icon--muted"
                type="button"
                onClick={() => {
                  if (accessMode) {
                    setMenuOpen((current) => !current);
                  }
                }}
                aria-label="More actions"
                aria-disabled={!accessMode}
              >
                <Icon name="ellipsis" size={18} />
              </button>

              {menuOpen && accessMode ? (
                <div className="footer-menu__panel">
                  <div className="footer-menu__label">Access</div>
                  <div className="footer-menu__toggle">
                    <button
                      className={`footer-menu__toggle-button ${
                        accessMode === 'read-only' ? 'footer-menu__toggle-button--active' : ''
                      }`}
                      type="button"
                      onClick={() => {
                        onToggleAccessMode('read-only');
                        setMenuOpen(false);
                      }}
                    >
                      Read
                    </button>
                    <button
                      className={`footer-menu__toggle-button ${
                        accessMode === 'workspace-write' ? 'footer-menu__toggle-button--active' : ''
                      }`}
                      type="button"
                      onClick={() => {
                        onToggleAccessMode('workspace-write');
                        setMenuOpen(false);
                      }}
                    >
                      Write
                    </button>
                  </div>

                  {onEditDirectories ? (
                    <button
                      className="footer-menu__secondary"
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onEditDirectories();
                      }}
                    >
                      Edit directories
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
