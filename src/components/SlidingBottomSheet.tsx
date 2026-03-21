import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const SHEET_CLOSE_MS = 220;

interface SlidingBottomSheetProps {
  ariaLabel: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  panelClassName: string;
}

export const SlidingBottomSheet = ({ ariaLabel, children, open, onClose, panelClassName }: SlidingBottomSheetProps) => {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (open) {
      setMounted(true);
      window.requestAnimationFrame(() => {
        setVisible(true);
      });
      return;
    }

    if (!mounted) {
      return;
    }

    setVisible(false);
    closeTimeoutRef.current = window.setTimeout(() => {
      setMounted(false);
      closeTimeoutRef.current = null;
    }, SHEET_CLOSE_MS);
  }, [mounted, open]);

  if (!mounted) {
    return null;
  }

  return (
    <div className={`sheet-overlay ${visible ? '' : 'sheet-overlay--closing'}`} role="presentation" onClick={onClose}>
      <section
        className={`sheet-panel ${panelClassName} ${visible ? '' : 'sheet-panel--closing'}`}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {children}
      </section>
    </div>
  );
};
