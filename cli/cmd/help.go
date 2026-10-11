// CyberManju OS — Help (cli/cmd/help.go).
// Role: styled `cyb --help` — gradient masthead, grouped command atlas,
// and tinted flags, all in the CyberManju neon face.
// Exports: installHelp.
// Integrates: fmt, strings, cobra, pflag, ui.
// Contracts: root help only — subcommand help stays cobra-default; hidden,
// deprecated and unmapped commands fall into the "more" section so new
// commands can never vanish from help.
package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

// helpSections buckets top-level commands into the neon atlas.
var helpSections = []struct {
	title string
	cmds  []string
}{
	{"vault", []string{"files", "batch", "code", "crypto"}},
	{"devices & sync", []string{"disk", "sync", "share", "audit", "repair", "scrub", "lease", "cron"}},
	{"shell everywhere", []string{"sh", "run", "repl"}},
	{"intelligence", []string{"ai", "search", "suggest", "geo"}},
	{"people & secrets", []string{"users", "perms", "collections", "accounts", "groups", "loose", "faces", "secrets", "oauth"}},
	{"machine", []string{"backend", "supa", "serve", "config"}},
	{"self care", []string{"setup", "login", "logout", "doctor", "update", "version"}},
}

// installHelp swaps the root help renderer for the neon atlas.
func installHelp() {
	rootCmd.SetHelpFunc(renderRootHelp)
}

// renderRootHelp prints the masthead atlas for `cyb --help` and a styled
// per-command page for everything below the root.
func renderRootHelp(c *cobra.Command, _ []string) {
	if c != rootCmd {
		renderCmdHelp(c)
		return
	}
	fmt.Println(ui.Splash(cliVersion))
	fmt.Println()
	fmt.Printf("  %s\n\n", ui.Dim.Render("files, disks, sync, OAuth, cybsh and the AI agent — one terminal."))

	byName := map[string]*cobra.Command{}
	for _, sub := range c.Commands() {
		if sub.Hidden || sub.Deprecated != "" {
			continue
		}
		byName[sub.Name()] = sub
	}
	shown := map[string]bool{}
	nameWidth := 0
	for _, sub := range byName {
		if w := len(sub.Name()); w > nameWidth {
			nameWidth = w
		}
	}
	for _, sec := range helpSections {
		var rows [][]string
		for _, name := range sec.cmds {
			sub, ok := byName[name]
			if !ok {
				continue
			}
			rows = append(rows, []string{sub.Name(), sub.Short})
			shown[name] = true
		}
		if len(rows) == 0 {
			continue
		}
		fmt.Printf("  %s\n", ui.Title.Render("◈ "+sec.title))
		for _, r := range rows {
			fmt.Printf("    %s  %s\n",
				ui.Accent.Render(r[0]+strings.Repeat(" ", max(0, nameWidth-len(r[0])))),
				ui.Dim.Render(r[1]))
		}
		fmt.Println()
	}
	var rest [][]string
	for name, sub := range byName {
		if !shown[name] && name != "help" && name != "completion" {
			rest = append(rest, []string{name, sub.Short})
		}
	}
	if len(rest) > 0 {
		fmt.Printf("  %s\n", ui.Title.Render("◈ more"))
		for _, r := range rest {
			fmt.Printf("    %s  %s\n",
				ui.Accent.Render(r[0]+strings.Repeat(" ", max(0, nameWidth-len(r[0])))),
				ui.Dim.Render(r[1]))
		}
		fmt.Println()
	}
	fmt.Printf("  %s  %s\n", ui.Title.Render("◈ flags"), ui.Dim.Render("cyb <command> [flags]"))
	c.PersistentFlags().VisitAll(func(f *pflag.Flag) {
		name := "--" + f.Name
		if f.Shorthand != "" {
			name += ", -" + f.Shorthand
		}
		fmt.Printf("    %s  %s\n", ui.Chip(name), ui.Dim.Render(f.Usage))
	})
	fmt.Println()
	fmt.Printf("  %s  %s\n", ui.Dim.Render("Start here:"), ui.Chip("cyb setup"))
}

// renderCmdHelp prints a neon help page for any non-root command.
func renderCmdHelp(c *cobra.Command) {
	fmt.Printf("%s  %s\n\n",
		ui.Gradient("◈ "+c.CommandPath(), ui.PinkHot, ui.RedHot),
		ui.Dim.Render(c.Short))
	if c.Long != "" {
		fmt.Printf("  %s\n\n", ui.Dim.Render(strings.TrimSpace(c.Long)))
	}
	fmt.Printf("  %s  %s\n\n", ui.Title.Render("usage"), ui.Chip(c.UseLine()))
	if len(c.Aliases) > 0 {
		fmt.Printf("  %s  %s\n\n", ui.Title.Render("aliases"), ui.Dim.Render(strings.Join(c.Aliases, ", ")))
	}
	if c.HasAvailableSubCommands() {
		fmt.Printf("  %s\n", ui.Title.Render("◈ commands"))
		w := 0
		for _, sub := range c.Commands() {
			if sub.Hidden || sub.Deprecated != "" {
				continue
			}
			if n := len(sub.Name()); n > w {
				w = n
			}
		}
		for _, sub := range c.Commands() {
			if sub.Hidden || sub.Deprecated != "" {
				continue
			}
			fmt.Printf("    %s  %s\n",
				ui.Accent.Render(sub.Name()+strings.Repeat(" ", max(0, w-len(sub.Name())))),
				ui.Dim.Render(sub.Short))
		}
		fmt.Println()
	}
	printFlagSet("flags", c.LocalFlags())
	printFlagSet("global flags", c.InheritedFlags())
}

// printFlagSet renders a titled flag list; empty sets print nothing.
func printFlagSet(title string, fs *pflag.FlagSet) {
	var rows [][2]string
	fs.VisitAll(func(f *pflag.Flag) {
		if f.Hidden {
			return
		}
		name := "--" + f.Name
		if f.Shorthand != "" {
			name += ", -" + f.Shorthand
		}
		rows = append(rows, [2]string{name, f.Usage})
	})
	if len(rows) == 0 {
		return
	}
	fmt.Printf("  %s\n", ui.Title.Render("◈ "+title))
	for _, r := range rows {
		fmt.Printf("    %s  %s\n", ui.Chip(r[0]), ui.Dim.Render(r[1]))
	}
	fmt.Println()
}
