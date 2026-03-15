package filesystem

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"modex/backend/sidecar/internal/config"
)

var ErrForbidden = errors.New("path is outside configured filesystem roots")

type Root struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

type Entry struct {
	Directory  bool      `json:"directory"`
	Hidden     bool      `json:"hidden"`
	Kind       string    `json:"kind"`
	ModTime    time.Time `json:"modTime"`
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Selectable bool      `json:"selectable"`
	Size       int64     `json:"size"`
}

type ListResult struct {
	Entries []Entry `json:"entries"`
	Parent  string  `json:"parent,omitempty"`
	Path    string  `json:"path"`
	Roots   []Root  `json:"roots"`
}

type Service struct {
	allowedRoots     []string
	defaultRoots     []Root
	includeHidden    bool
	searchMaxResults int
}

func New(cfg config.FilesystemConfig) (*Service, error) {
	allowedRoots := make([]string, 0, len(cfg.AllowedRoots))
	for _, root := range cfg.AllowedRoots {
		resolved, err := resolveExistingDir(root)
		if err != nil {
			return nil, fmt.Errorf("resolve root %q: %w", root, err)
		}
		allowedRoots = append(allowedRoots, resolved)
	}

	if len(allowedRoots) == 0 {
		home, _ := os.UserHomeDir()
		cwd, _ := os.Getwd()
		defaultRoots := dedupeNonEmptyPaths("/", home, cwd)
		return &Service{
			allowedRoots:     nil,
			defaultRoots:     rootsFromPaths(defaultRoots),
			includeHidden:    cfg.IncludeHidden,
			searchMaxResults: max(cfg.SearchMaxResults, 1),
		}, nil
	}

	return &Service{
		allowedRoots:     allowedRoots,
		defaultRoots:     rootsFromPaths(allowedRoots),
		includeHidden:    cfg.IncludeHidden,
		searchMaxResults: max(cfg.SearchMaxResults, 1),
	}, nil
}

func (s *Service) Roots() []Root {
	return slices.Clone(s.defaultRoots)
}

func (s *Service) List(path string, showHidden bool, directoriesOnly bool) (ListResult, error) {
	if strings.TrimSpace(path) == "" {
		if len(s.defaultRoots) == 0 {
			return ListResult{Roots: s.Roots()}, nil
		}
		path = s.defaultRoots[0].Path
	}

	resolved, err := s.resolvePath(path)
	if err != nil {
		return ListResult{}, err
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return ListResult{}, err
	}
	if !info.IsDir() {
		return ListResult{}, fmt.Errorf("%s is not a directory", resolved)
	}

	directoryEntries, err := os.ReadDir(resolved)
	if err != nil {
		return ListResult{}, err
	}

	entries := make([]Entry, 0, len(directoryEntries))
	for _, dirEntry := range directoryEntries {
		if !showHidden && !s.includeHidden && isHidden(dirEntry.Name()) {
			continue
		}

		info, err := dirEntry.Info()
		if err != nil {
			continue
		}

		entryPath := filepath.Join(resolved, dirEntry.Name())
		if directoriesOnly && !info.IsDir() {
			continue
		}

		entries = append(entries, newEntry(dirEntry.Name(), entryPath, info))
	}

	slices.SortFunc(entries, compareEntries)

	return ListResult{
		Entries: entries,
		Parent:  s.parentFor(resolved),
		Path:    resolved,
		Roots:   s.Roots(),
	}, nil
}

func (s *Service) Stat(path string) (Entry, error) {
	resolved, err := s.resolvePath(path)
	if err != nil {
		return Entry{}, err
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return Entry{}, err
	}

	return newEntry(filepath.Base(resolved), resolved, info), nil
}

func (s *Service) Search(path string, query string, showHidden bool, directoriesOnly bool, maxResults int) ([]Entry, error) {
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}

	if strings.TrimSpace(path) == "" {
		if len(s.defaultRoots) == 0 {
			path = "/"
		} else {
			path = s.defaultRoots[0].Path
		}
	}

	resolved, err := s.resolvePath(path)
	if err != nil {
		return nil, err
	}

	limit := s.searchMaxResults
	if maxResults > 0 && maxResults < limit {
		limit = maxResults
	}

	loweredQuery := strings.ToLower(strings.TrimSpace(query))
	results := make([]Entry, 0, min(limit, 16))

	walkErr := filepath.WalkDir(resolved, func(current string, dirEntry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		if current == resolved {
			return nil
		}

		name := dirEntry.Name()
		hidden := isHidden(name)
		if hidden && !showHidden && !s.includeHidden {
			if dirEntry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		info, infoErr := dirEntry.Info()
		if infoErr != nil {
			return nil
		}

		if directoriesOnly && !info.IsDir() {
			return nil
		}

		matchTarget := strings.ToLower(name)
		if strings.Contains(matchTarget, loweredQuery) || strings.Contains(strings.ToLower(current), loweredQuery) {
			results = append(results, newEntry(name, current, info))
			if len(results) >= limit {
				return errSearchDone
			}
		}

		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errSearchDone) {
		return nil, walkErr
	}

	slices.SortFunc(results, compareEntries)
	return results, nil
}

var errSearchDone = errors.New("search complete")

func (s *Service) resolvePath(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", fmt.Errorf("path is required")
	}

	absolute := trimmed
	if !filepath.IsAbs(absolute) {
		absolute = filepath.Clean(filepath.Join("/", absolute))
	}
	absolute = filepath.Clean(absolute)

	resolved := absolute
	if existing, err := filepath.EvalSymlinks(absolute); err == nil {
		resolved = existing
	}

	if len(s.allowedRoots) == 0 {
		return resolved, nil
	}

	for _, root := range s.allowedRoots {
		if resolved == root || strings.HasPrefix(resolved, root+string(os.PathSeparator)) {
			return resolved, nil
		}
	}

	return "", ErrForbidden
}

func (s *Service) parentFor(path string) string {
	parent := filepath.Dir(path)
	if parent == path {
		return ""
	}

	if len(s.allowedRoots) == 0 {
		return parent
	}

	for _, root := range s.allowedRoots {
		if path == root {
			return ""
		}
		if parent == root || strings.HasPrefix(parent, root+string(os.PathSeparator)) {
			return parent
		}
	}

	return ""
}

func compareEntries(left Entry, right Entry) int {
	if left.Directory != right.Directory {
		if left.Directory {
			return -1
		}
		return 1
	}

	return strings.Compare(strings.ToLower(left.Name), strings.ToLower(right.Name))
}

func newEntry(name string, path string, info os.FileInfo) Entry {
	return Entry{
		Directory:  info.IsDir(),
		Hidden:     isHidden(name),
		Kind:       kindFromMode(info.Mode()),
		ModTime:    info.ModTime().UTC(),
		Name:       name,
		Path:       path,
		Selectable: info.IsDir(),
		Size:       info.Size(),
	}
}

func kindFromMode(mode fs.FileMode) string {
	switch {
	case mode.IsDir():
		return "directory"
	case mode&os.ModeSymlink != 0:
		return "symlink"
	case mode.IsRegular():
		return "file"
	default:
		return "other"
	}
}

func isHidden(name string) bool {
	return strings.HasPrefix(name, ".") && name != "." && name != ".."
}

func resolveExistingDir(path string) (string, error) {
	resolved, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", err
	}

	resolved, err = filepath.EvalSymlinks(resolved)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s is not a directory", resolved)
	}

	return resolved, nil
}

func rootsFromPaths(paths []string) []Root {
	roots := make([]Root, 0, len(paths))
	for _, path := range paths {
		label := path
		if path == "/" {
			label = "root"
		}
		roots = append(roots, Root{
			Label: label,
			Path:  path,
		})
	}
	return roots
}

func dedupeNonEmptyPaths(paths ...string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}

		resolved := filepath.Clean(trimmed)
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		result = append(result, resolved)
	}
	return result
}
