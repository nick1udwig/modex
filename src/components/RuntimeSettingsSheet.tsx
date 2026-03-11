import { useEffect, useMemo, useState } from 'react';
import type { ChatRuntimeSettings } from '../app/types';
import { Icon } from './Icon';

interface RuntimeSettingsSheetProps {
  mode: 'create' | 'edit';
  open: boolean;
  recentRoots: string[];
  settings: ChatRuntimeSettings;
  onClose: () => void;
  onSubmit: (settings: ChatRuntimeSettings) => void;
}

const dedupeRoots = (roots: string[]) => {
  const seen = new Set<string>();
  return roots
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .filter((root) => {
      if (seen.has(root)) {
        return false;
      }

      seen.add(root);
      return true;
    });
};

export const RuntimeSettingsSheet = ({
  mode,
  open,
  recentRoots,
  settings,
  onClose,
  onSubmit,
}: RuntimeSettingsSheetProps) => {
  const [accessMode, setAccessMode] = useState(settings.accessMode);
  const [inputValue, setInputValue] = useState('');
  const [roots, setRoots] = useState(settings.roots);

  useEffect(() => {
    if (!open) {
      return;
    }

    setAccessMode(settings.accessMode);
    setInputValue('');
    setRoots(settings.roots);
  }, [open, settings.accessMode, settings.roots]);

  const suggestedRoots = useMemo(
    () => recentRoots.filter((root) => !roots.includes(root)).slice(0, 6),
    [recentRoots, roots],
  );

  if (!open) {
    return null;
  }

  const addRoot = (root: string) => {
    setRoots((current) => dedupeRoots([...current, root]));
    setInputValue('');
  };

  return (
    <section className="settings-sheet" aria-label={mode === 'create' ? 'Create tab settings' : 'Edit tab settings'}>
      <button className="settings-sheet__scrim" type="button" onClick={onClose} aria-label="Close settings" />

      <div className="settings-sheet__panel">
        <div className="settings-sheet__top">
          <div>
            <h2 className="settings-sheet__title">{mode === 'create' ? 'New Tab' : 'Directories'}</h2>
            <p className="settings-sheet__meta">First path becomes the session cwd. Extra paths stay available for Codex.</p>
          </div>

          <button className="settings-sheet__close" type="button" onClick={onClose} aria-label="Close settings">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="settings-sheet__section">
          <span className="settings-sheet__label">Access</span>
          <div className="settings-toggle" role="group" aria-label="Access mode">
            <button
              className={`settings-toggle__button ${accessMode === 'read-only' ? 'settings-toggle__button--active' : ''}`}
              type="button"
              onClick={() => setAccessMode('read-only')}
            >
              Read
            </button>
            <button
              className={`settings-toggle__button ${accessMode === 'workspace-write' ? 'settings-toggle__button--active' : ''}`}
              type="button"
              onClick={() => setAccessMode('workspace-write')}
            >
              Write
            </button>
          </div>
        </div>

        <div className="settings-sheet__section">
          <span className="settings-sheet__label">Remote paths</span>

          <div className="settings-sheet__input-row">
            <input
              type="text"
              value={inputValue}
              placeholder="/workspace/project"
              aria-label="Add remote path"
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (inputValue.trim()) {
                    addRoot(inputValue);
                  }
                }
              }}
            />

            <button
              className="settings-sheet__add"
              type="button"
              onClick={() => {
                if (inputValue.trim()) {
                  addRoot(inputValue);
                }
              }}
              aria-label="Add remote path"
            >
              Add
            </button>
          </div>

          <div className="settings-roots">
            {roots.length === 0 ? <div className="settings-roots__empty">Add at least one remote path to create the tab.</div> : null}

            {roots.map((root, index) => (
              <div key={root} className="settings-root">
                <button
                  className={`settings-root__path ${index === 0 ? 'settings-root__path--cwd' : ''}`}
                  type="button"
                  onClick={() =>
                    setRoots((current) => {
                      const next = current.filter((entry) => entry !== root);
                      return [root, ...next];
                    })
                  }
                >
                  <span className="settings-root__badge">{index === 0 ? 'cwd' : 'root'}</span>
                  <span>{root}</span>
                </button>

                <button
                  className="settings-root__remove"
                  type="button"
                  onClick={() => setRoots((current) => current.filter((entry) => entry !== root))}
                  aria-label={`Remove ${root}`}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {suggestedRoots.length > 0 ? (
          <div className="settings-sheet__section">
            <span className="settings-sheet__label">Recent</span>
            <div className="settings-recent">
              {suggestedRoots.map((root) => (
                <button key={root} className="settings-recent__item" type="button" onClick={() => addRoot(root)}>
                  {root}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="settings-sheet__actions">
          <button className="settings-sheet__button settings-sheet__button--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="settings-sheet__button settings-sheet__button--primary"
            type="button"
            disabled={roots.length === 0}
            onClick={() =>
              onSubmit({
                accessMode,
                roots: dedupeRoots(roots),
              })
            }
          >
            {mode === 'create' ? 'Create tab' : 'Save'}
          </button>
        </div>
      </div>
    </section>
  );
};
