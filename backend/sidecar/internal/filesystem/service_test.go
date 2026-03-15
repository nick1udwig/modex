package filesystem

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"modex/backend/sidecar/internal/config"
)

func TestListFiltersAndSortsEntries(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	mustMkdir(t, filepath.Join(root, "alpha"))
	mustWriteFile(t, filepath.Join(root, "zeta.txt"))
	mustWriteFile(t, filepath.Join(root, ".hidden.txt"))

	service, err := New(config.FilesystemConfig{
		AllowedRoots: []string{root},
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	result, err := service.List(root, false, false)
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(result.Entries) != 2 {
		t.Fatalf("expected 2 visible entries, got %d", len(result.Entries))
	}

	if got := result.Entries[0].Name; got != "alpha" {
		t.Fatalf("expected directory first, got %q", got)
	}
	if got := result.Entries[1].Name; got != "zeta.txt" {
		t.Fatalf("expected file second, got %q", got)
	}
}

func TestSearchHonorsRestrictions(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	project := filepath.Join(root, "modex")
	mustMkdir(t, project)
	mustWriteFile(t, filepath.Join(project, "README.md"))

	service, err := New(config.FilesystemConfig{
		AllowedRoots: []string{root},
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	results, err := service.Search(root, "modex", false, true, 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 search result, got %d", len(results))
	}
	if results[0].Path != project {
		t.Fatalf("unexpected result path %q", results[0].Path)
	}
}

func TestStatRejectsOutsideAllowedRoots(t *testing.T) {
	t.Parallel()

	root := t.TempDir()

	service, err := New(config.FilesystemConfig{
		AllowedRoots: []string{root},
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	_, err = service.Stat("/")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden error, got %v", err)
	}
}

func mustMkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func mustWriteFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatalf("write file %s: %v", path, err)
	}
}
