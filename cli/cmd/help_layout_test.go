// CyberManju OS — Help layout tests (cli/cmd/help_layout_test.go).
// Role: keep command and flag help readable on narrow terminals.
// Exports: TestHelpRowWidths, TestHelpRowLayout, TestCommandHelpWrapsFlags.
// Integrates: ANSI display widths, Cobra, styled help renderer.
// Contracts: descriptions wrap without truncation or losing colored/Unicode text.
package cmd

import (
	"fmt"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
	"github.com/spf13/cobra"
)

func TestHelpRowWidths(t *testing.T) {
	for _, width := range []int{8, 24, 40, 80} {
		for _, row := range []struct{ label, description string }{
			{"files", "Browse files and inspect metadata without truncating any description."},
			{"--server, -s", "dashboard URL https://example.invalid/a/very/long/path/without/spaces"},
			{"\x1b[35m同步\x1b[0m", "\x1b[36mSincronização de arquivos 日本語 com cores e caracteres largos.\x1b[0m"},
		} {
			t.Run(fmt.Sprintf("%d/%s", width, ansi.Strip(row.label)), func(t *testing.T) {
				got := formatHelpRow(row.label, row.description, 12, width)
				for _, line := range strings.Split(strings.TrimSuffix(got, "\n"), "\n") {
					if n := ansi.StringWidth(line); n > width {
						t.Fatalf("line has %d columns, limit %d: %q", n, width, line)
					}
				}
				compact := func(s string) string { return strings.Join(strings.Fields(ansi.Strip(s)), "") }
				if compact(got) != compact(row.label+" "+row.description) {
					t.Fatalf("help text was lost or changed: %q", got)
				}
			})
		}
	}
}

func TestHelpRowLayout(t *testing.T) {
	const description = "A description that must remain easy to scan on a phone terminal."
	narrow := formatHelpRow("files", description, 12, 32)
	if !strings.HasPrefix(narrow, "    files\n      ") {
		t.Fatalf("narrow help must stack its label and description: %q", narrow)
	}
	wide := formatHelpRow("files", description, 12, 80)
	prefix := "    files" + strings.Repeat(" ", 12-len("files")) + "  "
	if !strings.HasPrefix(wide, prefix) {
		t.Fatalf("wide help must retain aligned columns: %q", wide)
	}
}

func TestCommandHelpWrapsFlags(t *testing.T) {
	oldProfile := lipgloss.Writer.Profile
	lipgloss.Writer.Profile = colorprofile.Ascii
	t.Cleanup(func() { lipgloss.Writer.Profile = oldProfile })
	c := &cobra.Command{Use: "demo", Short: "Offline help layout fixture"}
	c.Flags().String("endpoint", "", strings.Repeat("dashboard connection details ", 8))
	out := captureStdout(t, func() { renderCmdHelp(c) })
	if !strings.Contains(out, "--endpoint") || !strings.Contains(out, "dashboard") {
		t.Fatalf("flag help is missing: %q", out)
	}
	for _, line := range strings.Split(out, "\n") {
		if n := ansi.StringWidth(line); n > 80 {
			t.Fatalf("piped flag help exceeds its 80-column fallback: %d columns", n)
		}
	}
}

func TestHelpRowsStayWithinRequestedWidth(t *testing.T) {
	cases := []struct{ label, description string }{
		{"a-long-flag-name", "longdescriptionwithoutspaces and CJK 界界界—text"},
		{"files", "A description that must remain easy to scan on a phone terminal."},
	}
	for width := 1; width <= 100; width++ {
		for _, tc := range cases {
			out := formatHelpRow(tc.label, tc.description, 40, width)
			for _, line := range strings.Split(out, "\n") {
				if got := ansi.StringWidth(line); got > width {
					t.Fatalf("width %d row line is %d columns: %q", width, got, line)
				}
			}
		}
	}
}

func TestHelpTextWrapsAllDisplayWidths(t *testing.T) {
	text := "◈ long-subcommand-path usage description 界界 alpha-beta-gamma-delta"
	for width := 1; width <= 100; width++ {
		for _, line := range strings.Split(wrapHelpText(text, width, 0), "\n") {
			if got := ansi.StringWidth(line); got > width {
				t.Fatalf("width %d text line is %d columns: %q", width, got, line)
			}
		}
	}
}
