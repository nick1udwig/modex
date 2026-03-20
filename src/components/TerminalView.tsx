import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { isTerminalSessionLive, terminalStatusLabel } from '../app/tabs';
import type { TerminalSessionSummary } from '../app/types';
import { buildTerminalAttachUrl } from '../services/sidecarTerminalClient';

interface TerminalViewProps {
  onSessionUpdate: (session: TerminalSessionSummary) => void;
  session: TerminalSessionSummary | null;
}

interface TerminalEvent {
  message?: string;
  session?: TerminalSessionSummary;
  type?: string;
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

const toUint8Array = async (payload: Blob | ArrayBuffer) => {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }

  return new Uint8Array(await payload.arrayBuffer());
};

export const TerminalView = ({ onSessionUpdate, session }: TerminalViewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onSessionUpdateRef = useRef(onSessionUpdate);
  const sessionRef = useRef<TerminalSessionSummary | null>(session);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [connectionLabel, setConnectionLabel] = useState<string | null>(null);

  useEffect(() => {
    onSessionUpdateRef.current = onSessionUpdate;
  }, [onSessionUpdate]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session || !terminalRef.current) {
      return;
    }

    terminalRef.current.options.disableStdin = !isTerminalSessionLive(session.status);
    terminalRef.current.options.cursorBlink = isTerminalSessionLive(session.status);
    setConnectionLabel((current) =>
      current === 'Connection error' ? current : terminalStatusLabel(session.status),
    );
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
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: isTerminalSessionLive(session.status),
      cursorStyle: 'bar',
      disableStdin: !isTerminalSessionLive(session.status),
      fontFamily: '"IBM Plex Mono", "Fira Code", monospace',
      fontSize: 14,
      letterSpacing: 0.2,
      lineHeight: 1.25,
      scrollback: 5_000,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminal.focus();
    terminalRef.current = terminal;

    setConnectionLabel(isTerminalSessionLive(session.status) ? 'Connecting…' : terminalStatusLabel(session.status));

    let connectTimeoutId: number | null = null;
    let disposed = false;
    let socket: WebSocket | null = null;
    let socketOpened = false;

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

    const scheduleResize = () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        fitAddon.fit();
        sendResize();
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleResize();
    });
    resizeObserver.observe(container);

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

    // Delay the attach just one tick so React StrictMode's mount/unmount probe
    // can cancel the first pass before the browser logs a spurious websocket failure.
    connectTimeoutId = window.setTimeout(connectSocket, 0);

    const handlePointerDown = () => {
      terminal.focus();
    };
    container.addEventListener('pointerdown', handlePointerDown);

    return () => {
      disposed = true;
      container.removeEventListener('pointerdown', handlePointerDown);
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
      <div className="terminal-meta">
        <div>
          <p className="terminal-meta__title">{session.currentName}</p>
          <p className="terminal-meta__subtitle">{session.cwd || session.startedName}</p>
        </div>
        <span className={`terminal-meta__status terminal-meta__status--${session.status}`}>{connectionLabel ?? terminalStatusLabel(session.status)}</span>
      </div>
      <div ref={containerRef} className="terminal-canvas" />
    </section>
  );
};
