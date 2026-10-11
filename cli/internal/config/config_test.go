package config

import (
	"os"
	"path/filepath"
	"testing"
)

func withHome(t *testing.T) {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("CYBERMANJU_SERVER", "")
	t.Setenv("CYBERMANJU_TOKEN", "")
}

func TestSaveLoadRoundTrip(t *testing.T) {
	withHome(t)
	if err := Save(File{Server: "http://127.0.0.1:3456", Token: "abc"}); err != nil {
		t.Fatal(err)
	}
	path, _ := Path()
	if !filepath.IsAbs(path) {
		t.Fatalf("not absolute: %s", path)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("profile is %o, want 600", info.Mode().Perm())
	}
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Server != "http://127.0.0.1:3456" || got.Token != "abc" {
		t.Fatalf("bad round trip: %+v", got)
	}
}

func TestMissingFileIsEmpty(t *testing.T) {
	withHome(t)
	got, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Server != "" || got.Token != "" {
		t.Fatalf("expected empty, got %+v", got)
	}
}

func TestResolutionOrder(t *testing.T) {
	withHome(t)
	f := File{Server: "http://file:3456", Token: "filetok"}
	if got := ResolveServer("", f); got != "http://file:3456" {
		t.Fatalf("file server: %s", got)
	}
	t.Setenv("CYBERMANJU_SERVER", "http://env:3456")
	if got := ResolveServer("", f); got != "http://env:3456" {
		t.Fatalf("env server: %s", got)
	}
	if got := ResolveServer("http://flag:3456/", f); got != "http://flag:3456" {
		t.Fatalf("flag server (trailing slash): %s", got)
	}
	t.Setenv("CYBERMANJU_TOKEN", "envtok")
	if got := ResolveToken("", f); got != "envtok" {
		t.Fatalf("env token: %s", got)
	}
	if got := ResolveToken("flagtok", f); got != "flagtok" {
		t.Fatalf("flag token: %s", got)
	}
	t.Setenv("CYBERMANJU_SERVER", "")
	t.Setenv("CYBERMANJU_TOKEN", "")
	if got := ResolveServer("", File{}); got != DefaultServer {
		t.Fatalf("default: %s", got)
	}
}
