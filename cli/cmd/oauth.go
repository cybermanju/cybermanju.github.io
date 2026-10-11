package cmd

import (
	"fmt"

	"github.com/charmbracelet/huh"
	"github.com/pkg/browser"
	"github.com/spf13/cobra"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/client"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

var oauthConfig string

var oauthCmd = &cobra.Command{
	Use:   "oauth",
	Short: "Provider OAuth (browser launch + verify)",
}

var oauthLaunchCmd = &cobra.Command{
	Use:   "launch <github|google|gitlab>",
	Short: "Open the provider approval, then verify the connection",
	Long: `Mints a PKCE authorize URL from the dashboard, opens your browser,
and verifies the stored credentials afterwards. The dashboard exchanges
the code itself and seals it (0600) — cyb never sees the secret.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := mustClient()
		if err := requireAuth(c); err != nil {
			return err
		}
		if oauthConfig == "" {
			return fmt.Errorf("a sync config is required: --config <id> (see `cyb sync configs`)")
		}
		provider, err := client.OAuthProvider(args[0])
		if err != nil {
			return err
		}
		got, serr := c.OAuthStart(provider, oauthConfig)
		if serr != nil {
			return serr
		}
		ui.Info("opening approval in your browser…")
		if berr := browser.OpenURL(got.AuthorizeURL); berr != nil {
			ui.Info("could not open a browser — visit:\n%s", got.AuthorizeURL)
		}
		var done bool
		form := ui.NewForm(huh.NewGroup(
			huh.NewConfirm().
				Title("Approve at the provider, then confirm here").
				Value(&done),
		))
		if err := form.Run(); err != nil {
			return err
		}
		if !done {
			return fmt.Errorf("aborted — no credentials stored")
		}
		cfgs, cerr := c.SyncConfigs()
		if cerr != nil {
			return cerr
		}
		for _, g := range cfgs {
			if g.ID != oauthConfig {
				continue
			}
			out, terr := c.SyncTest(g)
			if terr != nil {
				return fmt.Errorf("approval done but verification failed: %w", terr)
			}
			if out.OK || out.Message == "" {
				ui.Success("provider connected and verified")
				return nil
			}
			return fmt.Errorf("verification said: %s", out.Message)
		}
		return fmt.Errorf("not_found: no sync config %q", oauthConfig)
	},
}

var oauthStatusCmd = &cobra.Command{
	Use:   "status <config-id>",
	Short: "Probe a provider connection",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := mustClient()
		if err := requireAuth(c); err != nil {
			return err
		}
		cfgs, err := c.SyncConfigs()
		if err != nil {
			return err
		}
		for _, g := range cfgs {
			if g.ID != args[0] {
				continue
			}
			out, terr := c.SyncTest(g)
			if terr != nil {
				return terr
			}
			if out.OK || out.Message == "" {
				ui.Success("provider %s reachable", args[0])
				return nil
			}
			return fmt.Errorf("provider %s: %s", args[0], out.Message)
		}
		return fmt.Errorf("not_found: no sync config %q", args[0])
	},
}

func init() {
	oauthLaunchCmd.Flags().StringVar(&oauthConfig, "config", "", "sync config id to connect (required)")
	oauthCmd.AddCommand(oauthLaunchCmd, oauthStatusCmd)
	rootCmd.AddCommand(oauthCmd)
}
