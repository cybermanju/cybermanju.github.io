// CyberManju OS — CUTE shell tests (cli/cmd/repl_test.go).
// Role: exercise remote shell UX without a real terminal or dashboard.
// Exports: TestCUTE*, TestQuoteArg*, TestRunScript*.
// Integrates: Bubble Tea messages, httptest, Cobra and client.
// Contracts: async execution, bounded layout, safe text, private history and argv fidelity.
package cmd

import (
	"encoding/json"
	"image/color"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/client"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
	"github.com/spf13/cobra"
)

func shellKey(code rune, mod tea.KeyMod) tea.KeyPressMsg {
	return tea.KeyPressMsg{Code: code, Mod: mod}
}

func updateShell(m replModel, msg tea.Msg) (replModel, tea.Cmd) {
	next, cmd := m.Update(msg)
	return next.(replModel), cmd
}

func testShell(t *testing.T) replModel {
	t.Helper()
	old := histFile
	histFile = ""
	t.Cleanup(func() { histFile = old })
	m := newReplModel(client.New("https://example.test", "token", time.Second), []string{"disk list", "pwd"})
	m, _ = updateShell(m, tea.WindowSizeMsg{Width: 40, Height: 18})
	return m
}

func TestCUTEAsyncAndCancellation(t *testing.T) {
	m := testShell(t)
	m.input.SetValue("disk list")
	m, cmd := updateShell(m, shellKey(tea.KeyEnter, 0))
	if cmd == nil || !m.busy || m.requestID != 1 {
		t.Fatal("Enter must schedule async work, never block Update")
	}
	m.input.SetValue("pwd")
	m, duplicate := updateShell(m, shellKey(tea.KeyEnter, 0))
	if duplicate != nil || m.input.Value() != "pwd" {
		t.Fatal("busy Enter must not submit twice or destroy draft")
	}
	id := m.requestID
	m, _ = updateShell(m, shellKey('c', tea.ModCtrl))
	if m.busy || !strings.Contains(strings.Join(m.lines, "\n"), "may still be running") {
		t.Fatal("cancel must describe local-only semantics")
	}
	m, _ = updateShell(m, shellResultMsg{id: id, response: client.ExecResp{OK: true, Output: "STALE"}})
	if strings.Contains(strings.Join(m.lines, "\n"), "STALE") {
		t.Fatal("cancelled response must be ignored")
	}
}

func TestCUTEHistoryDraftAndPrivacy(t *testing.T) {
	m := testShell(t)
	m.input.SetValue("unfinished search")
	m, _ = updateShell(m, shellKey(tea.KeyUp, 0))
	if m.input.Value() != "pwd" {
		t.Fatal("up must show last command")
	}
	m, _ = updateShell(m, shellKey(tea.KeyDown, 0))
	if m.input.Value() != "unfinished search" {
		t.Fatal("down must restore draft")
	}
	before := len(m.history)
	m.input.SetValue(" secret set private")
	m, _ = updateShell(m, shellKey(tea.KeyEnter, 0))
	if len(m.history) != before {
		t.Fatal("leading-space command must not enter history")
	}
	if m.cancel != nil {
		m.cancel()
	}
}

func TestCUTETabAndFailure(t *testing.T) {
	m := testShell(t)
	m.input.SetValue("disk l")
	m, _ = updateShell(m, shellKey(tea.KeyTab, 0))
	if m.input.Value() != "disk list" {
		t.Fatal("Tab must complete known server verbs")
	}
	m.requestID = 7
	m.busy = true
	m, _ = updateShell(m, shellResultMsg{id: 7, response: client.ExecResp{OK: false}})
	if m.busy || !strings.Contains(strings.Join(m.lines, "\n"), "shell command failed") {
		t.Fatal("failed result without message must still be visible")
	}
}

func TestCUTEResponsiveBounds(t *testing.T) {
	for _, size := range [][2]int{{80, 24}, {40, 18}, {32, 12}, {20, 8}, {8, 4}, {1, 1}} {
		m := testShell(t)
		m, _ = updateShell(m, tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		m.emit(strings.Repeat("界", 100))
		view := m.View()
		if !view.AltScreen {
			t.Fatal("workspace must restore normal screen on exit")
		}
		if got := lipgloss.Width(view.Content); got > size[0] {
			t.Fatalf("width %d overflow: %d", size[0], got)
		}
		if got := lipgloss.Height(view.Content); got > size[1] {
			t.Fatalf("height %d overflow: %d", size[1], got)
		}
		if size[0] >= 32 && size[1] >= 12 && !strings.Contains(ansi.Strip(view.Content), "cybsh") {
			t.Fatalf("prompt hidden at %v", size)
		}
	}
}

func TestCUTESafeTerminalTextAndScrollback(t *testing.T) {
	got := safeTerminalText("hello\x1b]52;c;YQ==\a\x1b[2J\r\u202Eworld\n\ttext")
	if got != "helloworld\n\ttext" {
		t.Fatalf("unsafe terminal controls survived: %q", got)
	}
	m := testShell(t)
	m.emit(strings.Repeat("line\n", 800))
	if len(m.lines) != 500 {
		t.Fatalf("scrollback unbounded: %d", len(m.lines))
	}
}

func TestCUTEHistoryPermissions(t *testing.T) {
	old := histFile
	t.Cleanup(func() { histFile = old })
	histFile = filepath.Join(t.TempDir(), "history")
	if err := os.WriteFile(histFile, []byte("old\n"), 0644); err != nil {
		t.Fatal(err)
	}
	appendHistoryLine("pwd")
	st, err := os.Stat(histFile)
	if err != nil || st.Mode().Perm() != 0600 {
		t.Fatalf("history must remain private: %v %v", st, err)
	}
}

func TestQuoteArgPreservesShellLiterals(t *testing.T) {
	for _, value := range []string{"", "normal", "a b", "x|rm", "x;rm", "x&&y", "a\\b", "a\"b", "a'b", "a\nb"} {
		want := "\"" + strings.ReplaceAll(strings.ReplaceAll(value, "\\", "\\\\"), "\"", "\\\"") + "\""
		if got := quoteArg(value); got != want {
			t.Errorf("quoteArg(%q)=%q want %q", value, got, want)
		}
	}
}

func TestRunScriptForwardsCobraDashArgs(t *testing.T) {
	var line string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		line = body["line"]
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer srv.Close()
	oldServer, oldToken, oldJSON := flagServer, flagToken, flagJSON
	flagServer, flagToken, flagJSON = srv.URL, "token", false
	defer func() { flagServer, flagToken, flagJSON = oldServer, oldToken, oldJSON }()
	command := &cobra.Command{Use: "run", RunE: runCmd.RunE}
	command.SetArgs([]string{"file;not-command.cybsh", "--", "a\\b", "x|y", ""})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	want := `run "file;not-command.cybsh" -- "a\\b" "x|y" ""`
	if line != want {
		t.Fatalf("argv mismatch: %q want %q", line, want)
	}
}

func TestCUTEPlainPipeCleanAndScannerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, `{"ok":true,"output":"42"}`) }))
	defer srv.Close()
	oldIn := os.Stdin
	defer func() { os.Stdin = oldIn }()
	path := filepath.Join(t.TempDir(), "input")
	if err := os.WriteFile(path, []byte("echo 42\n:quit\n"), 0600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	os.Stdin = f
	oldHistory := histFile
	histFile = ""
	defer func() { histFile = oldHistory }()
	out := captureStdout(t, func() {
		if err := plainRepl(client.New(srv.URL, "t", time.Second), nil); err != nil {
			t.Fatal(err)
		}
	})
	if out != "42\n" {
		t.Fatalf("pipe contaminated: %q", out)
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", 1024*1024+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	if err := plainRepl(client.New(srv.URL, "t", time.Second), nil); err == nil {
		t.Fatal("oversized line must report scanner error")
	}
}

func TestCUTETypingDoesNotScrollViewport(t *testing.T) {
	m := testShell(t)
	m.emit(strings.Repeat("line\n", 80))
	before := m.view.YOffset()
	for _, r := range "bfudhjkl " {
		m, _ = updateShell(m, tea.KeyPressMsg{Code: r, Text: string(r)})
		if m.view.YOffset() != before {
			t.Fatalf("typing %q scrolled output", r)
		}
	}
	m, _ = updateShell(m, shellKey(tea.KeyPgUp, 0))
	if m.view.YOffset() >= before {
		t.Fatal("PgUp must still scroll output")
	}
}

func TestCUTEBackgroundColorAdaptsInputTheme(t *testing.T) {
	m := testShell(t)
	oldDark := m.dark
	t.Cleanup(func() { ui.SetBackground(oldDark) })
	m, _ = updateShell(m, tea.BackgroundColorMsg{Color: color.RGBA{R: 245, G: 245, B: 245, A: 255}})
	if m.dark {
		t.Fatal("light background must select light input styling")
	}
	m, _ = updateShell(m, tea.BackgroundColorMsg{Color: color.RGBA{R: 8, G: 8, B: 8, A: 255}})
	if !m.dark {
		t.Fatal("dark background must select dark input styling")
	}
}

func TestCUTEBusyTinyLayoutKeepsControls(t *testing.T) {
	for _, size := range [][2]int{{12, 3}, {8, 2}, {1, 1}} {
		m := testShell(t)
		m.busy = true
		m.input.SetValue("echo ok")
		m, _ = updateShell(m, tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		content := ansi.Strip(m.View().Content)
		if lipgloss.Width(m.View().Content) > size[0] || lipgloss.Height(m.View().Content) > size[1] {
			t.Fatalf("layout exceeds %v: %q", size, content)
		}
		if size[1] >= 2 {
			lines := strings.Split(content, "\n")
			if strings.TrimSpace(lines[len(lines)-1]) == "" {
				t.Fatalf("busy footer hidden at %v: %q", size, content)
			}
		}
	}
}
