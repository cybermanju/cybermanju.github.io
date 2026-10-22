// CyberManju OS — cybsh contextual UX regressions (cli/cmd/repl_ux_test.go).
// Role: protect safe dismissal, discoverable help, private completion and scrollback behavior.
// Exports: TestCUTEContextualEscapeAndHelp, TestCUTECompletionPrivacyAndCycling, TestCUTEScrollbackKeepsPosition.
// Integrates: replModel, Bubble Tea key messages, Bubbles help and viewport.
// Contracts: Escape is never an accidental quit; completion never executes or strips private prefix.
package cmd

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func TestCUTEContextualEscapeAndHelp(t *testing.T) {
	m := testShell(t)
	m.input.SetValue("unfinished")
	m, cmd := updateShell(m, shellKey(tea.KeyEsc, 0))
	if cmd != nil || m.input.Value() != "" {
		t.Fatal("Escape should clear draft, not quit")
	}
	m.input.SetValue("draft")
	m, _ = updateShell(m, shellKey(tea.KeyF1, 0))
	if !m.helpVisible || !strings.Contains(ansi.Strip(m.View().Content), "history") || !strings.Contains(ansi.Strip(m.View().Content), "scrollback") {
		t.Fatal("F1 should reveal full Bubbles key help")
	}
	m, _ = updateShell(m, shellKey(tea.KeyEsc, 0))
	if m.input.Value() != "draft" || m.helpVisible {
		t.Fatal("Escape should dismiss help and preserve draft")
	}
	m, _ = updateShell(m, shellKey(tea.KeyEnter, 0))
	// A started request can be safely cancelled with Escape; late results are stale.
	id := m.requestID
	m, _ = updateShell(m, shellKey(tea.KeyEsc, 0))
	if m.busy {
		t.Fatal("Escape should stop waiting")
	}
	m, _ = updateShell(m, shellResultMsg{id: id})
	if strings.Contains(strings.Join(m.lines, "\n"), "shell command failed") {
		t.Fatal("stale response should be ignored")
	}
}

func TestCUTECompletionPrivacyAndCycling(t *testing.T) {
	m := testShell(t)
	m.input.SetValue(" disk l")
	m, _ = updateShell(m, shellKey(tea.KeyTab, 0))
	if m.input.Value() != " disk list" {
		t.Fatalf("completion lost leading private prefix: %q", m.input.Value())
	}
	if len(m.history) != 2 {
		t.Fatal("completion must not write history")
	}
	m.input.SetValue("d")
	m, _ = updateShell(m, shellKey(tea.KeyTab, 0))
	first := m.input.Value()
	m, _ = updateShell(m, shellKey(tea.KeyTab, 0))
	second := m.input.Value()
	if first == second || first == "" || second == "" {
		t.Fatalf("Tab should cycle matches: %q then %q", first, second)
	}
}

func TestCUTEScrollbackKeepsPosition(t *testing.T) {
	m := testShell(t)
	m.emit(strings.Repeat("line\n", 80))
	m, _ = updateShell(m, shellKey(tea.KeyPgUp, 0))
	offset := m.view.YOffset()
	m.emit("incoming")
	if m.view.YOffset() != offset || !m.newOutput {
		t.Fatal("incoming output should preserve reading position and mark new output")
	}
	m, _ = updateShell(m, shellKey(tea.KeyEnd, tea.ModCtrl))
	if !m.view.AtBottom() || m.newOutput {
		t.Fatal("Ctrl+End should jump to latest and clear hint")
	}
}

func TestCUTECompletionReverseResetAndSubmittedPrivacy(t *testing.T) {
	m := testShell(t)
	m.input.SetValue("d")
	m, _ = updateShell(m, shellKey(tea.KeyTab, tea.ModShift))
	if len(m.completion) == 0 || m.completionIndex != len(m.completion)-1 || m.input.Value() != m.completion[m.completionIndex] {
		t.Fatalf("reverse completion should select last matching candidate, got %q", m.input.Value())
	}
	m, _ = updateShell(m, shellKey(tea.KeyTab, 0))
	if m.completionIndex != 0 {
		t.Fatal("forward completion must wrap after last candidate")
	}
	m.input.SetValue(" disk l")
	m, _ = updateShell(m, shellKey(tea.KeyTab, 0))
	before := len(m.history)
	m, _ = updateShell(m, shellKey(tea.KeyEnter, 0))
	if len(m.completion) != 0 || len(m.history) != before {
		t.Fatal("submit should reset completion without exposing private history")
	}
	if m.cancel != nil {
		m.cancel()
	}
}

func TestCUTEResizePreservesBottomOrReadingPosition(t *testing.T) {
	for _, size := range [][2]int{{80, 24}, {20, 8}} {
		m := testShell(t)
		m.emit(strings.Repeat("line\n", 100))
		m.view.GotoBottom()
		m.resize(size[0], size[1])
		if !m.view.AtBottom() {
			t.Fatalf("resize %v lost bottom-follow", size)
		}
		m, _ = updateShell(m, shellKey(tea.KeyPgUp, 0))
		offset := m.view.YOffset()
		m.resize(80, 24)
		if m.view.AtBottom() || m.view.YOffset() == 0 {
			t.Fatalf("resize lost reader position: before=%d after=%d", offset, m.view.YOffset())
		}
	}
}

func TestCUTEHelpAndBusyBoundsAndResetControls(t *testing.T) {
	for w := 1; w <= 80; w++ {
		for h := 1; h <= 24; h++ {
			m := testShell(t)
			m.busy = true
			m.helpVisible = true
			m.newOutput = true
			m.resize(w, h)
			v := m.View()
			if lipgloss.Width(v.Content) > w || lipgloss.Height(v.Content) > h {
				t.Fatalf("help/busy overflow at %dx%d: %dx%d", w, h, lipgloss.Width(v.Content), lipgloss.Height(v.Content))
			}
		}
	}
	m := testShell(t)
	m.completion = []string{"disk list"}
	m.newOutput = true
	m, _ = updateShell(m, tea.KeyPressMsg{Code: 'l', Text: "l"})
	if !m.newOutput {
		t.Fatal("ordinary draft edit cleared unseen-output hint")
	}
	if m.completion != nil {
		t.Fatal("editing a draft must reset completion candidates")
	}
	m.input.Reset()
	m, _ = updateShell(m, tea.KeyPressMsg{Code: '?', Text: "?"})
	if m.input.Value() == "" {
		t.Fatal("literal question mark should be ordinary input")
	}
	m, _ = updateShell(m, shellKey('d', tea.ModCtrl))
	if m.input.Value() == "" {
		t.Fatal("Ctrl+D with draft must not quit/clear")
	}
	m, _ = updateShell(m, shellKey('c', tea.ModCtrl))
	if len(m.completion) != 0 {
		t.Fatal("Ctrl+C draft clear must reset completion")
	}
	m.completion = []string{"pwd"}
	m.newOutput = true
	m.input.SetValue(":clear")
	m, _ = updateShell(m, shellKey(tea.KeyEnter, 0))
	if len(m.completion) != 0 || m.newOutput {
		t.Fatal(":clear must reset completion and output hint")
	}
}

func TestCUTEHelpScrollsWithoutMovingOutput(t *testing.T) {
	m := testShell(t)
	m.emit(strings.Repeat("log entry\n", 100))
	m, _ = updateShell(m, shellKey(tea.KeyPgUp, 0))
	offset := m.view.YOffset()
	m.input.SetValue(":help")
	m, _ = updateShell(m, shellKey(tea.KeyEnter, 0))
	if !m.helpVisible {
		t.Fatal(":help must show the same keymap as F1")
	}
	m, _ = updateShell(m, shellKey(tea.KeyPgDown, 0))
	if m.helpOffset == 0 || m.view.YOffset() != offset {
		t.Fatal("help paging should not change the command log position")
	}
	m, _ = updateShell(m, shellKey(tea.KeyEsc, 0))
	if m.helpVisible || m.view.YOffset() != offset {
		t.Fatal("closing help must restore the log's reading position")
	}
}

func TestCUTEScrollbackRotationPreservesVisibleLine(t *testing.T) {
	m := testShell(t)
	m.emit(strings.Repeat("line\n", 490))
	m.view.SetYOffset(100)
	m.emit(strings.Repeat("new\n", 20))
	if m.view.YOffset() >= 100 || !m.newOutput || len(m.lines) != 500 {
		t.Fatal("dropping old scrollback must adjust the reader offset and retain unread hint")
	}
	m, _ = updateShell(m, shellKey(tea.KeyEnd, tea.ModCtrl))
	if m.newOutput || !m.view.AtBottom() {
		t.Fatal("jump to latest must resume following output")
	}
}
