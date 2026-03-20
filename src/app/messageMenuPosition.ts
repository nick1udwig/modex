interface RectLike {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface SizeLike {
  height: number;
  width: number;
}

interface ViewportLike {
  height: number;
  offsetLeft?: number;
  offsetTop?: number;
  width: number;
}

interface WindowLike {
  innerHeight: number;
  innerWidth: number;
  visualViewport?: {
    height: number;
    offsetLeft?: number;
    offsetTop?: number;
    width: number;
  } | null;
}

export interface MenuPosition {
  left: number;
  top: number;
}

const EDGE_MARGIN_PX = 16;
const GAP_PX = 10;

export const messageMenuViewport = (windowLike: WindowLike): ViewportLike => ({
  height: windowLike.visualViewport?.height ?? windowLike.innerHeight,
  offsetLeft: windowLike.visualViewport?.offsetLeft ?? 0,
  offsetTop: windowLike.visualViewport?.offsetTop ?? 0,
  width: windowLike.visualViewport?.width ?? windowLike.innerWidth,
});

export const positionMessageMenu = (
  anchorRect: RectLike,
  menuSize: SizeLike,
  viewport: ViewportLike,
): MenuPosition => {
  const viewportLeft = (viewport.offsetLeft ?? 0) + EDGE_MARGIN_PX;
  const viewportRight = (viewport.offsetLeft ?? 0) + viewport.width - EDGE_MARGIN_PX;
  const viewportTop = (viewport.offsetTop ?? 0) + EDGE_MARGIN_PX;
  const viewportBottom = (viewport.offsetTop ?? 0) + viewport.height - EDGE_MARGIN_PX;
  const maxLeft = Math.max(viewportLeft, viewportRight - menuSize.width);
  const left = Math.min(maxLeft, Math.max(viewportLeft, anchorRect.left));

  const anchorTop = Math.min(viewportBottom, Math.max(viewportTop, anchorRect.top));
  const anchorBottom = Math.min(viewportBottom, Math.max(viewportTop, anchorRect.bottom));
  const spaceBelow = viewportBottom - anchorBottom;
  const spaceAbove = anchorTop - viewportTop;
  const preferAbove = spaceBelow < menuSize.height + GAP_PX && spaceAbove > spaceBelow;

  const naturalTop = preferAbove ? anchorTop - menuSize.height - GAP_PX : anchorBottom + GAP_PX;
  const maxTop = Math.max(viewportTop, viewportBottom - menuSize.height);
  const top = Math.min(maxTop, Math.max(viewportTop, naturalTop));

  return {
    left,
    top,
  };
};
