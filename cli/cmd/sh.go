// CyberManju OS — Sh (cli/cmd/sh.go).
// Role: cybsh CLI command.
// Exports: replModel, Init, Update, View.
// Integrates: bufio, fmt, os, strings, github.com, golang.org.
// Contracts: none special (pure logic; errors bubble to caller).
package cmd

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

var (
	shDry  bool
	shLint bool
	shFmt  bool
	// shRaw keeps the historical join-with-spaces behavior untouched. By
	// default each argument containing whitespace is quoted (review
	// P1-CLI-1): `cyb sh disk cat "my file.txt"` used to re-tokenize into
	// `cat my file` — four silent tokens.
	shRaw bool
)

var shCmd = &cobra.Command{
	Use:   "sh <cybsh line...>",
	Short: "Run one cybsh line on the dashboard (same shell everywhere)",
	Long: `Examples:
  cyb sh "disk list"  |  cyb sh "sync move <file> <a> <b>"  |  cyb sh "ai ask \"hi\""

With one argument the whole string is the cybsh line (pipes, &&, ||, ;).
With several arguments, any argument containing whitespace is quoted, so
  cyb sh disk cat "my file.txt"  →  disk cat "my file.txt"
Pass --raw to join arguments verbatim instead.
Full verb list: cyb sh "help" · 3D wiki https://cybermanju.github.io/wiki/`,
	Args: cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := mustClient()
		if err := requireAuth(c); err != nil {
			return err
		}
		line := joinShLine(args)
		if flagJSON {
			raw, err := c.Raw("POST", "/api/os/exec", map[string]any{"line": line})
			if err != nil {
				return err
			}
			return ui.PrintJSON(raw)
		}
		res, err := c.Exec(line)
		if err != nil {
			return err
		}
		if res.Output != "" {
			fmt.Println(res.Output)
		}
		if !res.OK {
			msg := res.Error
			if msg == "" {
				msg = "shell error"
			}
			return fmt.Errorf("%s", msg)
		}
		return nil
	},
}

var runCmd = &cobra.Command{
	Use:   "run <file.cybsh> [-- args...]",
	Short: "Run a .cybsh script (dry/lint/fmt supported)",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := mustClient()
		if err := requireAuth(c); err != nil {
			return err
		}
		file := args[0]
		// Cobra removes `--` from args; ArgsLenAtDash retains its position.
		var argv []string
		if dash := cmd.ArgsLenAtDash(); dash >= 1 {
			argv = args[dash:]
		} else if len(args) > 1 {
			return fmt.Errorf("script arguments must follow --")
		}
		line := "run " + quoteArg(file)
		if shDry {
			line += " --dry"
		}
		if shLint {
			line += " --lint"
		}
		if shFmt {
			line += " --fmt"
		}
		if flagJSON {
			line += " --json"
		}
		if len(argv) > 0 {
			quoted := make([]string, len(argv))
			for i, a := range argv {
				quoted[i] = quoteArg(a)
			}
			line += " -- " + strings.Join(quoted, " ")
		}
		if flagJSON {
			raw, err := c.Raw("POST", "/api/os/exec", map[string]any{"line": line})
			if err != nil {
				return err
			}
			return ui.PrintJSON(raw)
		}
		res, err := c.Exec(line)
		if err != nil {
			return err
		}
		if res.Output != "" {
			fmt.Println(res.Output)
		}
		if !res.OK {
			msg := res.Error
			if msg == "" {
				msg = "script failed"
			}
			return fmt.Errorf("%s", msg)
		}
		return nil
	},
}

// quoteArg quotes one cybsh token, including operator and backslash literals.
func quoteArg(s string) string {
	return "\"" + strings.NewReplacer("\\", "\\\\", "\"", "\\\"").Replace(s) + "\""
}

// needsQuote reports whether a joined argument would re-tokenize: any
// cybsh tokenizer boundary (whitespace, quote or comment introducer) means
// the server would split one caller argument into several tokens.
func needsQuote(s string) bool {
	return strings.ContainsAny(s, " \t\"#\\")
}

// joinShLine turns sh arguments into one cybsh line. With --raw, plain
// concatenation (historical behavior). Otherwise a single argument stays
// verbatim (the dominant `cyb sh "disk list"` song) but in the multi-word
// form each whitespace-bearing argument is quoted so the server sees the
// same tokens the caller typed.
func joinShLine(args []string) string {
	if shRaw {
		return strings.Join(args, " ")
	}
	quoted := make([]string, len(args))
	for i, a := range args {
		if i >= 1 && needsQuote(a) {
			a = quoteArg(a)
		}
		quoted[i] = a
	}
	return strings.Join(quoted, " ")
}

func init() {
	runCmd.Flags().BoolVar(&shDry, "dry", false, "parse and budget without executing")
	runCmd.Flags().BoolVar(&shLint, "lint", false, "lint only")
	runCmd.Flags().BoolVar(&shFmt, "fmt", false, "print the formatted script")
	shCmd.Flags().BoolVar(&shRaw, "raw", false, "join arguments with spaces, no quoting")
	rootCmd.AddCommand(shCmd, runCmd, replCmd)
}
