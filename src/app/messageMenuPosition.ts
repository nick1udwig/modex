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
  width: number;
}

export interface MenuPosition {
  left: number;
  top: number;
}

const EDGE_MARGIN_PX = 16;
const GAP_PX = 10;

export const positionMessageMenu = (
  anchorRect: RectLike,
  menuSize: SizeLike,
  viewport: ViewportLike,
): MenuPosition => {
  const maxLeft = Math.max(EDGE_MARGIN_PX, viewport.width - menuSize.width - EDGE_MARGIN_PX);
  const left = Math.min(maxLeft, Math.max(EDGE_MARGIN_PX, anchorRect.left));

  const spaceBelow = viewport.height - anchorRect.bottom - EDGE_MARGIN_PX;
  const spaceAbove = anchorRect.top - EDGE_MARGIN_PX;
  const preferAbove = spaceBelow < menuSize.height + GAP_PX && spaceAbove > spaceBelow;

  const naturalTop = preferAbove ? anchorRect.top - menuSize.height - GAP_PX : anchorRect.bottom + GAP_PX;
  const maxTop = Math.max(EDGE_MARGIN_PX, viewport.height - menuSize.height - EDGE_MARGIN_PX);
  const top = Math.min(maxTop, Math.max(EDGE_MARGIN_PX, naturalTop));

  return {
    left,
    top,
  };
};
