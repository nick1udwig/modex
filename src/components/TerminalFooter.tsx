import { useEffect, useRef, useState } from 'react';
import { FooterNavBar } from './FooterNavBar';
import { Icon } from './Icon';
import { focusTextInputWithoutPageJump } from './textInputFocus';
import {
  TERMINAL_SHORTCUT_BUTTONS,
  type TerminalModifierState,
  type TerminalShortcutKey,
} from './terminalInputModel';
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from './terminalViewModel';

interface TerminalSearchState {
  activeIndex: number;
  total: number;
}

interface TerminalFooterProps {
  fontSize: number;
  onAdjustFontSize: (direction: -1 | 1) => void;
  onFocusTerminal: () => void;
  modifierState: TerminalModifierState;
  onModifierToggle: (modifier: 'alt' | 'ctrl') => void;
  onOpenTabs: () => void;
  onRunSearch: (query: string, direction: 'current' | 'next' | 'previous') => TerminalSearchState;
  onSendShortcut: (key: Exclude<TerminalShortcutKey, 'alt' | 'ctrl'>) => void;
  onToggleVoiceInput: () => void;
  openTabCount: number;
  recording: boolean;
  recordingStatus?: 'connecting' | 'processing' | 'recording' | null;
  sessionId: string | null;
}

const formatSearchHitLabel = ({ activeIndex, total }: TerminalSearchState) => `${total === 0 ? 0 : activeIndex}/${total}`;

export const TerminalFooter = ({
  fontSize,
  onAdjustFontSize,
  onFocusTerminal,
  modifierState,
  onModifierToggle,
  onOpenTabs,
  onRunSearch,
  onSendShortcut,
  onToggleVoiceInput,
  openTabCount,
  recording,
  recordingStatus = null,
  sessionId,
}: TerminalFooterProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchHitLabel, setSearchHitLabel] = useState('0/0');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const voiceProcessing = recordingStatus === 'processing';
  const recordingLabel = recordingStatus === 'connecting' ? 'Starting voice' : voiceProcessing ? 'Finishing voice' : 'Transcribing';

  useEffect(() => {
    setMenuOpen(false);
    setSearchActive(false);
    setSearchHitLabel('0/0');
    setSearchQuery('');
  }, [sessionId]);

  const syncSearch = (query: string, direction: 'current' | 'next' | 'previous' = 'current') => {
    const nextState = onRunSearch(query, direction);
    setSearchHitLabel(formatSearchHitLabel(nextState));
  };

  const focusSearchInput = () => {
    focusTextInputWithoutPageJump(searchInputRef.current, document.activeElement);
  };

  const handleSearchInputPress = (input: HTMLInputElement, event: { preventDefault: () => void }) => {
    focusTextInputWithoutPageJump(input, document.activeElement, event);
  };

  return (
    <div className="terminal-footer">
      {searchActive ? (
        <div className="composer-row terminal-footer__search-row">
          <button
            className="footer-icon footer-icon--muted"
            type="button"
            onClick={() => {
              setSearchActive(false);
              setSearchQuery('');
              setSearchHitLabel('0/0');
              onRunSearch('', 'current');
            }}
            aria-label="Exit search"
          >
            <Icon name="arrow-left" size={16} />
          </button>

          <div className="composer-input terminal-footer__search-input-shell">
            <input
              ref={searchInputRef}
              className="terminal-footer__search-input"
              type="text"
              value={searchQuery}
              placeholder="Search terminal"
              aria-label="Search terminal"
              onFocus={() => {
                window.requestAnimationFrame(() => {
                  document.scrollingElement?.scrollTo({ top: 0 });
                });
              }}
              onMouseDown={(event) => handleSearchInputPress(event.currentTarget, event)}
              onTouchStart={(event) => handleSearchInputPress(event.currentTarget, event)}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setSearchQuery(nextQuery);
                syncSearch(nextQuery);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  syncSearch(searchQuery, 'next');
                }
              }}
            />
          </div>
        </div>
      ) : (
        <div className="terminal-shortcuts" aria-label="Terminal shortcut keys">
          {TERMINAL_SHORTCUT_BUTTONS.map((shortcut) => {
            const active =
              (shortcut.key === 'ctrl' && modifierState.ctrl) || (shortcut.key === 'alt' && modifierState.alt);

            return (
              <button
                key={shortcut.key}
                className={`terminal-shortcuts__key ${active ? 'terminal-shortcuts__key--active' : ''}`}
                type="button"
                onClick={() => {
                  if (shortcut.modifier) {
                    onModifierToggle(shortcut.key as 'alt' | 'ctrl');
                    onFocusTerminal();
                    return;
                  }

                  onSendShortcut(shortcut.key as Exclude<TerminalShortcutKey, 'alt' | 'ctrl'>);
                }}
                aria-pressed={shortcut.modifier ? active : undefined}
              >
                {shortcut.label}
              </button>
            );
          })}
        </div>
      )}

      <FooterNavBar
        navWidth={searchActive ? 'full' : 'wide'}
        variant={searchActive ? 'search' : 'terminal'}
        leading={
          searchActive ? (
            <button className="footer-icon footer-icon--light" type="button" onClick={() => syncSearch(searchQuery, 'previous')} aria-label="Previous search result">
              <Icon name="arrow-up" size={16} />
            </button>
          ) : (
            <button
              className="footer-icon footer-icon--light"
              type="button"
              onClick={() => {
                setSearchActive(true);
                setMenuOpen(false);
                syncSearch(searchQuery);
              }}
              aria-label="Search"
            >
              <Icon name="search" size={18} />
            </button>
          )
        }
        center={
          searchActive ? (
            <div className="footer-search-meta">{searchHitLabel}</div>
          ) : (
            <button className="footer-action footer-action--tabs" type="button" onClick={onOpenTabs} aria-label="Open tabs">
              <span>{openTabCount}</span>
            </button>
          )
        }
        trailing={
          searchActive ? (
            <button className="footer-icon footer-icon--light" type="button" onClick={() => syncSearch(searchQuery, 'next')} aria-label="Next search result">
              <Icon name="arrow-down" size={16} />
            </button>
          ) : (
            <div className="terminal-footer__nav-actions">
              <div className="footer-menu">
                <button
                  className="footer-icon footer-icon--muted"
                  type="button"
                  onClick={() => setMenuOpen((current) => !current)}
                  aria-label="More actions"
                >
                  <Icon name="ellipsis" size={18} />
                </button>

                {menuOpen ? (
                  <div className="footer-menu__panel terminal-footer__menu">
                    <div className="footer-menu__label">Text size</div>
                    <div className="footer-menu__toggle terminal-footer__font-controls">
                      <button
                        className="footer-menu__toggle-button"
                        type="button"
                        onClick={() => onAdjustFontSize(-1)}
                        aria-label="Smaller terminal text"
                        disabled={fontSize <= MIN_TERMINAL_FONT_SIZE}
                      >
                        A-
                      </button>
                      <div className="footer-menu__toggle-button footer-menu__toggle-button--active terminal-footer__font-value">
                        {fontSize}px
                      </div>
                      <button
                        className="footer-menu__toggle-button"
                        type="button"
                        onClick={() => onAdjustFontSize(1)}
                        aria-label="Larger terminal text"
                        disabled={fontSize >= MAX_TERMINAL_FONT_SIZE}
                      >
                        A+
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                className={`composer-send ${recording ? 'composer-send--recording' : ''}`}
                type="button"
                onClick={onToggleVoiceInput}
                aria-label={
                  voiceProcessing
                    ? 'Finishing voice input'
                    : recording
                      ? `${recordingLabel}. Tap to stop voice input`
                      : 'Voice input'
                }
                aria-pressed={recording}
                aria-disabled={voiceProcessing}
              >
                <Icon name="mic" size={16} />
              </button>
            </div>
          )
        }
      />
    </div>
  );
};
