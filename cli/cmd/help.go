// CyberManju OS — Help (cli/cmd/help.go).
// Role: styled `cyb --help` — gradient masthead, grouped command atlas,
// and tinted flags, all in the CyberManju neon face.
// Exports: installHelp.
// Integrates: fmt, strings, cobra, pflag, ui.
// Contracts: root help is the neon atlas, subcommand help is a neon page;
// hidden, deprecated and unmapped commands fall into the "more" section
// (sorted) so new commands can never vanish from help.
package cmd

import (
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/x/ansi"
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
	{"self care", []string{"setup", "login", "logout", "doctor", "update", "version", "completion"}},
}

// installHelp swaps the root help renderer for the neon atlas.
func installHelp() {
	rootCmd.SetHelpFunc(renderRootHelp)
}

// renderRootHelp prints the masthead atlas for `cyb --help` and a styled
// per-command page for everything below the root.
func renderRootHelp(c *cobra.Command, _ []string) {
	applyOutputProfile()
	if c != rootCmd {
		renderCmdHelp(c)
		return
	}
	ui.Emit(ui.Splash(cliVersion))
	fmt.Println()
	fmt.Print(wrapHelpText("  "+ui.Downsample(ui.Dim.Render("files, disks, sync, OAuth, cybsh and the AI agent — one terminal.")), ui.TermWidth(), 0) + "\n")

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
			rows = append(rows, []string{sub.Name(), commandHelpSummary(sub)})
			shown[name] = true
		}
		if len(rows) == 0 {
			continue
		}
		fmt.Print(wrapHelpText("  "+ui.Downsample(ui.Title.Render("◈ "+sec.title)), ui.TermWidth(), 0) + "\n")
		for _, r := range rows {
			fmt.Print(formatHelpRow(ui.Downsample(ui.Accent.Render(r[0])),
				ui.Downsample(ui.Dim.Render(r[1])), nameWidth, ui.TermWidth()))
		}
		fmt.Println()
	}
	var rest [][]string
	for name, sub := range byName {
		if !shown[name] && name != "help" && name != "completion" {
			rest = append(rest, []string{name, commandHelpSummary(sub)})
		}
	}
	sort.Slice(rest, func(i, j int) bool { return rest[i][0] < rest[j][0] })
	if len(rest) > 0 {
		fmt.Print(wrapHelpText("  "+ui.Downsample(ui.Title.Render("◈ more")), ui.TermWidth(), 0) + "\n")
		for _, r := range rest {
			fmt.Print(formatHelpRow(ui.Downsample(ui.Accent.Render(r[0])),
				ui.Downsample(ui.Dim.Render(r[1])), nameWidth, ui.TermWidth()))
		}
		fmt.Println()
	}
	fmt.Print(formatHelpRow(ui.Downsample(ui.Title.Render("◈ flags")), ui.Downsample(ui.Dim.Render("cyb <command> [flags]")), 0, ui.TermWidth()))
	c.PersistentFlags().VisitAll(func(f *pflag.Flag) {
		name, usage := flagNameUsage(f)
		fmt.Print(formatHelpRow(ui.Downsample(ui.Chip(name)),
			ui.Downsample(ui.Dim.Render(usage)), 0, ui.TermWidth()))
	})
	fmt.Println()
	fmt.Print(formatHelpRow(ui.Downsample(ui.Dim.Render("Start here:")), ui.Downsample(ui.Chip("cyb setup")), 0, ui.TermWidth()))
	printHelpNavigation(c)
}

// renderCmdHelp prints a neon help page for any non-root command.
func renderCmdHelp(c *cobra.Command) {
	w := ui.TermWidth()
	fmt.Print(wrapHelpText(ui.Downsample(ui.Gradient("◈ "+c.CommandPath(), ui.PinkHot, ui.RedHot)), w, 0) + "\n")
	fmt.Print(wrapHelpText("  "+ui.Downsample(ui.Dim.Render(c.Short)), w, 0) + "\n\n")
	if c.Long != "" {
		fmt.Print(wrapHelpText("  "+ui.Downsample(ui.Dim.Render(strings.TrimSpace(c.Long))), w, 0) + "\n\n")
	}
	fmt.Print(formatHelpRow(ui.Downsample(ui.Title.Render("usage")), ui.Downsample(ui.Chip(c.UseLine())), 0, w) + "\n")
	if len(c.Aliases) > 0 {
		fmt.Print(formatHelpRow(ui.Downsample(ui.Title.Render("aliases")), ui.Downsample(ui.Dim.Render(strings.Join(c.Aliases, ", "))), 0, w) + "\n")
	}
	if c.HasAvailableSubCommands() {
		fmt.Print(wrapHelpText("  "+ui.Downsample(ui.Title.Render("◈ commands")), w, 0) + "\n")
		nameWidth := 0
		for _, sub := range c.Commands() {
			if !sub.Hidden && sub.Deprecated == "" {
				nameWidth = max(nameWidth, ansi.StringWidth(sub.Name()))
			}
		}
		for _, sub := range c.Commands() {
			if !sub.Hidden && sub.Deprecated == "" {
				fmt.Print(formatHelpRow(ui.Downsample(ui.Accent.Render(sub.Name())), ui.Downsample(ui.Dim.Render(commandHelpSummary(sub))), nameWidth, w))
			}
		}
		fmt.Println()
	}
	printFlagSet("flags", c.LocalFlags())
	printFlagSet("global flags", c.InheritedFlags())
	printHelpNavigation(c)
}

// printHelpNavigation shows the next help command only when a group has
// discoverable children, using its full path for nested command groups.
func printHelpNavigation(c *cobra.Command) {
	if !c.HasAvailableSubCommands() {
		return
	}
	fmt.Print(formatHelpRow(ui.Downsample(ui.Dim.Render("More help:")),
		ui.Downsample(ui.Chip(c.CommandPath()+" <command> --help")), 0, ui.TermWidth()))
}

// commandHelpSummary makes aliases discoverable from the parent command list,
// while retaining canonical names for the atlas grouping and column alignment.
func commandHelpSummary(c *cobra.Command) string {
	if len(c.Aliases) == 0 {
		return c.Short
	}
	return c.Short + " (aliases: " + strings.Join(c.Aliases, ", ") + ")"
}

// flagNameUsage renders one flag as --name/-s plus usage with its
// non-zero default appended, cobra-style.
func flagNameUsage(f *pflag.Flag) (string, string) {
	name := "--" + f.Name
	if f.Shorthand != "" {
		name += ", -" + f.Shorthand
	}
	usage := f.Usage
	if f.DefValue != "" && f.DefValue != "false" && f.DefValue != "0" {
		usage += " (default " + f.DefValue + ")"
	}
	return name, usage
}

// printFlagSet renders a titled flag list; empty sets print nothing.
// Non-zero defaults are shown, cobra-style.
func printFlagSet(title string, fs *pflag.FlagSet) {
	var rows [][2]string
	fs.VisitAll(func(f *pflag.Flag) {
		if f.Hidden {
			return
		}
		name, usage := flagNameUsage(f)
		rows = append(rows, [2]string{name, usage})
	})
	if len(rows) == 0 {
		return
	}
	fmt.Print(wrapHelpText("  "+ui.Downsample(ui.Title.Render("◈ "+title)), ui.TermWidth(), 0) + "\n")
	for _, r := range rows {
		fmt.Print(formatHelpRow(ui.Downsample(ui.Chip(r[0])),
			ui.Downsample(ui.Dim.Render(r[1])), 0, ui.TermWidth()))
	}
	fmt.Println()
}

// wrapHelpText hard-wraps styled help text at a display-column width.
func wrapHelpText(text string, width, indent int) string {
	width = max(1, min(width, 100))
	if width == 1 {
		plain := ansi.Strip(text)
		var b strings.Builder
		for _, r := range plain {
			if ansi.StringWidth(string(r)) > 1 {
				b.WriteRune('…')
			} else {
				b.WriteRune(r)
			}
		}
		text = b.String()
	}
	return ansi.Hardwrap(ansi.Wrap(text, width, ""), width, true)
}

// formatHelpRow wraps descriptions with aligned continuation lines.
func formatHelpRow(label, description string, labelWidth, width int) string {
	width = max(1, min(width, 100))
	labelWidth = max(labelWidth, ansi.StringWidth(label))
	indent := 4 + labelWidth + 2
	if width-indent < 24 {
		labelIndent := min(4, width-1)
		labelW := max(1, width-labelIndent)
		descIndent := min(6, width-1)
		labels := strings.Split(wrapHelpText(label, labelW, 0), "\n")
		for i := range labels {
			labels[i] = strings.Repeat(" ", labelIndent) + labels[i]
		}
		desc := strings.Split(wrapHelpText(description, max(1, width-descIndent), 0), "\n")
		for i := range desc {
			desc[i] = strings.Repeat(" ", descIndent) + desc[i]
		}
		return strings.Join(labels, "\n") + "\n" + strings.Join(desc, "\n") + "\n"
	}
	indent = min(indent, width-1)
	prefix := "    " + label + strings.Repeat(" ", max(0, labelWidth-ansi.StringWidth(label))) + "  "
	lines := strings.Split(wrapHelpText(description, max(1, width-indent), 0), "\n")
	for i := 1; i < len(lines); i++ {
		lines[i] = strings.Repeat(" ", indent) + lines[i]
	}
	return prefix + strings.Join(lines, "\n") + "\n"
}
