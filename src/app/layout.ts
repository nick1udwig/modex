export interface ViewportSize {
  height: number;
  width: number;
}

const KEYBOARD_VIEWPORT_DELTA_PX = 160;

interface ViewportWindowLike {
  innerHeight: number;
  innerWidth: number;
  visualViewport?: {
    height: number;
    offsetTop?: number;
    width: number;
  } | null;
}

export const DEFAULT_VIEWPORT_SIZE: ViewportSize = {
  height: 0,
  width: 402,
};

export const shouldUseWideShell = ({ height, width }: ViewportSize) => width >= 700 || (width >= 540 && width > height);

export const resolveViewportSize = (windowLike: ViewportWindowLike): ViewportSize => {
  const visualViewportHeight = windowLike.visualViewport
    ? Math.round(windowLike.visualViewport.height + (windowLike.visualViewport.offsetTop ?? 0))
    : windowLike.innerHeight;
  const shouldUseVisualViewportHeight = windowLike.innerHeight - visualViewportHeight > KEYBOARD_VIEWPORT_DELTA_PX;

  return {
    height: shouldUseVisualViewportHeight ? Math.min(windowLike.innerHeight, visualViewportHeight) : windowLike.innerHeight,
    width: windowLike.visualViewport?.width ?? windowLike.innerWidth,
  };
};

export const readViewportSize = (): ViewportSize => {
  if (typeof window === 'undefined') {
    return DEFAULT_VIEWPORT_SIZE;
  }

  return resolveViewportSize(window);
};
