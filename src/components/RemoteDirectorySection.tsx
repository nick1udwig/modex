import type { RemoteDirectoryEntry, RemoteDirectoryRoot } from '../services/sidecarClient';
import { Icon } from './Icon';
import { countLabel, pathBasename } from './runtimeSettingsSheetModel';

export interface DirectoryBrowseState {
  anchorPath: string;
  entries: RemoteDirectoryEntry[];
  error: string | null;
  loading: boolean;
  parentPath: string | null;
  roots: RemoteDirectoryRoot[];
  selectedPath: string;
}

interface SelectedDirectoriesCardProps {
  browseButtonLabel: string;
  emptyLabel: string;
  helperText: string;
  onMovePathToFront: (path: string) => void;
  onOpenBrowse: () => void;
  onRemovePath?: (path: string) => void;
  pathLabel: (index: number) => string;
  paths: string[];
  title: string;
}

export const SelectedDirectoriesCard = ({
  browseButtonLabel,
  emptyLabel,
  helperText,
  onMovePathToFront,
  onOpenBrowse,
  onRemovePath,
  pathLabel,
  paths,
  title,
}: SelectedDirectoriesCardProps) => (
  <div className="settings-sheet__paths-card">
    <div className="settings-sheet__paths-header">
      <span className="settings-sheet__paths-section-title">{title}</span>
      <span className="settings-sheet__count-pill">{paths.length} selected</span>
    </div>

    <div className="settings-sheet__paths-helper">{helperText}</div>

    <div className="settings-sheet__paths-body">
      <div className="settings-sheet__paths-list" aria-label={title}>
        {paths.length === 0 ? <div className="settings-sheet__paths-empty">{emptyLabel}</div> : null}

        {paths.map((path, index) => (
          <div key={path} className="settings-sheet__path-row">
            <button className="settings-sheet__path-card" type="button" onClick={() => onMovePathToFront(path)}>
              <span className="settings-sheet__path-icon">
                <Icon name={index === 0 ? 'folder-open' : 'folder'} size={16} />
              </span>
              <span className="settings-sheet__path-copy">
                <span className="settings-sheet__path-label">{pathLabel(index)}</span>
                <span className="settings-sheet__path-value">{path}</span>
              </span>
            </button>

            {onRemovePath ? (
              <button className="settings-sheet__path-remove" type="button" onClick={() => onRemovePath(path)} aria-label={`Remove ${path}`}>
                <Icon name="x" size={14} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="settings-sheet__browse-action">
        <button className="settings-sheet__browse-row" type="button" onClick={onOpenBrowse}>
          <span className="settings-sheet__browse-row-icon">
            <Icon name="plus" size={16} />
          </span>
          <span>{browseButtonLabel}</span>
        </button>
      </div>
    </div>
  </div>
);

interface RemoteDirectoryBrowsePaneProps {
  addLabel: string;
  browse: DirectoryBrowseState;
  crumbLabel: string;
  contextLine: string;
  helperText: string;
  locationText: string;
  onAddSelected: () => void;
  onClose: () => void;
  onSelectAnchor: () => void;
  onSelectEntry: (entry: RemoteDirectoryEntry) => void;
  onStepUp: () => void;
  previewLabel: string;
  previewPath: string;
  title: string;
}

export const RemoteDirectoryBrowsePane = ({
  addLabel,
  browse,
  crumbLabel,
  contextLine,
  helperText,
  locationText,
  onAddSelected,
  onClose,
  onSelectAnchor,
  onSelectEntry,
  onStepUp,
  previewLabel,
  previewPath,
  title,
}: RemoteDirectoryBrowsePaneProps) => (
  <>
    <div className="settings-sheet__browse-header">
      <h2 className="settings-sheet__browse-title">{title}</h2>
    </div>

    <div className="settings-sheet__browse-context">
      <div className="settings-sheet__browse-context-line">{contextLine}</div>
      <div className="settings-sheet__browse-location">{locationText}</div>
      <div className="settings-sheet__browse-helper">{helperText}</div>
    </div>

    <div className="settings-sheet__tree">
      <div className="settings-sheet__tree-label">Directory tree</div>

      <button className="settings-sheet__tree-crumb" type="button" disabled={!browse.parentPath || browse.loading} onClick={onStepUp}>
        {crumbLabel || 'Connect to the sidecar to browse remote folders.'}
      </button>

      <button
        className={`settings-sheet__tree-root ${browse.selectedPath === browse.anchorPath ? 'settings-sheet__tree-root--selected' : ''}`}
        type="button"
        disabled={!browse.anchorPath}
        onClick={onSelectAnchor}
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
        {!browse.error && browse.loading ? <div className="settings-sheet__tree-status">Loading remote filesystem…</div> : null}
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
              onClick={() => onSelectEntry(entry)}
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
      <span className="settings-sheet__browse-preview-label">{previewLabel}</span>
      <span className="settings-sheet__browse-preview-path">{previewPath || 'No directory selected yet.'}</span>
    </div>

    <div className="settings-sheet__browse-actions">
      <button className="settings-sheet__mini-button settings-sheet__mini-button--ghost" type="button" onClick={onClose}>
        Cancel
      </button>
      <button className="settings-sheet__mini-button settings-sheet__mini-button--primary" type="button" disabled={!previewPath} onClick={onAddSelected}>
        <Icon name="plus" size={10} />
        <span>{addLabel}</span>
      </button>
    </div>
  </>
);
