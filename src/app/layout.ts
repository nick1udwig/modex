export interface ViewportSize {
  height: number;
  width: number;
}

export const DEFAULT_VIEWPORT_SIZE: ViewportSize = {
  height: 0,
  width: 402,
};

export const shouldUseWideShell = ({ height, width }: ViewportSize) => width >= 700 || (width >= 540 && width > height);

export const readViewportSize = (): ViewportSize => {
  if (typeof window === 'undefined') {
    return DEFAULT_VIEWPORT_SIZE;
  }

  return {
    height: window.innerHeight,
    width: window.innerWidth,
  };
};
