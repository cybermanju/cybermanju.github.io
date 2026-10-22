// CyberManju OS — Help alias tests (cli/cmd/help_alias_test.go).
// Role: make alternate command names discoverable from parent help pages.
// Exports: TestCommandHelpSummary, TestRootHelpShowsShellAliases, TestParentHelpShowsVisibleAliases.
// Integrates: Cobra fixtures, ANSI display widths, styled help renderer.
// Contracts: aliases enrich descriptions without exposing hidden or deprecated commands.
package cmd

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/spf13/cobra"
)

func TestCommandHelpSummary(t *testing.T) {
	c := &cobra.Command{Use: "demo", Short: "A short description"}
	if got := commandHelpSummary(c); got != c.Short {
		t.Fatalf("description without aliases changed: %q", got)
	}
	c.Aliases = []string{"alternate", "shortcut"}
	want := "A short description (aliases: alternate, shortcut)"
	if got := commandHelpSummary(c); got != want {
		t.Fatalf("summary = %q, want %q", got, want)
	}
	for _, width := range []int{24, 40, 80} {
		out := formatHelpRow(c.Name(), commandHelpSummary(c), 12, width)
		for _, line := range strings.Split(out, "\n") {
			if n := ansi.StringWidth(line); n > width {
				t.Fatalf("alias row exceeds %d columns: %q", width, line)
			}
		}
		compact := strings.Join(strings.Fields(ansi.Strip(out)), "")
		if compact != strings.Join(strings.Fields(c.Name()+" "+want), "") {
			t.Fatalf("alias row lost text at width %d: %q", width, out)
		}
	}
}

func TestRootHelpShowsShellAliases(t *testing.T) {
	out := captureStdout(t, func() { renderRootHelp(rootCmd, nil) })
	plain := strings.Join(strings.Fields(ansi.Strip(out)), " ")
	if !strings.Contains(plain, "aliases: cute, cybsh") {
		t.Fatalf("root help must expose the interactive shell aliases: %s", plain)
	}
}

func TestParentHelpShowsVisibleAliases(t *testing.T) {
	parent := &cobra.Command{Use: "demo", Short: "Offline alias fixture"}
	parent.AddCommand(
		&cobra.Command{Use: "visible", Short: "Visible command", Aliases: []string{"alternate", "shortcut"}, Run: func(*cobra.Command, []string) {}},
		&cobra.Command{Use: "hidden-command", Short: "Hidden command", Aliases: []string{"hidden-alias"}, Hidden: true, Run: func(*cobra.Command, []string) {}},
		&cobra.Command{Use: "old-command", Short: "Old command", Aliases: []string{"old-alias"}, Deprecated: "use visible", Run: func(*cobra.Command, []string) {}},
	)
	out := captureStdout(t, func() { renderCmdHelp(parent) })
	plain := strings.Join(strings.Fields(ansi.Strip(out)), " ")
	for _, want := range []string{"visible", "Visible command", "aliases: alternate, shortcut"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("parent help lost %q: %s", want, plain)
		}
	}
	for _, hidden := range []string{"hidden-command", "hidden-alias", "old-command", "old-alias"} {
		if strings.Contains(plain, hidden) {
			t.Fatalf("parent help exposes %q: %s", hidden, plain)
		}
	}
}
