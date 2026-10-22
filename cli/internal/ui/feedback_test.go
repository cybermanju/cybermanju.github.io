// CyberManju OS — Terminal feedback regressions (cli/internal/ui/feedback_test.go).
// Role: protect completion, truthful progress and narrow Markdown reading areas.
// Exports: TestSpinner*, TestDownloadProgress*, TestMarkdownWidth*.
// Integrates: headless Bubble Tea, Bubbles progress and Glamour renderers.
// Contracts: one operation result, bounded feedback, no false success on failure.
package ui

import (
	"errors"
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
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
)

func TestSpinnerCompletionBroadcast(t *testing.T) {
	want := errors.New("network: disconnected")
	task := &spinTask{done: make(chan struct{})}
	finished := make(chan error, 1)
	p := tea.NewProgram(newSpinModel("Working", task), tea.WithInput(nil), tea.WithOutput(io.Discard), tea.WithoutRenderer(), tea.WithoutSignalHandler())
	go func() {
		_, err := p.Run()
		finished <- err
	}()
	task.err = want
	close(task.done)
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("headless renderer failed: %v", err)
		}
	case <-time.After(3 * time.Second):
		p.Kill()
		t.Fatal("spinner did not exit after task completion")
	}
	// The UI has already consumed completion. The caller must still be able
	// to observe the same result without blocking or losing the error.
	select {
	case <-task.done:
		if !errors.Is(task.err, want) {
			t.Fatalf("operation error lost: %v", task.err)
		}
	default:
		t.Fatal("completion was consumed instead of broadcast")
	}
}

func TestSpinnerNarrowSingleLine(t *testing.T) {
	m := newSpinModel("Probing dashboard\n"+strings.Repeat("界", 50), &spinTask{done: make(chan struct{})})
	for _, width := range []int{1, 8, 20, 40, 80} {
		next, _ := m.Update(tea.WindowSizeMsg{Width: width, Height: 10})
		m = next.(spinModel)
		view := m.View().Content
		if lipgloss.Width(view) > width || lipgloss.Height(view) != 1 {
			t.Fatalf("spinner overflow at %d: %q", width, view)
		}
	}
}

func TestDownloadProgressWidthAndActualPercent(t *testing.T) {
	for _, width := range []int{1, 8, 15, 16, 20, 32, 80} {
		for _, status := range []string{"", "failed", "downloaded"} {
			got := renderDownloadProgress(width, 25, 100, status)
			if lipgloss.Width(got) > width || lipgloss.Height(got) != 1 {
				t.Fatalf("progress overflow at %d: %q", width, got)
			}
			if width >= 16 {
				plain := ansi.Strip(got)
				if !strings.Contains(plain, "25%") || !strings.Contains(plain, status) || strings.Contains(plain, "100%") {
					t.Fatalf("progress concealed actual result: %q", plain)
				}
			}
		}
	}
	if got := ansi.Strip(renderDownloadProgress(40, 999, 1000, "failed")); strings.Contains(got, "100%") || !strings.Contains(got, "99%") {
		t.Fatalf("incomplete transfer rounded up to success: %q", got)
	}
}

func TestDownloadTruncatedBodyIsFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100")
		_, _ = io.WriteString(w, "partial")
	}))
	defer server.Close()
	dest := filepath.Join(t.TempDir(), "download")
	n, err := Download(server.URL, dest)
	if !errors.Is(err, io.ErrUnexpectedEOF) || n != int64(len("partial")) {
		t.Fatalf("truncated response must not succeed: n=%d err=%v", n, err)
	}
	if got, err := os.ReadFile(dest); err != nil || string(got) != "partial" {
		t.Fatalf("download byte count disagrees with file: %q %v", got, err)
	}
}

func TestMarkdownWidthInvalidStyleFallback(t *testing.T) {
	t.Setenv("GLAMOUR_STYLE", "no-such-style")
	input := strings.Repeat("fallback ", 30)
	out := RenderMarkdownWidth(32, input)
	if lipgloss.Width(out) > 32 || strings.Join(strings.Fields(out), "") != strings.Join(strings.Fields(input), "") {
		t.Fatalf("invalid stylesheet fallback lost content or exceeded width: %q", out)
	}
}

func TestMarkdownWidthBoundsCodeAndLongLinks(t *testing.T) {
	old := lipgloss.Writer.Profile
	t.Cleanup(func() { lipgloss.Writer.Profile = old })
	t.Setenv("GLAMOUR_STYLE", "")
	input := "# Reading\n\nRead [documentation](https://example.test/" + strings.Repeat("very-long-path/", 12) + ").\n\n```text\n" + strings.Repeat("abcdefghij", 15) + "\n```\n\n- vault files remain available\n"
	for _, profile := range []colorprofile.Profile{colorprofile.TrueColor, colorprofile.NoTTY} {
		lipgloss.Writer.Profile = profile
		for _, width := range []int{1, 8, 20, 32, 40, 80} {
			out := RenderMarkdownWidth(width, input)
			for _, line := range strings.Split(out, "\n") {
				if lipgloss.Width(line) > width {
					t.Fatalf("Markdown overflow at %d: %q", width, line)
				}
			}
			if profile == colorprofile.NoTTY && strings.Contains(out, "\x1b") {
				t.Fatal("plain Markdown contains terminal escapes")
			}
			// Ignore layout spaces when checking that hard-wrapping kept content.
			plain := strings.Join(strings.Fields(ansi.Strip(out)), "")
			if !strings.Contains(plain, strings.Repeat("abcdefghij", 15)) {
				t.Fatalf("code was clipped at width %d", width)
			}
		}
	}
}
