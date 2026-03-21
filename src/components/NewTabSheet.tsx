import { SlidingBottomSheet } from './SlidingBottomSheet';

interface NewTabSheetProps {
  onClose: () => void;
  onOpenExistingTerminal: () => void;
  onOpenNewChat: () => void;
  onOpenNewTerminal: () => void;
  open: boolean;
}

export const NewTabSheet = ({
  onClose,
  onOpenExistingTerminal,
  onOpenNewChat,
  onOpenNewTerminal,
  open,
}: NewTabSheetProps) => {
  return (
    <SlidingBottomSheet ariaLabel="Create a new tab" open={open} onClose={onClose} panelClassName="picker-sheet">
      <>
        <div className="picker-sheet__header">
          <p className="picker-sheet__eyebrow">New tab</p>
          <h2 className="picker-sheet__title">Choose what this tab should host.</h2>
        </div>

        <div className="picker-sheet__actions">
          <button className="picker-sheet__action" type="button" onClick={onOpenNewChat}>
            <span className="picker-sheet__action-title">Codex session</span>
            <span className="picker-sheet__action-copy">Start a new app-server thread with runtime settings.</span>
          </button>

          <button className="picker-sheet__action" type="button" onClick={onOpenNewTerminal}>
            <span className="picker-sheet__action-title">New terminal</span>
            <span className="picker-sheet__action-copy">Create a fresh tmuy shell session from a working directory.</span>
          </button>

          <button className="picker-sheet__action" type="button" onClick={onOpenExistingTerminal}>
            <span className="picker-sheet__action-title">Existing tmuy session</span>
            <span className="picker-sheet__action-copy">Reconnect a tab to a live or exited terminal session.</span>
          </button>
        </div>
      </>
    </SlidingBottomSheet>
  );
};
