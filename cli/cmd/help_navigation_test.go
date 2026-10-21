// CyberManju OS — Help navigation tests (cli/cmd/help_navigation_test.go).
// Role: guide users from command-group help to the next detailed help page.
// Exports: TestRootHelpNavigation, TestNestedHelpNavigation, TestHelpNavigationRequiresAvailableChildren.
// Integrates: Cobra fixtures, styled help renderer, ANSI stripping.
// Contracts: show full command paths, but never suggest children of leaf or hidden-only groups.
package cmd

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/spf13/cobra"
)

func TestRootHelpNavigation(t *testing.T) {
	out := captureStdout(t, func() { renderRootHelp(rootCmd, nil) })
	plain := strings.Join(strings.Fields(ansi.Strip(out)), " ")
	// Chips may include backticks in plain output; assert content, not decoration.
	if !strings.Contains(plain, "More help:") || !strings.Contains(plain, "cyb <command> --help") {
		t.Fatalf("root help must explain how to open command help: %s", plain)
	}
}

func TestNestedHelpNavigation(t *testing.T) {
	root := &cobra.Command{Use: "demo"}
	parent := &cobra.Command{Use: "vault"}
	group := &cobra.Command{Use: "files", Short: "Nested group fixture"}
	group.AddCommand(&cobra.Command{Use: "list", Run: func(*cobra.Command, []string) {}})
	parent.AddCommand(group)
	root.AddCommand(parent)
	out := captureStdout(t, func() { renderCmdHelp(group) })
	plain := strings.Join(strings.Fields(ansi.Strip(out)), " ")
	if !strings.Contains(plain, "More help:") || !strings.Contains(plain, "demo vault files <command> --help") {
		t.Fatalf("nested help must use the complete command path: %s", plain)
	}
}

func TestHelpNavigationRequiresAvailableChildren(t *testing.T) {
	for _, tc := range []struct {
		name  string
		child *cobra.Command
	}{
		{name: "leaf"},
		{name: "hidden only", child: &cobra.Command{Use: "hidden", Hidden: true, Run: func(*cobra.Command, []string) {}}},
		{name: "deprecated only", child: &cobra.Command{Use: "old", Deprecated: "use another command", Run: func(*cobra.Command, []string) {}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &cobra.Command{Use: "demo", Short: "Navigation fixture"}
			if tc.child != nil {
				c.AddCommand(tc.child)
			}
			out := captureStdout(t, func() { renderCmdHelp(c) })
			if strings.Contains(ansi.Strip(out), "More help:") {
				t.Fatalf("help must not suggest unavailable subcommands: %q", out)
			}
		})
	}
}
