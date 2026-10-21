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
)

var shCmd = &cobra.Command{
	Use:   "sh <cybsh line...>",
	Short: "Run one cybsh line on the dashboard (same shell everywhere)",
	Long: `Examples:
  cyb sh "disk list"  |  cyb sh "sync move <file> <a> <b>"  |  cyb sh "ai ask \"hi\""
Full verb list: cyb sh "help" · 3D wiki https://cybermanju.github.io/wiki/`,
	Args: cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := mustClient()
		if err := requireAuth(c); err != nil {
			return err
		}
		line := strings.Join(args, " ")
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

func init() {
	runCmd.Flags().BoolVar(&shDry, "dry", false, "parse and budget without executing")
	runCmd.Flags().BoolVar(&shLint, "lint", false, "lint only")
	runCmd.Flags().BoolVar(&shFmt, "fmt", false, "print the formatted script")
	rootCmd.AddCommand(shCmd, runCmd, replCmd)
}
