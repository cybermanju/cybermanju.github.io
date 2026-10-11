// CyberManju OS — Cmd test (cli/cmd/cmd_test.go).
// Role: CLI command wiring tests — flags newcomers rely on must exist.
// Exports: TestFilesCatRenderFlag, TestContentName.
// Integrates: testing, cmd package internals.
// Contracts: no network, no profile — flag shape and pure helpers only.
package cmd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func TestFilesCatRenderFlag(t *testing.T) {
	f := filesCatCmd.Flags().Lookup("render")
	if f == nil {
		t.Fatal("files cat must expose --render")
	}
	if f.Shorthand != "r" {
		t.Fatalf("render shorthand must be -r, got %q", f.Shorthand)
	}
	if f.DefValue != "false" {
		t.Fatalf("render must default off, got %q", f.DefValue)
	}
}

func TestContentName(t *testing.T) {
	if got := contentName([]byte(`{"name":"notes.md","content":"# hi"}`)); got != "notes.md" {
		t.Fatalf("want notes.md, got %q", got)
	}
	if got := contentName([]byte(`not json`)); got != "" {
		t.Fatalf("unexpected shapes must yield empty, got %q", got)
	}
}

// TestFilesCatRenderEndToEnd serves a fake dashboard and asserts `cat -r`
// glamour-renders the content instead of dumping the JSON envelope.
func TestFilesCatRenderEndToEnd(t *testing.T) {
	lipgloss.SetColorProfile(termenv.Ascii)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/files/note1/content" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"fileId":"note1","name":"notes.md","content":"# hello vault","sizeBytes":13}`)
	}))
	defer srv.Close()

	oldServer, oldToken, oldRender := flagServer, flagToken, filesCatRender
	flagServer, flagToken, filesCatRender = srv.URL, "tok", true
	defer func() { flagServer, flagToken, filesCatRender = oldServer, oldToken, oldRender }()

	out := captureStdout(t, func() {
		if err := filesCatCmd.RunE(filesCatCmd, []string{"note1"}); err != nil {
			t.Fatalf("cat -r failed: %v", err)
		}
	})
	if !strings.Contains(out, "hello vault") {
		t.Fatalf("rendered output lost the heading: %q", out)
	}
	if strings.Contains(out, `"content"`) {
		t.Fatalf("rendered output leaked the JSON envelope: %q", out)
	}
}

// captureStdout swaps os.Stdout for the duration of fn (ui prints there).
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	defer func() { os.Stdout = old }()
	fn()
	_ = w.Close()
	raw, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
