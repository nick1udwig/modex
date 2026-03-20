import type { AccessMode } from '../app/types';

export interface BrowseSeedState {
  anchorPath: string;
  selectedPath: string;
}

const normalizePath = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed === '/') {
    return '/';
  }

  return trimmed.replace(/\/+$/g, '');
};

export const dedupeRoots = (roots: string[]) => {
  const seen = new Set<string>();
  return roots
    .map(normalizePath)
    .filter((root) => root.length > 0)
    .filter((root) => {
      if (seen.has(root)) {
        return false;
      }

      seen.add(root);
      return true;
    });
};

export const parentDirectory = (path: string) => {
  const normalized = normalizePath(path);
  if (!normalized || normalized === '/') {
    return null;
  }

  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return '/';
  }

  return normalized.slice(0, lastSlashIndex);
};

export const pathBasename = (path: string) => {
  const normalized = normalizePath(path);
  if (!normalized || normalized === '/') {
    return normalized || '/';
  }

  const lastSlashIndex = normalized.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
};

export const seedBrowseState = (roots: string[], recentRoots: string[]): BrowseSeedState => {
  const selectedPath = dedupeRoots([...roots, ...recentRoots])[0] ?? '';
  return {
    anchorPath: parentDirectory(selectedPath) ?? selectedPath,
    selectedPath,
  };
};

export const accessModeContextLabel = (accessMode: AccessMode) =>
  accessMode === 'workspace-write' ? 'read/write allowed root' : 'read-only allowed root';

export const countLabel = (count: number) => `${count} ${count === 1 ? 'subdir' : 'subdirs'}`;
