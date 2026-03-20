import { useEffect, useState } from 'react';

interface TerminalCreateSheetProps {
  onClose: () => void;
  onSubmit: (cwd: string) => void;
  open: boolean;
  recentRoots: string[];
}

export const TerminalCreateSheet = ({ onClose, onSubmit, open, recentRoots }: TerminalCreateSheetProps) => {
  const [cwd, setCwd] = useState(recentRoots[0] ?? '');

  useEffect(() => {
    if (!open) {
      return;
    }

    setCwd((current) => current || recentRoots[0] || '');
  }, [open, recentRoots]);

  if (!open) {
    return null;
  }

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <section
        className="picker-sheet picker-sheet--form"
        aria-label="Create a terminal tab"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="picker-sheet__header">
          <p className="picker-sheet__eyebrow">New terminal</p>
          <h2 className="picker-sheet__title">Start a tmuy shell session.</h2>
        </div>

        <label className="picker-sheet__field">
          <span className="picker-sheet__label">Working directory</span>
          <input
            className="picker-sheet__input"
            type="text"
            value={cwd}
            placeholder="/workspace/project"
            onChange={(event) => setCwd(event.target.value)}
          />
        </label>

        {recentRoots.length > 0 ? (
          <div className="picker-sheet__chips" aria-label="Recent directories">
            {recentRoots.map((root) => (
              <button key={root} className="picker-sheet__chip" type="button" onClick={() => setCwd(root)}>
                {root}
              </button>
            ))}
          </div>
        ) : null}

        <div className="picker-sheet__footer">
          <button className="picker-sheet__secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="picker-sheet__primary"
            type="button"
            onClick={() => onSubmit(cwd.trim())}
            disabled={cwd.trim().length === 0}
          >
            Open terminal
          </button>
        </div>
      </section>
    </div>
  );
};
