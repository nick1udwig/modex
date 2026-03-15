package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func LoadDotEnv() ([]string, error) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("get working directory: %w", err)
	}

	return loadDotEnvFiles(
		filepath.Join(workingDirectory, ".env.local"),
		filepath.Join(workingDirectory, ".env"),
		filepath.Join(workingDirectory, "backend", "sidecar", ".env.local"),
		filepath.Join(workingDirectory, "backend", "sidecar", ".env"),
	)
}

func loadDotEnvFiles(paths ...string) ([]string, error) {
	seen := make(map[string]struct{}, len(paths))
	loaded := make([]string, 0, len(paths))

	for _, path := range paths {
		normalized := filepath.Clean(path)
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}

		content, err := os.ReadFile(normalized)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}

			return loaded, fmt.Errorf("read %s: %w", normalized, err)
		}

		if err := parseDotEnv(string(content)); err != nil {
			return loaded, fmt.Errorf("parse %s: %w", normalized, err)
		}

		loaded = append(loaded, normalized)
	}

	return loaded, nil
}

func parseDotEnv(content string) error {
	scanner := bufio.NewScanner(strings.NewReader(content))
	for lineNumber := 1; scanner.Scan(); lineNumber += 1 {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}

		delimiterIndex := strings.IndexRune(line, '=')
		if delimiterIndex <= 0 {
			return fmt.Errorf("line %d: expected KEY=VALUE", lineNumber)
		}

		key := strings.TrimSpace(line[:delimiterIndex])
		value := strings.TrimSpace(line[delimiterIndex+1:])
		if key == "" {
			return fmt.Errorf("line %d: missing variable name", lineNumber)
		}

		if _, exists := os.LookupEnv(key); exists {
			continue
		}

		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}

		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("line %d: set %s: %w", lineNumber, key, err)
		}
	}

	if err := scanner.Err(); err != nil {
		return err
	}

	return nil
}
