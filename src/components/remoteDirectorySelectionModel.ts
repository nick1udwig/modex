export type DirectorySelectionMode = 'multiple' | 'single';

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

const dedupeRoots = (roots: string[]) => {
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

export const addSelectedDirectory = (current: string[], nextPath: string, mode: DirectorySelectionMode) => {
  const next = dedupeRoots([...current, nextPath]);
  if (mode === 'single') {
    return next.length === 0 ? [] : [next[next.length - 1]];
  }

  return next;
};

export const moveSelectedDirectoryToFront = (current: string[], root: string) => {
  const next = dedupeRoots(current);
  const remaining = next.filter((entry) => entry !== root);
  return [root, ...remaining];
};

export const removeSelectedDirectory = (current: string[], root: string) => current.filter((entry) => entry !== root);
