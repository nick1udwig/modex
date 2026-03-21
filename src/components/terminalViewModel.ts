interface Point {
  x: number;
  y: number;
}

interface TerminalTouchScrollState {
  lastY: number;
  scrolling: boolean;
  startY: number;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

interface TerminalAttachmentPresentationInput {
  attached: boolean;
  liveSession: boolean;
  sessionLabel: string;
}

interface TerminalReconnectInput {
  liveSession: boolean;
  readyState: number | null;
  visible: boolean;
}

export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MAX_TERMINAL_FONT_SIZE = 18;
export const MIN_TERMINAL_FONT_SIZE = 11;
export const TERMINAL_FONT_SIZE_STORAGE_KEY = 'modex.terminal.fontSize';
export const TERMINAL_SOCKET_CONNECTING = 0;
export const TERMINAL_SOCKET_OPEN = 1;

const TAP_DISTANCE_THRESHOLD = 10;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const browserStorage = (): StorageLike | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const clampTerminalFontSize = (value: number) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }

  return clamp(Math.round(value), MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE);
};

export const isTerminalTapGesture = (start: Point, end: Point, threshold = TAP_DISTANCE_THRESHOLD) =>
  Math.hypot(end.x - start.x, end.y - start.y) <= threshold;

export const advanceTerminalTouchScroll = (state: TerminalTouchScrollState, nextY: number, threshold = TAP_DISTANCE_THRESHOLD) => {
  const scrolling = state.scrolling || Math.abs(nextY - state.startY) > threshold;
  return {
    nextState: {
      lastY: nextY,
      scrolling,
      startY: state.startY,
    } satisfies TerminalTouchScrollState,
    scrollDelta: scrolling ? state.lastY - nextY : 0,
  };
};

export const resolveTerminalTouchScrollLines = (scrollRemainder: number, scrollDelta: number, rowHeight: number) => {
  const safeRowHeight = Math.max(1, rowHeight);
  const totalDelta = scrollRemainder + scrollDelta;
  const lineDelta = totalDelta > 0 ? Math.floor(totalDelta / safeRowHeight) : Math.ceil(totalDelta / safeRowHeight);

  return {
    lineDelta,
    scrollRemainder: totalDelta - lineDelta * safeRowHeight,
  };
};

export const resolveTerminalAttachmentPresentation = ({
  attached,
  liveSession,
  sessionLabel,
}: TerminalAttachmentPresentationInput) => ({
  connectionLabel: liveSession ? (attached ? 'Live session' : 'Loading…') : sessionLabel,
  cursorBlink: liveSession && attached,
  disableStdin: !liveSession || !attached,
  showLoading: liveSession && !attached,
});

export const shouldReconnectTerminalAttach = ({ liveSession, readyState, visible }: TerminalReconnectInput) =>
  liveSession && visible && readyState !== TERMINAL_SOCKET_CONNECTING && readyState !== TERMINAL_SOCKET_OPEN;

export const persistTerminalFontSize = (value: number, storage: StorageLike | null = browserStorage()) => {
  const nextValue = clampTerminalFontSize(value);
  storage?.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, `${nextValue}`);
  return nextValue;
};

export const readTerminalFontSize = (storage: StorageLike | null = browserStorage()) => {
  const rawValue = storage?.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY)?.trim();
  if (!rawValue) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }

  return clampTerminalFontSize(parsedValue);
};

export const resolveTerminalHelperTextAreaTop = (viewportHeight: number, offsetTop = 0, bottomInset = 18) =>
  Math.max(0, Math.round(offsetTop + viewportHeight - bottomInset));

export const stepTerminalFontSize = (current: number, direction: -1 | 1) => clampTerminalFontSize(current + direction);
