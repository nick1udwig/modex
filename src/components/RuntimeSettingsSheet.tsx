import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccessMode, ChatRuntimeSettings } from '../app/types';
import type { RemoteDirectoryEntry, RemoteDirectoryRoot, RemoteFilesystemClient } from '../services/sidecarClient';
import { Icon } from './Icon';
import { RemoteDirectoryBrowsePane, SelectedDirectoriesCard, type DirectoryBrowseState } from './RemoteDirectorySection';
import {
  addSelectedDirectory as addDirectoryToSelection,
  moveSelectedDirectoryToFront,
  removeSelectedDirectory,
} from './remoteDirectorySelectionModel';
import {
  accessModeContextLabel,
  dedupeRoots,
  parentDirectory,
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

const rootSummaryLabel = (index: number) => (index === 0 ? 'cwd root' : 'allowed root');

const createBrowseState = (anchorPath: string, selectedPath: string): DirectoryBrowseState => ({
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
  const [browse, setBrowse] = useState<DirectoryBrowseState>(() => {
    const seed = seedBrowseState(settings.roots, recentRoots);
    return createBrowseState(seed.anchorPath, seed.selectedPath);
  });
  const [roots, setRoots] = useState(settings.roots);
  const [view, setView] = useState<'browse' | 'form'>('form');
  const requestSequenceRef = useRef(0);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const seed = seedBrowseState(settings.roots, recentRoots);
      setAccessMode(settings.accessMode);
      setBrowse(createBrowseState(seed.anchorPath, seed.selectedPath));
      setRoots(settings.roots);
      setView('form');
    }

    wasOpenRef.current = open;
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
    setRoots((current) => moveSelectedDirectoryToFront(current, root));
  };

  const removeRoot = (root: string) => {
    setRoots((current) => removeSelectedDirectory(current, root));
  };

  const addRoot = (root: string) => {
    setRoots((current) => addDirectoryToSelection(current, root, 'multiple'));
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
          <RemoteDirectoryBrowsePane
            addLabel="Add directory"
            browse={browse}
            crumbLabel={browseLocation || 'Connect to the sidecar to browse remote folders.'}
            contextLine={(activeBrowseRoot?.label || 'remote machine') + '    ' + accessModeContextLabel(accessMode)}
            helperText="Choose one directory to add to the remote allowed set. This browser is reading the machine where Codex runs, not this mobile device."
            locationText={`Current location  ${browseLocation || 'Connect to the sidecar'}  (remote machine)`}
            onAddSelected={addSelectedDirectory}
            onClose={closeBrowsePane}
            onSelectAnchor={() =>
              setBrowse((current) => ({
                ...current,
                selectedPath: current.anchorPath,
              }))
            }
            onSelectEntry={handleBrowseEntryClick}
            onStepUp={() => {
              if (browse.parentPath) {
                void loadBrowseDirectory(browse.parentPath, browse.anchorPath);
              }
            }}
            previewLabel="Selected path"
            previewPath={browsePreviewPath}
            title="Browse and add directory"
          />
        </div>
      ) : (
        <div
          className={`settings-sheet__panel settings-sheet__panel--form ${
            mode === 'create' ? 'settings-sheet__panel--create' : ''
          }`}
          role="dialog"
          aria-modal="true"
        >
          <div className="settings-sheet__form-body">
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

            <SelectedDirectoriesCard
              browseButtonLabel="Browse remote machine directories"
              emptyLabel="No directories selected yet."
              helperText="These are normal file paths on the remote machine running Codex, not paths on this mobile device."
              onMovePathToFront={moveRootToFront}
              onOpenBrowse={openBrowsePane}
              onRemovePath={removeRoot}
              pathLabel={rootSummaryLabel}
              paths={selectedRoots}
              title="Allowed remote directories"
            />
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
                  approvalPolicy: settings.approvalPolicy,
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
