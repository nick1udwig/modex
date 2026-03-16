import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatRuntimeSettings } from '../app/types';
import type { RemoteDirectoryEntry, RemoteDirectoryRoot, RemoteFilesystemClient } from '../services/sidecarClient';
import { Icon } from './Icon';

interface RuntimeSettingsSheetProps {
  filesystemClient?: RemoteFilesystemClient | null;
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
  filesystemClient,
  mode,
  open,
  recentRoots,
  settings,
  onClose,
  onSubmit,
}: RuntimeSettingsSheetProps) => {
  const [accessMode, setAccessMode] = useState(settings.accessMode);
  const [browserEntries, setBrowserEntries] = useState<RemoteDirectoryEntry[]>([]);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserParent, setBrowserParent] = useState<string | null>(null);
  const [browserPath, setBrowserPath] = useState('');
  const [browserQuery, setBrowserQuery] = useState('');
  const [browserResults, setBrowserResults] = useState<RemoteDirectoryEntry[]>([]);
  const [browserRoots, setBrowserRoots] = useState<RemoteDirectoryRoot[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [roots, setRoots] = useState(settings.roots);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    setAccessMode(settings.accessMode);
    setBrowserEntries([]);
    setBrowserError(null);
    setBrowserLoading(false);
    setBrowserParent(null);
    setBrowserPath('');
    setBrowserQuery('');
    setBrowserResults([]);
    setBrowserRoots([]);
    setInputValue('');
    setRoots(settings.roots);
  }, [open, settings.accessMode, settings.roots]);

  useEffect(() => {
    if (!open || !filesystemClient) {
      return;
    }

    const initialPath = settings.roots[0] ?? recentRoots[0] ?? '';
    const requestId = ++requestSequenceRef.current;
    setBrowserLoading(true);
    setBrowserError(null);

    void filesystemClient
      .list({
        directoriesOnly: true,
        path: initialPath,
      })
      .then((result) => {
        if (requestId !== requestSequenceRef.current) {
          return;
        }

        setBrowserEntries(result.entries);
        setBrowserParent(result.parent);
        setBrowserPath(result.path);
        setBrowserRoots(result.roots);
      })
      .catch((error) => {
        if (requestId !== requestSequenceRef.current) {
          return;
        }

        setBrowserError(error instanceof Error ? error.message : 'Unable to browse the remote filesystem.');
      })
      .finally(() => {
        if (requestId === requestSequenceRef.current) {
          setBrowserLoading(false);
        }
      });
  }, [filesystemClient, open, recentRoots, settings.roots]);

  useEffect(() => {
    if (!open || !filesystemClient) {
      return;
    }

    const query = browserQuery.trim();
    if (query.length === 0) {
      setBrowserResults([]);
      return;
    }

    const requestId = ++requestSequenceRef.current;
    setBrowserLoading(true);
    const timeoutId = window.setTimeout(() => {
      void filesystemClient
        .search({
          directoriesOnly: true,
          maxResults: 24,
          path: browserPath,
          query,
        })
        .then((results) => {
          if (requestId !== requestSequenceRef.current) {
            return;
          }

          setBrowserResults(results);
          setBrowserError(null);
        })
        .catch((error) => {
          if (requestId !== requestSequenceRef.current) {
            return;
          }

          setBrowserError(error instanceof Error ? error.message : 'Unable to search the remote filesystem.');
        })
        .finally(() => {
          if (requestId === requestSequenceRef.current) {
            setBrowserLoading(false);
          }
        });
    }, 140);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [browserPath, browserQuery, filesystemClient, open]);

  const suggestedRoots = useMemo(
    () => recentRoots.filter((root) => !roots.includes(root)).slice(0, 6),
    [recentRoots, roots],
  );
  const showingSearchResults = browserQuery.trim().length > 0;
  const visibleEntries = showingSearchResults ? browserResults : browserEntries;

  if (!open) {
    return null;
  }

  const addRoot = (root: string) => {
    setRoots((current) => dedupeRoots([...current, root]));
    setInputValue('');
  };

  const navigateTo = async (path: string) => {
    if (!filesystemClient) {
      return;
    }

    const requestId = ++requestSequenceRef.current;
    setBrowserLoading(true);
    setBrowserError(null);

    try {
      const result = await filesystemClient.list({
        directoriesOnly: true,
        path,
      });
      if (requestId !== requestSequenceRef.current) {
        return;
      }

      setBrowserEntries(result.entries);
      setBrowserParent(result.parent);
      setBrowserPath(result.path);
      setBrowserQuery('');
      setBrowserResults([]);
      setBrowserRoots(result.roots);
    } catch (error) {
      if (requestId === requestSequenceRef.current) {
        setBrowserError(error instanceof Error ? error.message : 'Unable to browse the remote filesystem.');
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        setBrowserLoading(false);
      }
    }
  };

  const addManualPath = async () => {
    const value = inputValue.trim();
    if (!value) {
      return;
    }

    if (!filesystemClient) {
      addRoot(value);
      return;
    }

    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const entry = await filesystemClient.stat(value);
      if (!entry.directory) {
        throw new Error('That remote path is not a directory.');
      }

      addRoot(entry.path);
      await navigateTo(entry.path);
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : 'Unable to validate that remote path.');
    } finally {
      setBrowserLoading(false);
    }
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

        <div className="settings-sheet__content">
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

            <div className="settings-browser">
              <div className="settings-browser__toolbar">
                <div className="settings-browser__roots">
                  {browserRoots.map((root) => (
                    <button
                      key={root.path}
                      className={`settings-browser__root ${browserPath.startsWith(root.path) ? 'settings-browser__root--active' : ''}`}
                      type="button"
                      onClick={() => void navigateTo(root.path)}
                    >
                      {root.label}
                    </button>
                  ))}
                </div>

                <div className="settings-browser__path-row">
                  <button
                    className="settings-browser__up"
                    type="button"
                    disabled={!browserParent || browserLoading}
                    onClick={() => {
                      if (browserParent) {
                        void navigateTo(browserParent);
                      }
                    }}
                  >
                    Up
                  </button>

                  <div className="settings-browser__path">{browserPath || 'Connect to the sidecar to browse remote folders.'}</div>

                  <button
                    className="settings-browser__current"
                    type="button"
                    disabled={!browserPath}
                    onClick={() => addRoot(browserPath)}
                  >
                    Add current
                  </button>
                </div>

                <input
                  type="text"
                  value={browserQuery}
                  placeholder="Search directories on the server"
                  aria-label="Search remote directories"
                  onChange={(event) => setBrowserQuery(event.target.value)}
                />
              </div>

              {browserError ? <div className="settings-browser__status settings-browser__status--error">{browserError}</div> : null}
              {!browserError && browserLoading ? <div className="settings-browser__status">Loading remote filesystem…</div> : null}

              <div className="settings-browser__list">
                {!browserLoading && visibleEntries.length === 0 ? (
                  <div className="settings-browser__empty">
                    {showingSearchResults ? 'No directories match that search.' : 'No directories available here.'}
                  </div>
                ) : null}

                {visibleEntries.map((entry) => (
                  <div key={entry.path} className="settings-browser__item">
                    <button
                      className="settings-browser__entry"
                      type="button"
                      onClick={() => void navigateTo(entry.path)}
                    >
                      <span className="settings-browser__entry-name">{entry.name}</span>
                      <span className="settings-browser__entry-meta">{entry.path}</span>
                    </button>

                    <button
                      className="settings-browser__select"
                      type="button"
                      onClick={() => addRoot(entry.path)}
                      aria-label={`Add ${entry.path}`}
                    >
                      <Icon name="plus" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

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
                      void addManualPath();
                    }
                  }
                }}
              />

              <button
                className="settings-sheet__add"
                type="button"
                onClick={() => {
                  if (inputValue.trim()) {
                    void addManualPath();
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
        </div>

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
                model: settings.model,
                reasoningEffort: settings.reasoningEffort,
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
