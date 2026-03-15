package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotEnvFilesLoadsWithoutOverwritingExistingEnv(t *testing.T) {
	tempDirectory := t.TempDir()

	envPath := filepath.Join(tempDirectory, ".env")
	localPath := filepath.Join(tempDirectory, ".env.local")

	if err := os.WriteFile(envPath, []byte("MODEX_SIDECAR_ADDR=:5000\nOPENAI_API_KEY=from-env\n"), 0o644); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	if err := os.WriteFile(localPath, []byte("MODEX_SIDECAR_ADDR=:6000\nMODEX_SIDECAR_AUTH_TOKEN=secret\n"), 0o644); err != nil {
		t.Fatalf("write .env.local: %v", err)
	}

	t.Setenv("OPENAI_API_KEY", "preexisting")
	loaded, err := loadDotEnvFiles(localPath, envPath)
	if err != nil {
		t.Fatalf("load dotenv files: %v", err)
	}

	if len(loaded) != 2 {
		t.Fatalf("expected 2 loaded files, got %d", len(loaded))
	}

	if got := os.Getenv("MODEX_SIDECAR_ADDR"); got != ":6000" {
		t.Fatalf("expected .env.local to populate addr first, got %q", got)
	}

	if got := os.Getenv("MODEX_SIDECAR_AUTH_TOKEN"); got != "secret" {
		t.Fatalf("expected auth token from .env.local, got %q", got)
	}

	if got := os.Getenv("OPENAI_API_KEY"); got != "preexisting" {
		t.Fatalf("expected existing env to win, got %q", got)
	}
}
