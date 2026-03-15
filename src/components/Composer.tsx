import { useEffect, useRef, useState } from 'react';
import type { AccessMode } from '../app/types';
import { Icon } from './Icon';

type FooterAction = 'tabs' | 'new-tab';

interface ComposerProps {
  accessMode: AccessMode | null;
  busy: boolean;
  draft: string;
  error: string | null;
  footerAction: FooterAction;
  inputDisabled?: boolean;
  maskFooterAction?: boolean;
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
  onToggleVoiceInput: () => void;
  onToggleAccessMode: (mode: AccessMode) => void;
  openTabCount: number;
  recording: boolean;
  registerFooterActionNode?: (node: HTMLButtonElement | null) => void;
  searchActive: boolean;
  searchHitLabel: string | null;
  searchQuery: string;
}

export const Composer = ({
  accessMode,
  busy,
  draft,
  error,
  footerAction,
  inputDisabled = false,
  maskFooterAction = false,
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
  onToggleVoiceInput,
  onToggleAccessMode,
  openTabCount,
  recording,
  registerFooterActionNode,
  searchActive,
  searchHitLabel,
  searchQuery,
}: ComposerProps) => {
  const composerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasDraft = draft.trim().length > 0;
  const showSend = !searchActive && hasDraft && !recording;

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    inputRef.current.style.height = '20px';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 72)}px`;
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
      {error ? <p className="composer-error">{error}</p> : null}

      <div className="composer-row">
        <button
          className="footer-icon footer-icon--muted"
          type="button"
          onClick={searchActive ? onCloseSearch : onCreateChat}
          aria-label={searchActive ? 'Exit search' : 'Create a new chat'}
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
            }`}
            type="button"
            onClick={() => {
              if (showSend && !busy) {
                onSend();
                return;
              }

              onToggleVoiceInput();
            }}
            aria-label={showSend ? 'Send message' : recording ? 'Stop voice input' : 'Voice input'}
            aria-pressed={recording}
            aria-disabled={showSend ? busy : false}
          >
            <Icon name={showSend ? 'arrow-up' : 'mic'} size={16} />
          </button>
        </div>
      </div>

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
