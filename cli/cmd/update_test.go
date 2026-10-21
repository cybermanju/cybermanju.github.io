// CyberManju OS — Updater tests (cli/cmd/update_test.go).
// Role: enforce fail-closed release artifact integrity checks.
// Exports: TestDownloadAndVerifyChecksum*, TestVerifyChecksum*.
// Integrates: crypto/sha256, os, filepath, testing.
// Contracts: only one valid checksum for the exact asset permits update installation.
package cmd

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadAndVerifyChecksumRequiresChecksumURL(t *testing.T) {
	err := downloadAndVerifyChecksum("", "", "", "cyb-linux.tar.gz", func(string, string) (int64, error) {
		t.Fatal("download must not run without a checksum URL")
		return 0, nil
	})
	if err == nil || !strings.Contains(err.Error(), "URL is missing") {
		t.Fatalf("expected missing checksum URL error, got %v", err)
	}
}

func TestDownloadAndVerifyChecksumFailsOnDownloadError(t *testing.T) {
	called := false
	err := downloadAndVerifyChecksum("https://example.invalid/SHA256SUMS.txt", "ignored", "", "asset", func(string, string) (int64, error) {
		called = true
		return -1, errors.New("offline")
	})
	if !called || err == nil || !strings.Contains(err.Error(), "cannot download release checksum") {
		t.Fatalf("expected a checksum download failure, called=%v err=%v", called, err)
	}
}

func TestDownloadAndVerifyChecksumValidatesAsset(t *testing.T) {
	dir := t.TempDir()
	asset := "cyb-linux.tar.gz"
	data := []byte("release bytes")
	tarball := filepath.Join(dir, asset)
	if err := os.WriteFile(tarball, data, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	checksum := hex.EncodeToString(digest[:]) + "  " + asset + "\n"
	sumsFile := filepath.Join(dir, "SHA256SUMS.txt")
	err := downloadAndVerifyChecksum("https://example.invalid/SHA256SUMS.txt", sumsFile, tarball, asset, func(_ string, dest string) (int64, error) {
		if err := os.WriteFile(dest, []byte(checksum), 0o600); err != nil {
			return 0, err
		}
		return int64(len(checksum)), nil
	})
	if err != nil {
		t.Fatalf("valid checksum should pass: %v", err)
	}
}

func TestVerifyChecksumRejectsMissingAndMalformedEntries(t *testing.T) {
	dir := t.TempDir()
	asset := filepath.Join(dir, "release.tar.gz")
	if err := os.WriteFile(asset, []byte("bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	sums := filepath.Join(dir, "SHA256SUMS.txt")
	for _, content := range []string{"", "not-a-sha256  release.tar.gz\n"} {
		if err := os.WriteFile(sums, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := verifyChecksum(sums, asset, "release.tar.gz"); err == nil {
			t.Fatalf("expected rejection for checksum content %q", content)
		}
	}
}

func TestVerifyChecksumRequiresUniqueExactAsset(t *testing.T) {
	const asset = "cyb-android-arm64.tar.gz"
	data := []byte("verified release bytes")
	digest := sha256.Sum256(data)
	hash := hex.EncodeToString(digest[:])
	text := hash + "  " + asset + "\n"
	binary := hash + " *" + asset + "\n"
	wrong := strings.Repeat("0", sha256.Size*2) + "  " + asset + "\n"
	tests := []struct {
		name    string
		content string
		wantErr string
	}{
		{"GNU text", text, ""},
		{"GNU binary", binary, ""},
		{"uppercase digest", strings.ToUpper(hash) + "  " + asset + "\r\n", ""},
		{"unrelated entry", hash + "  other.tar.gz\n" + text, ""},
		{"directory suffix only", hash + "  nested/" + asset + "\n", "no checksum entry"},
		{"directory suffix before exact", hash + "  nested/" + asset + "\n" + text, ""},
		{"duplicate identical", text + text, "duplicate checksum entry"},
		{"duplicate mixed markers", text + binary, "duplicate checksum entry"},
		{"duplicate conflicting", text + wrong, "duplicate checksum entry"},
		{"duplicate conflicting reversed", wrong + text, "duplicate checksum entry"},
		{"mismatched digest", wrong, "checksum mismatch"},
		{"invalid digest", "invalid  " + asset + "\n", "invalid SHA-256"},
		{"extra fields", hash + "  " + asset + " unexpected\n", "invalid checksum entry"},
		{"malformed before valid", hash + "  " + asset + " unexpected\n" + text, "invalid checksum entry"},
		{"malformed after valid", text + hash + "  " + asset + " unexpected\n", "invalid checksum entry"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			tarball := filepath.Join(dir, asset)
			sums := filepath.Join(dir, "SHA256SUMS.txt")
			if err := os.WriteFile(tarball, data, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(sums, []byte(tt.content), 0o600); err != nil {
				t.Fatal(err)
			}
			err := verifyChecksum(sums, tarball, asset)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("valid manifest rejected: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}
