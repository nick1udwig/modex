import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { isTerminalSessionLive, terminalStatusLabel } from '../app/tabs';
import type { TerminalSessionSummary } from '../app/types';
import { buildTerminalAttachUrl } from '../services/sidecarTerminalClient';
import { getTerminalShortcutSequence, getTerminalTextSequence, type TerminalModifierState } from './terminalInputModel';
import {
  advanceTerminalTouchScroll,
  isTerminalTapGesture,
  resolveTerminalHelperTextAreaTop,
  resolveTerminalTouchScrollLines,
} from './terminalViewModel';

interface TerminalViewProps {
  fontSize: number;
  modifierState: TerminalModifierState;
  onModifierConsumed: () => void;
  onSessionUpdate: (session: TerminalSessionSummary) => void;
  session: TerminalSessionSummary | null;
}

interface TerminalEvent {
  message?: string;
  session?: TerminalSessionSummary;
  type?: string;
}

interface TerminalSearchMatch {
  column: number;
  length: number;
  line: number;
}

interface TerminalSearchState {
  activeIndex: number;
  total: number;
}

interface TerminalSearchStore {
  index: number;
  matches: TerminalSearchMatch[];
  query: string;
}

interface PointerGesture {
  pointerId: number;
  pointerType: string;
  scrollRemainder: number;
  scrolling: boolean;
  startX: number;
  startY: number;
  lastY: number;
}

export interface TerminalViewHandle {
  clearSearch: () => TerminalSearchState;
  focus: () => void;
  search: (query: string, direction?: 'current' | 'next' | 'previous') => TerminalSearchState;
  sendInput: (input: string) => void;
}

const encoder = new TextEncoder();

const terminalTheme = {
  background: '#0b1411',
  black: '#173125',
  blue: '#7ab3ff',
  brightBlack: '#55756b',
  brightBlue: '#9fc7ff',
  brightCyan: '#88e0d5',
  brightGreen: '#b9ff72',
  brightMagenta: '#ff9ae7',
  brightRed: '#ff8d87',
  brightWhite: '#f5f8f6',
  brightYellow: '#ffe387',
  cursor: '#d7f6b9',
  cyan: '#66cfc3',
  foreground: '#eef7f1',
  green: '#99df57',
  magenta: '#eb82d6',
  red: '#ff746d',
  selectionBackground: '#28453a',
  white: '#d7e4dd',
  yellow: '#f6cd63',
};

const EMPTY_SEARCH_STATE: TerminalSearchState = {
  activeIndex: 0,
  total: 0,
};

const EMPTY_SEARCH_STORE: TerminalSearchStore = {
  index: -1,
  matches: [],
  query: '',
};

const toUint8Array = async (payload: Blob | ArrayBuffer) => {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }

  return new Uint8Array(await payload.arrayBuffer());
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const collectSearchMatches = (terminal: Terminal, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const matches: TerminalSearchMatch[] = [];
  const buffer = terminal.buffer.active;
  for (let lineIndex = 0; lineIndex < buffer.length; lineIndex += 1) {
    const line = buffer.getLine(lineIndex)?.translateToString(true) ?? '';
    const normalizedLine = line.toLowerCase();
    let startIndex = normalizedLine.indexOf(normalizedQuery);
    while (startIndex >= 0) {
      matches.push({
        column: startIndex,
        length: normalizedQuery.length,
        line: lineIndex,
      });
      startIndex = normalizedLine.indexOf(normalizedQuery, startIndex + Math.max(normalizedQuery.length, 1));
    }
  }

  return matches;
};

const applySearchMatch = (terminal: Terminal, match: TerminalSearchMatch | null) => {
  if (!match) {
    terminal.clearSelection();
    return;
  }

  terminal.scrollToLine(clamp(match.line - Math.floor(terminal.rows / 2), 0, match.line));
  terminal.select(match.column, match.line, match.length);
};

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  ({ fontSize, modifierState, onModifierConsumed, onSessionUpdate, session }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const focusTerminalRef = useRef<() => void>(() => undefined);
    const helperTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const modifierStateRef = useRef(modifierState);
    const onModifierConsumedRef = useRef(onModifierConsumed);
    const onSessionUpdateRef = useRef(onSessionUpdate);
    const pointerGestureRef = useRef<PointerGesture | null>(null);
    const scheduleResizeRef = useRef<() => void>(() => undefined);
    const searchRef = useRef<(query: string, direction?: 'current' | 'next' | 'previous') => TerminalSearchState>(
      () => EMPTY_SEARCH_STATE,
    );
    const searchStoreRef = useRef<TerminalSearchStore>(EMPTY_SEARCH_STORE);
    const sendInputRef = useRef<(input: string) => void>(() => undefined);
    const sessionRef = useRef<TerminalSessionSummary | null>(session);
    const socketRef = useRef<WebSocket | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const [, setConnectionLabel] = useState<string | null>(null);

    useEffect(() => {
      modifierStateRef.current = modifierState;
    }, [modifierState]);

    useEffect(() => {
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }

      terminal.options.fontSize = fontSize;
      scheduleResizeRef.current();
    }, [fontSize]);

    useEffect(() => {
      onModifierConsumedRef.current = onModifierConsumed;
    }, [onModifierConsumed]);

    useEffect(() => {
      onSessionUpdateRef.current = onSessionUpdate;
    }, [onSessionUpdate]);

    useEffect(() => {
      sessionRef.current = session;
    }, [session]);

    useImperativeHandle(
      ref,
      () => ({
        clearSearch: () => searchRef.current(''),
        focus: () => focusTerminalRef.current(),
        search: (query, direction = 'current') => searchRef.current(query, direction),
        sendInput: (input) => {
          sendInputRef.current(input);
          focusTerminalRef.current();
        },
      }),
      [],
    );

    useEffect(() => {
      if (!session || !terminalRef.current) {
        return;
      }

      terminalRef.current.options.disableStdin = !isTerminalSessionLive(session.status);
      terminalRef.current.options.cursorBlink = isTerminalSessionLive(session.status);
      setConnectionLabel((current) => (current === 'Connection error' ? current : terminalStatusLabel(session.status)));
    }, [session?.idHash, session?.status]);

    useEffect(() => {
      fitAddonRef.current?.fit();
    }, [session?.idHash]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !session) {
        return;
      }

      container.innerHTML = '';
      searchStoreRef.current = EMPTY_SEARCH_STORE;

      const terminal = new Terminal({
        allowTransparency: true,
        convertEol: false,
        cursorBlink: isTerminalSessionLive(session.status),
        cursorStyle: 'bar',
        disableStdin: !isTerminalSessionLive(session.status),
        fontFamily: '"IBM Plex Mono", "Fira Code", monospace',
        fontSize,
        letterSpacing: 0.2,
        lineHeight: 1.25,
        scrollback: 5_000,
        theme: terminalTheme,
      });
      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      const helperTextarea = container.querySelector('.xterm-helper-textarea');
      helperTextareaRef.current = helperTextarea instanceof HTMLTextAreaElement ? helperTextarea : null;
      fitAddon.fit();
      terminalRef.current = terminal;

      setConnectionLabel(isTerminalSessionLive(session.status) ? 'Connecting…' : terminalStatusLabel(session.status));

      let connectTimeoutId: number | null = null;
      let disposed = false;
      let socket: WebSocket | null = null;
      let socketOpened = false;

      const sendTerminalInput = (input: string) => {
        if (
          !input ||
          !isTerminalSessionLive(sessionRef.current?.status ?? session.status) ||
          !socketRef.current ||
          socketRef.current.readyState !== WebSocket.OPEN
        ) {
          return;
        }

        socketRef.current.send(encoder.encode(input));
      };

      sendInputRef.current = sendTerminalInput;

      const setKeyboardEnabled = (enabled: boolean) => {
        const textarea = helperTextareaRef.current;
        if (!textarea) {
          return;
        }

        textarea.readOnly = !enabled;
        textarea.inputMode = enabled ? 'text' : 'none';
      };

      const syncHelperTextareaPosition = () => {
        const textarea = helperTextareaRef.current;
        if (!textarea) {
          return;
        }

        const visualViewport = window.visualViewport;
        const top = resolveTerminalHelperTextAreaTop(
          visualViewport?.height ?? window.innerHeight,
          visualViewport?.offsetTop ?? 0,
        );

        textarea.style.position = 'fixed';
        textarea.style.top = `${top}px`;
        textarea.style.left = '12px';
        textarea.style.width = '1px';
        textarea.style.height = '1px';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
      };

      const focusTerminal = () => {
        setKeyboardEnabled(true);
        syncHelperTextareaPosition();
        terminal.focus();
        helperTextareaRef.current?.focus({ preventScroll: true });
      };

      focusTerminalRef.current = focusTerminal;
      syncHelperTextareaPosition();
      setKeyboardEnabled(false);

      const sendResize = () => {
        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        socketRef.current.send(
          JSON.stringify({
            cols: terminal.cols,
            rows: terminal.rows,
            type: 'resize',
          }),
        );
      };

      const runSearch = (query: string, direction: 'current' | 'next' | 'previous' = 'current') => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
          searchStoreRef.current = EMPTY_SEARCH_STORE;
          terminal.clearSelection();
          return EMPTY_SEARCH_STATE;
        }

        const sameQuery = searchStoreRef.current.query === normalizedQuery;
        const matches = sameQuery ? searchStoreRef.current.matches : collectSearchMatches(terminal, normalizedQuery);
        if (matches.length === 0) {
          searchStoreRef.current = {
            index: -1,
            matches,
            query: normalizedQuery,
          };
          terminal.clearSelection();
          return EMPTY_SEARCH_STATE;
        }

        let index = sameQuery ? searchStoreRef.current.index : 0;
        if (index < 0) {
          index = 0;
        }

        if (direction === 'next') {
          index = sameQuery ? (index + 1) % matches.length : 0;
        } else if (direction === 'previous') {
          index = sameQuery ? (index - 1 + matches.length) % matches.length : matches.length - 1;
        }

        searchStoreRef.current = {
          index,
          matches,
          query: normalizedQuery,
        };
        applySearchMatch(terminal, matches[index] ?? null);

        return {
          activeIndex: index + 1,
          total: matches.length,
        };
      };

      searchRef.current = runSearch;

      const scheduleResize = () => {
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
        }

        resizeFrameRef.current = window.requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          fitAddon.fit();
          syncHelperTextareaPosition();
          sendResize();
        });
      };
      scheduleResizeRef.current = scheduleResize;

      const resizeObserver = new ResizeObserver(() => {
        scheduleResize();
      });
      resizeObserver.observe(container);

      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') {
          return true;
        }

        const modifiers = modifierStateRef.current;
        if (!modifiers.ctrl && !modifiers.alt) {
          return true;
        }

        let sequence = '';
        if (event.key === 'Escape') {
          sequence = getTerminalShortcutSequence('esc', modifiers);
        } else if (event.key === 'Tab') {
          sequence = getTerminalShortcutSequence('tab', modifiers);
        } else if (event.key.length === 1) {
          sequence = getTerminalTextSequence(event.key, modifiers);
        }

        if (!sequence) {
          return true;
        }

        event.preventDefault();
        sendTerminalInput(sequence);
        onModifierConsumedRef.current();
        focusTerminal();
        return false;
      });

      const removeInputListener = terminal.onData((data) => {
        if (!isTerminalSessionLive(sessionRef.current?.status ?? session.status) || socket?.readyState !== WebSocket.OPEN) {
          return;
        }

        socket.send(encoder.encode(data));
      });

      const connectSocket = () => {
        if (disposed) {
          return;
        }

        socket = new WebSocket(buildTerminalAttachUrl(session.idHash, terminal.rows, terminal.cols));
        socket.binaryType = 'arraybuffer';
        socketRef.current = socket;

        socket.addEventListener('open', () => {
          if (disposed) {
            socket?.close();
            return;
          }

          socketOpened = true;
          setConnectionLabel(isTerminalSessionLive(session.status) ? 'Live session' : terminalStatusLabel(session.status));
          sendResize();
        });

        socket.addEventListener('message', (event) => {
          if (typeof event.data === 'string') {
            try {
              const payload = JSON.parse(event.data) as TerminalEvent;
              if (payload.type === 'terminal.session' && payload.session) {
                sessionRef.current = payload.session;
                onSessionUpdateRef.current(payload.session);
                setConnectionLabel(terminalStatusLabel(payload.session.status));
                terminal.options.disableStdin = !isTerminalSessionLive(payload.session.status);
                terminal.options.cursorBlink = isTerminalSessionLive(payload.session.status);
              } else if (payload.type === 'terminal.error' && payload.message) {
                terminal.writeln(`\r\n[modex] ${payload.message}`);
                setConnectionLabel('Connection error');
              }
            } catch {
              // Ignore malformed control frames.
            }
            return;
          }

          void toUint8Array(event.data as Blob | ArrayBuffer).then((bytes) => {
            terminal.write(bytes);
          });
        });

        socket.addEventListener('close', () => {
          setConnectionLabel(terminalStatusLabel(sessionRef.current?.status ?? session.status));
        });

        socket.addEventListener('error', () => {
          setConnectionLabel('Connection error');
        });
      };

      connectTimeoutId = window.setTimeout(connectSocket, 0);

      const handlePointerDown = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
          return;
        }

        setKeyboardEnabled(false);
        if (!container.hasPointerCapture(event.pointerId)) {
          container.setPointerCapture(event.pointerId);
        }
        pointerGestureRef.current = {
          lastY: event.clientY,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          scrollRemainder: 0,
          scrolling: false,
          startX: event.clientX,
          startY: event.clientY,
        };
      };

      const handlePointerMove = (event: PointerEvent) => {
        const gesture = pointerGestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId || gesture.pointerType === 'mouse') {
          return;
        }

        const { nextState, scrollDelta } = advanceTerminalTouchScroll(
          {
            lastY: gesture.lastY,
            scrolling: gesture.scrolling,
            startY: gesture.startY,
          },
          event.clientY,
        );

        const nextGesture = {
          ...gesture,
          lastY: nextState.lastY,
          scrolling: nextState.scrolling,
        };
        pointerGestureRef.current = nextGesture;

        if (!nextState.scrolling) {
          return;
        }

        event.preventDefault();
        helperTextareaRef.current?.blur();
        const terminal = terminalRef.current;
        if (!terminal) {
          return;
        }

        const helperHeight = helperTextareaRef.current?.getBoundingClientRect().height ?? 0;
        const rowHeight = Math.max(helperHeight, Number(terminal.options.fontSize ?? fontSize) * 1.25, 12);
        const { lineDelta, scrollRemainder } = resolveTerminalTouchScrollLines(nextGesture.scrollRemainder, scrollDelta, rowHeight);

        pointerGestureRef.current = {
          ...nextGesture,
          scrollRemainder,
        };

        if (lineDelta !== 0) {
          terminal.scrollLines(lineDelta);
        }
      };

      const handlePointerUp = (event: PointerEvent) => {
        const gesture = pointerGestureRef.current;
        pointerGestureRef.current = null;
        if (container.hasPointerCapture(event.pointerId)) {
          container.releasePointerCapture(event.pointerId);
        }

        if (!gesture || gesture.pointerId !== event.pointerId) {
          return;
        }

        if (gesture.scrolling) {
          helperTextareaRef.current?.blur();
          return;
        }

        if (isTerminalTapGesture({ x: gesture.startX, y: gesture.startY }, { x: event.clientX, y: event.clientY })) {
          focusTerminal();
          return;
        }

        helperTextareaRef.current?.blur();
      };

      const clearPointerGesture = () => {
        pointerGestureRef.current = null;
      };

      const handleBlur = () => {
        setKeyboardEnabled(false);
      };

      container.addEventListener('pointerdown', handlePointerDown);
      container.addEventListener('pointermove', handlePointerMove);
      container.addEventListener('pointerup', handlePointerUp);
      container.addEventListener('pointercancel', clearPointerGesture);
      helperTextareaRef.current?.addEventListener('blur', handleBlur);

      return () => {
        disposed = true;
        container.removeEventListener('pointerdown', handlePointerDown);
        container.removeEventListener('pointermove', handlePointerMove);
        container.removeEventListener('pointerup', handlePointerUp);
        container.removeEventListener('pointercancel', clearPointerGesture);
        helperTextareaRef.current?.removeEventListener('blur', handleBlur);
        resizeObserver.disconnect();
        removeInputListener.dispose();
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        if (connectTimeoutId !== null) {
          window.clearTimeout(connectTimeoutId);
          connectTimeoutId = null;
        }
        if (socketOpened && socket) {
          socket.close();
        }
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        searchRef.current = () => EMPTY_SEARCH_STATE;
        searchStoreRef.current = EMPTY_SEARCH_STORE;
        focusTerminalRef.current = () => undefined;
        helperTextareaRef.current = null;
        scheduleResizeRef.current = () => undefined;
        sendInputRef.current = () => undefined;
        terminal.dispose();
        if (fitAddonRef.current === fitAddon) {
          fitAddonRef.current = null;
        }
        if (terminalRef.current === terminal) {
          terminalRef.current = null;
        }
      };
    }, [session?.idHash]);

    if (!session) {
      return <div className="terminal-empty">Open or create a tmuy session to attach a terminal tab.</div>;
    }

    return (
      <section className="terminal-screen" aria-label="Terminal session">
        <div className="terminal-canvas-shell">
          <div ref={containerRef} className="terminal-canvas" />
        </div>
      </section>
    );
  },
);

TerminalView.displayName = 'TerminalView';
