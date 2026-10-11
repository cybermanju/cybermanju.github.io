// Package config persists the CLI's connection profile: which dashboard to
// talk to and the JWT minted by `cyb login` / `cyb setup`. The file is
// created 0600 — the token is a bearer credential, never logged.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// File is the on-disk profile.
type File struct {
	Server    string `json:"server"`
	Token     string `json:"token,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// DefaultServer is used when nothing else points at a dashboard.
const DefaultServer = "http://127.0.0.1:3456"

// Dir returns the platform config dir for the CLI.
func Dir() (string, error) {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "cybermanju"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "cybermanju"), nil
}

// Path returns the profile file path.
func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "cyb.json"), nil
}

// HistoryPath returns the REPL history file path.
func HistoryPath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "history"), nil
}

// Load reads the profile; a missing file is not an error.
func Load() (File, error) {
	var f File
	path, err := Path()
	if err != nil {
		return f, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return f, nil
		}
		return f, err
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		return f, fmt.Errorf("parse %s: %w", path, err)
	}
	return f, nil
}

// Save writes the profile with 0600 permissions.
func Save(f File) error {
	path, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o600)
}

// ResolveServer picks the dashboard URL: flag > env > file > default.
func ResolveServer(flag string, f File) string {
	if s := strings.TrimSpace(flag); s != "" {
		return strings.TrimRight(s, "/")
	}
	if s := strings.TrimSpace(os.Getenv("CYBERMANJU_SERVER")); s != "" {
		return strings.TrimRight(s, "/")
	}
	if s := strings.TrimSpace(f.Server); s != "" {
		return strings.TrimRight(s, "/")
	}
	return DefaultServer
}

// ResolveToken picks the JWT: flag > env > file (empty = anonymous).
func ResolveToken(flag string, f File) string {
	if t := strings.TrimSpace(flag); t != "" {
		return t
	}
	if t := strings.TrimSpace(os.Getenv("CYBERMANJU_TOKEN")); t != "" {
		return t
	}
	return strings.TrimSpace(f.Token)
}
