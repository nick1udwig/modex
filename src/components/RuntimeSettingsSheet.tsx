import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccessMode, ChatRuntimeSettings } from '../app/types';
import type { RemoteDirectoryEntry, RemoteDirectoryRoot, RemoteFilesystemClient } from '../services/sidecarClient';
import { Icon } from './Icon';
import {
  accessModeContextLabel,
  countLabel,
  dedupeRoots,
  parentDirectory,
  pathBasename,
  seedBrowseState,
} from './runtimeSettingsSheetModel';

interface RuntimeSettingsSheetProps {
  filesystemClient?: RemoteFilesystemClient | null;
  mode: 'create' | 'edit';
  open: boolean;
  recentRoots: string[];
  settings: ChatRuntimeSettings;
  onClose: () => void;
  onSubmit: (settings: ChatRuntimeSettings) => void;
}

interface BrowseState {
  anchorPath: string;
  entries: RemoteDirectoryEntry[];
  error: string | null;
  loading: boolean;
  parentPath: string | null;
  roots: RemoteDirectoryRoot[];
  selectedPath: string;
}

const rootSummaryLabel = (index: number) => (index === 0 ? 'cwd root' : 'allowed root');

const createBrowseState = (anchorPath: string, selectedPath: string): BrowseState => ({
  anchorPath,
  entries: [],
  error: null,
  loading: false,
  parentPath: parentDirectory(anchorPath),
  roots: [],
  selectedPath,
});

export const RuntimeSettingsSheet = ({
  filesystemClient,
  mode,
  open,
  recentRoots,
  settings,
  onClose,
  onSubmit,
}: RuntimeSettingsSheetProps) => {
  const [accessMode, setAccessMode] = useState<AccessMode>(settings.accessMode);
  const [browse, setBrowse] = useState<BrowseState>(() => {
    const seed = seedBrowseState(settings.roots, recentRoots);
    return createBrowseState(seed.anchorPath, seed.selectedPath);
  });
  const [roots, setRoots] = useState(settings.roots);
  const [view, setView] = useState<'browse' | 'form'>('form');
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    const seed = seedBrowseState(settings.roots, recentRoots);
    setAccessMode(settings.accessMode);
    setBrowse(createBrowseState(seed.anchorPath, seed.selectedPath));
    setRoots(settings.roots);
    setView('form');
  }, [open, recentRoots, settings.accessMode, settings.roots]);

  const loadBrowseDirectory = async (path: string, preferredSelection?: string) => {
    if (!filesystemClient) {
      setBrowse((current) => ({
        ...current,
        anchorPath: path || current.anchorPath,
        error: 'Connect to the sidecar to browse remote folders.',
        loading: false,
        parentPath: parentDirectory(path || current.anchorPath),
        selectedPath: preferredSelection ?? current.selectedPath,
      }));
      return;
    }

    const requestId = ++requestSequenceRef.current;
    setBrowse((current) => ({
      ...current,
      anchorPath: path || current.anchorPath,
      error: null,
      loading: true,
      selectedPath: preferredSelection ?? current.selectedPath,
    }));

    try {
      const result = await filesystemClient.list({
        directoriesOnly: true,
        path,
      });
      if (requestId !== requestSequenceRef.current) {
        return;
      }

      const entries = result.entries.filter((entry) => entry.directory);
      const defaultSelection = preferredSelection ?? result.path;
      const selectionPath =
        defaultSelection === result.path || entries.some((entry) => entry.path === defaultSelection) ? defaultSelection : result.path;

      setBrowse({
        anchorPath: result.path,
        entries,
        error: null,
        loading: false,
        parentPath: result.parent || parentDirectory(result.path),
        roots: result.roots,
        selectedPath: selectionPath,
      });
    } catch (error) {
      if (requestId !== requestSequenceRef.current) {
        return;
      }

      setBrowse((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Unable to browse the remote filesystem.',
        loading: false,
        parentPath: parentDirectory(path || current.anchorPath),
        selectedPath: preferredSelection ?? current.selectedPath,
      }));
    }
  };

  const selectedRoots = useMemo(() => dedupeRoots(roots), [roots]);
  const seed = useMemo(() => seedBrowseState(selectedRoots, recentRoots), [recentRoots, selectedRoots]);
  const activeBrowseRoot = useMemo(
    () => browse.roots.find((root) => browse.anchorPath.startsWith(root.path)) ?? browse.roots[0] ?? null,
    [browse.anchorPath, browse.roots],
  );
  const browseLocation = browse.parentPath ?? browse.anchorPath;
  const browsePreviewPath = browse.selectedPath || browse.anchorPath;
  const browseTitle = mode === 'create' ? 'New tab' : 'Allowed directories';
  const browseSubtitle =
    mode === 'create'
      ? 'Configure sandboxing and allowed directories on the remote machine where Codex runs.'
      : 'Adjust sandboxing and allowed directories on the remote machine where Codex runs.';

  if (!open) {
    return null;
  }

  const setMode = (nextMode: AccessMode) => {
    setAccessMode(nextMode);
  };

  const moveRootToFront = (root: string) => {
    setRoots((current) => {
      const next = dedupeRoots(current);
      const remaining = next.filter((entry) => entry !== root);
      return [root, ...remaining];
    });
  };

  const removeRoot = (root: string) => {
    setRoots((current) => current.filter((entry) => entry !== root));
  };

  const addRoot = (root: string) => {
    setRoots((current) => dedupeRoots([...current, root]));
  };

  const openBrowsePane = () => {
    setView('browse');
    void loadBrowseDirectory(seed.anchorPath, seed.selectedPath);
  };

  const closeBrowsePane = () => {
    setView('form');
  };

  const handleBrowseEntryClick = (entry: RemoteDirectoryEntry) => {
    if (browse.loading) {
      return;
    }

    if (browse.selectedPath === entry.path) {
      void loadBrowseDirectory(entry.path, entry.path);
      return;
    }

    setBrowse((current) => ({
      ...current,
      selectedPath: entry.path,
    }));
  };

  const addSelectedDirectory = () => {
    if (!browsePreviewPath) {
      return;
    }

    addRoot(browsePreviewPath);
    setView('form');
  };

  return (
    <section className="settings-sheet" aria-label={mode === 'create' ? 'Create tab settings' : 'Edit tab settings'}>
      <button className="settings-sheet__scrim" type="button" onClick={onClose} aria-label="Close settings" />

      {view === 'browse' ? (
        <div className="settings-sheet__panel settings-sheet__panel--browse" role="dialog" aria-modal="true">
          <div className="settings-sheet__browse-header">
            <h2 className="settings-sheet__browse-title">Browse and add directory</h2>
          </div>

          <div className="settings-sheet__browse-context">
            <div className="settings-sheet__browse-context-line">
              {(activeBrowseRoot?.label || 'remote machine') + '    ' + accessModeContextLabel(accessMode)}
            </div>
            <div className="settings-sheet__browse-location">
              Current location&nbsp;&nbsp;{browseLocation || 'Connect to the sidecar'}&nbsp;&nbsp;(remote machine)
            </div>
            <div className="settings-sheet__browse-helper">
              Choose one directory to add to the remote allowed set. This browser is reading the machine where Codex runs,
              not this mobile device.
            </div>
          </div>

          <div className="settings-sheet__tree">
            <div className="settings-sheet__tree-label">Directory tree</div>

            <button
              className="settings-sheet__tree-crumb"
              type="button"
              disabled={!browse.parentPath || browse.loading}
              onClick={() => {
                if (browse.parentPath) {
                  void loadBrowseDirectory(browse.parentPath, browse.anchorPath);
                }
              }}
            >
              {browseLocation || 'Connect to the sidecar to browse remote folders.'}
            </button>

            <button
              className={`settings-sheet__tree-root ${browse.selectedPath === browse.anchorPath ? 'settings-sheet__tree-root--selected' : ''}`}
              type="button"
              disabled={!browse.anchorPath}
              onClick={() =>
                setBrowse((current) => ({
                  ...current,
                  selectedPath: current.anchorPath,
                }))
              }
            >
              <span className="settings-sheet__tree-root-left">
                <Icon name="chevron-down" size={12} />
                <Icon name="folder-open" size={14} />
                <span>{pathBasename(browse.anchorPath || '/') || 'root'}</span>
              </span>
              <span className="settings-sheet__tree-meta">{countLabel(browse.entries.length)}</span>
            </button>

            <div className="settings-sheet__tree-children" aria-label="Directories in current location">
              {browse.error ? <div className="settings-sheet__tree-status settings-sheet__tree-status--error">{browse.error}</div> : null}
              {!browse.error && browse.loading ? (
                <div className="settings-sheet__tree-status">Loading remote filesystem…</div>
              ) : null}
              {!browse.error && !browse.loading && browse.entries.length === 0 ? (
                <div className="settings-sheet__tree-status">No directories available here.</div>
              ) : null}

              {browse.entries.map((entry) => {
                const selected = browse.selectedPath === entry.path;
                return (
                  <button
                    key={entry.path}
                    className={`settings-sheet__tree-entry ${selected ? 'settings-sheet__tree-entry--selected' : ''}`}
                    type="button"
                    onClick={() => handleBrowseEntryClick(entry)}
                  >
                    <span className="settings-sheet__tree-entry-left">
                      <Icon name={selected ? 'folder-open' : 'folder'} size={14} />
                      <span>{entry.name}</span>
                    </span>
                    <span className="settings-sheet__tree-meta">{selected ? 'selected' : 'directory'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="settings-sheet__browse-preview">
            <span className="settings-sheet__browse-preview-label">Selected path</span>
            <span className="settings-sheet__browse-preview-path">{browsePreviewPath || 'No directory selected yet.'}</span>
          </div>

          <div className="settings-sheet__browse-actions">
            <button className="settings-sheet__mini-button settings-sheet__mini-button--ghost" type="button" onClick={closeBrowsePane}>
              Cancel
            </button>
            <button
              className="settings-sheet__mini-button settings-sheet__mini-button--primary"
              type="button"
              disabled={!browsePreviewPath}
              onClick={addSelectedDirectory}
            >
              <Icon name="plus" size={10} />
              <span>Add directory</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-sheet__panel settings-sheet__panel--form" role="dialog" aria-modal="true">
          <div className="settings-sheet__drag-handle" />

          <div className="settings-sheet__header">
            <div className="settings-sheet__header-copy">
              <h2 className="settings-sheet__title">{browseTitle}</h2>
              <p className="settings-sheet__subtitle">{browseSubtitle}</p>
            </div>

            <button className="settings-sheet__close" type="button" onClick={onClose} aria-label="Close settings">
              <Icon name="x" size={16} />
            </button>
          </div>

          <div className="settings-sheet__sandbox-card">
            <div className="settings-sheet__sandbox-row">
              <div className="settings-sheet__sandbox-copy">
                <div className="settings-sheet__sandbox-title">Write sandbox</div>
                <div className="settings-sheet__sandbox-body">
                  Off keeps Codex read-only. Turn on to allow edits inside selected directories.
                </div>
              </div>

              <button
                className={`settings-sheet__switch ${accessMode === 'workspace-write' ? 'settings-sheet__switch--on' : ''}`}
                type="button"
                onClick={() => setMode(accessMode === 'workspace-write' ? 'read-only' : 'workspace-write')}
                aria-label="Toggle write sandbox"
                aria-pressed={accessMode === 'workspace-write'}
              >
                <span className="settings-sheet__switch-thumb" />
              </button>
            </div>

            <div className="settings-sheet__mode-bar" role="group" aria-label="Access mode">
              <button
                className={`settings-sheet__mode-pill ${accessMode === 'read-only' ? 'settings-sheet__mode-pill--active' : ''}`}
                type="button"
                onClick={() => setMode('read-only')}
              >
                Read-only
              </button>
              <button
                className={`settings-sheet__mode-pill ${accessMode === 'workspace-write' ? 'settings-sheet__mode-pill--active' : ''}`}
                type="button"
                onClick={() => setMode('workspace-write')}
              >
                Write access
              </button>
            </div>
          </div>

          <div className="settings-sheet__paths-head">
            <div className="settings-sheet__paths-title">Allowed directories on remote machine</div>
            <div className="settings-sheet__paths-copy">
              Add one or more directories from the remote machine where Codex runs. Codex can only read or write inside
              this allowed set.
            </div>
          </div>

          <div className="settings-sheet__paths-card">
            <div className="settings-sheet__paths-header">
              <span className="settings-sheet__paths-section-title">Allowed remote directories</span>
              <span className="settings-sheet__count-pill">{selectedRoots.length} selected</span>
            </div>

            <div className="settings-sheet__paths-helper">
              These are normal file paths on the remote machine running Codex, not paths on this mobile device.
            </div>

            <div className="settings-sheet__paths-list" aria-label="Selected remote directories">
              {selectedRoots.map((root, index) => (
                <div key={root} className="settings-sheet__path-row">
                  <button className="settings-sheet__path-card" type="button" onClick={() => moveRootToFront(root)}>
                    <span className="settings-sheet__path-icon">
                      <Icon name={index === 0 ? 'folder-open' : 'folder'} size={16} />
                    </span>
                    <span className="settings-sheet__path-copy">
                      <span className="settings-sheet__path-label">{rootSummaryLabel(index)}</span>
                      <span className="settings-sheet__path-value">{root}</span>
                    </span>
                  </button>

                  <button
                    className="settings-sheet__path-remove"
                    type="button"
                    onClick={() => removeRoot(root)}
                    aria-label={`Remove ${root}`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}

              <button className="settings-sheet__browse-row" type="button" onClick={openBrowsePane}>
                <span className="settings-sheet__browse-row-icon">
                  <Icon name="plus" size={16} />
                </span>
                <span>Browse remote machine directories</span>
              </button>
            </div>
          </div>

          <div className="settings-sheet__actions">
            <button className="settings-sheet__button settings-sheet__button--ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="settings-sheet__button settings-sheet__button--primary"
              type="button"
              disabled={selectedRoots.length === 0}
              onClick={() =>
                onSubmit({
                  accessMode,
                  model: settings.model,
                  reasoningEffort: settings.reasoningEffort,
                  roots: selectedRoots,
                })
              }
            >
              {mode === 'create' ? 'Open tab' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
