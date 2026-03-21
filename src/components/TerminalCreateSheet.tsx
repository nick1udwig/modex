import { useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteFilesystemClient } from '../services/sidecarClient';
import { Icon } from './Icon';
import { RemoteDirectoryBrowsePane, SelectedDirectoriesCard, type DirectoryBrowseState } from './RemoteDirectorySection';
import {
  addSelectedDirectory,
  moveSelectedDirectoryToFront,
  removeSelectedDirectory,
} from './remoteDirectorySelectionModel';
import { parentDirectory, seedBrowseState } from './runtimeSettingsSheetModel';
import { SlidingBottomSheet } from './SlidingBottomSheet';

interface TerminalCreateSheetProps {
  filesystemClient?: RemoteFilesystemClient | null;
  onClose: () => void;
  onSubmit: (cwd: string) => void;
  open: boolean;
  recentRoots: string[];
}

const createBrowseState = (anchorPath: string, selectedPath: string): DirectoryBrowseState => ({
  anchorPath,
  entries: [],
  error: null,
  loading: false,
  parentPath: parentDirectory(anchorPath),
  roots: [],
  selectedPath,
});

export const TerminalCreateSheet = ({
  filesystemClient,
  onClose,
  onSubmit,
  open,
  recentRoots,
}: TerminalCreateSheetProps) => {
  const [browse, setBrowse] = useState<DirectoryBrowseState>(() => {
    const seed = seedBrowseState([], recentRoots);
    return createBrowseState(seed.anchorPath, seed.selectedPath);
  });
  const [workingDirectory, setWorkingDirectory] = useState<string | null>(() => recentRoots[0] ?? null);
  const [view, setView] = useState<'browse' | 'form'>('form');
  const requestSequenceRef = useRef(0);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const seed = seedBrowseState([], recentRoots);
      setBrowse(createBrowseState(seed.anchorPath, seed.selectedPath));
      setWorkingDirectory(seed.selectedPath || null);
      setView('form');
    }

    wasOpenRef.current = open;
  }, [open, recentRoots]);

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

  const selectedRoots = workingDirectory ? [workingDirectory] : [];
  const seed = useMemo(() => seedBrowseState(selectedRoots, recentRoots), [recentRoots, selectedRoots]);
  const activeBrowseRoot = useMemo(
    () => browse.roots.find((root) => browse.anchorPath.startsWith(root.path)) ?? browse.roots[0] ?? null,
    [browse.anchorPath, browse.roots],
  );
  const browseLocation = browse.parentPath ?? browse.anchorPath;
  const browsePreviewPath = browse.selectedPath || browse.anchorPath;

  const openBrowsePane = () => {
    setView('browse');
    void loadBrowseDirectory(seed.anchorPath, seed.selectedPath);
  };

  const closeBrowsePane = () => {
    setView('form');
  };

  const handleBrowseEntryClick = (entry: DirectoryBrowseState['entries'][number]) => {
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

  const selectWorkingDirectory = () => {
    if (!browsePreviewPath) {
      return;
    }

    setWorkingDirectory(addSelectedDirectory(selectedRoots, browsePreviewPath, 'single')[0] ?? null);
    setView('form');
  };

  return (
    <SlidingBottomSheet
      ariaLabel="Create a terminal tab"
      open={open}
      onClose={onClose}
      panelClassName={`settings-sheet__panel ${view === 'browse' ? 'settings-sheet__panel--browse terminal-create-sheet__panel terminal-create-sheet__panel--browse' : 'settings-sheet__panel--form terminal-create-sheet__panel'}`}
    >
      {view === 'browse' ? (
        <RemoteDirectoryBrowsePane
          addLabel="Use directory"
          browse={browse}
          crumbLabel={browseLocation || 'Connect to the sidecar to browse remote folders.'}
          contextLine={(activeBrowseRoot?.label || 'remote machine') + '    terminal working directory'}
          helperText="Choose one directory on the remote machine where tmuy runs. This browser is reading the Codex host, not this mobile device."
          locationText={`Current location  ${browseLocation || 'Connect to the sidecar'}  (remote machine)`}
          onAddSelected={selectWorkingDirectory}
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
          previewLabel="Working directory"
          previewPath={browsePreviewPath}
          title="Browse and choose directory"
        />
      ) : (
        <>
          <div className="settings-sheet__form-body">
            <div className="settings-sheet__drag-handle" />

            <div className="settings-sheet__header">
              <div className="settings-sheet__header-copy">
                <h2 className="settings-sheet__title">New terminal</h2>
                <p className="settings-sheet__subtitle">Start a tmuy shell session from one remote working directory.</p>
              </div>

              <button className="settings-sheet__close" type="button" onClick={onClose} aria-label="Close terminal creation">
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="settings-sheet__paths-head">
              <div className="settings-sheet__paths-title">Working directory on remote machine</div>
              <div className="settings-sheet__paths-copy">
                Pick one directory from the remote machine where Codex and tmuy are running. The new shell starts there.
              </div>
            </div>

            <SelectedDirectoriesCard
              browseButtonLabel="Browse remote machine directories"
              emptyLabel="No working directory selected yet."
              helperText="This path is on the remote machine running tmuy, not on this mobile device."
              onOpenBrowse={openBrowsePane}
              onRemovePath={(path) => setWorkingDirectory(removeSelectedDirectory(selectedRoots, path)[0] ?? null)}
              pathLabel={() => 'selected working directory'}
              paths={selectedRoots}
              selectionMode="single"
              title="Remote working directory"
            />
          </div>

          <div className="settings-sheet__actions">
            <button className="settings-sheet__button settings-sheet__button--ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="settings-sheet__button settings-sheet__button--primary"
              type="button"
              disabled={!workingDirectory}
              onClick={() => onSubmit(workingDirectory ?? '')}
            >
              Open terminal
            </button>
          </div>
        </>
      )}
    </SlidingBottomSheet>
  );
};
