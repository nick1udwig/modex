import { useEffect, useState } from 'react';
import { terminalStatusLabel } from '../app/tabs';
import type { RemoteTerminalClient, TerminalSessionSummary } from '../app/types';

interface TerminalSessionPickerSheetProps {
  client: RemoteTerminalClient;
  onClose: () => void;
  onSelect: (sessionId: string) => void;
  open: boolean;
}

export const TerminalSessionPickerSheet = ({ client, onClose, onSelect, open }: TerminalSessionPickerSheetProps) => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void client
      .listSessions()
      .then((nextSessions) => {
        if (!cancelled) {
          setSessions(nextSessions);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to load tmuy sessions.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <section
        className="picker-sheet picker-sheet--sessions"
        aria-label="Connect an existing tmuy session"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="picker-sheet__header">
          <p className="picker-sheet__eyebrow">Existing tmuy session</p>
          <h2 className="picker-sheet__title">Reconnect a terminal tab.</h2>
        </div>

        {loading ? <div className="picker-sheet__empty">Loading tmuy sessions…</div> : null}
        {error ? <div className="picker-sheet__empty">{error}</div> : null}
        {!loading && !error && sessions.length === 0 ? <div className="picker-sheet__empty">No tmuy sessions found.</div> : null}

        {!loading && !error && sessions.length > 0 ? (
          <div className="picker-sheet__session-list">
            {sessions.map((session) => (
              <button key={session.idHash} className="picker-sheet__session" type="button" onClick={() => onSelect(session.idHash)}>
                <span className="picker-sheet__session-title">{session.currentName}</span>
                <span className="picker-sheet__session-path">{session.cwd}</span>
                <span className={`picker-sheet__session-status picker-sheet__session-status--${session.status}`}>
                  {terminalStatusLabel(session.status)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
};
