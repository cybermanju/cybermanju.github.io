package cmd

import (
	"fmt"

	"github.com/charmbracelet/huh"
	"github.com/spf13/cobra"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/client"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/config"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

var (
	setupUsername string
	setupPassword string
	setupDisplay  string
	setupLogin    bool
)

var setupCmd = &cobra.Command{
	Use:   "setup",
	Short: "End-to-end first setup: server, account, and next steps",
	Long: `Probe the dashboard, create or sign into the first account, and save
the profile (~/.config/cybermanju/cyb.json, 0600).

No server yet? Run:  cyb serve up   (Docker, one command)`,
	RunE: func(cmd *cobra.Command, args []string) error {
		f := profile()
		server := config.ResolveServer(flagServer, f)

		var username, password, display string
		nonInteractive := setupUsername != "" || setupLogin
		if nonInteractive {
			username, password, display = setupUsername, setupPassword, setupDisplay
			if username == "" || password == "" {
				return fmt.Errorf("non-interactive setup needs --username and --password")
			}
		} else {
			form := huh.NewForm(
				huh.NewGroup(
					huh.NewInput().
						Title("Dashboard URL").
						Value(&server).
						Validate(func(s string) error {
							if s == "" {
								return fmt.Errorf("a URL is required")
							}
							return nil
						}),
					huh.NewInput().Title("Username").Value(&username),
					huh.NewInput().Title("Password").EchoMode(huh.EchoModePassword).Value(&password),
					huh.NewInput().Title("Display name (register only, optional)").Value(&display),
				),
			).WithShowHelp(false)
			if err := form.Run(); err != nil {
				return err
			}
		}

		c := client.New(server, "", flagTimeout)
		var st client.AuthStatus
		if err := ui.SpinWhile("Probing dashboard…", func() error {
			var err error
			st, err = c.AuthStatus()
			return err
		}); err != nil {
			ui.Failure("no dashboard at %s", server)
			fmt.Printf("  Start one with:  cyb serve up\n  Or point elsewhere:  cyb setup --server URL\n  (%v)\n", err)
			return fmt.Errorf("setup aborted")
		}

		mode := "login"
		if st.RegistrationOpen && !setupLogin {
			mode = "register"
		}
		if mode == "register" {
			if err := c.Register(username, password, display, ""); err != nil {
				return err
			}
			ui.Success("account %q created", username)
		} else {
			ui.Info("registration closed — signing in")
		}
		var login client.LoginResp
		if err := ui.SpinWhile("Signing in…", func() error {
			var err error
			login, err = c.Login(username, password)
			return err
		}); err != nil {
			return err
		}
		if err := config.Save(config.File{Server: server, Token: login.Token}); err != nil {
			return err
		}
		ui.Success("signed in as %s (%s) — profile saved", login.Username, login.Role)
		fmt.Println()
		fmt.Println(ui.Panel.Render(
			"Next:  cyb oauth launch google --config <id>   connect a provider\n" +
				"       cyb disk create <config> 10G              encrypted vault disk\n" +
				"       cyb sh \"help\"                            the full cybsh verb list",
		))
		return nil
	},
}

func init() {
	setupCmd.Flags().StringVar(&setupUsername, "username", "", "non-interactive username")
	setupCmd.Flags().StringVar(&setupPassword, "password", "", "non-interactive password")
	setupCmd.Flags().StringVar(&setupDisplay, "display-name", "", "display name for registration")
	setupCmd.Flags().BoolVar(&setupLogin, "login", false, "force login even when registration is open")
	rootCmd.AddCommand(setupCmd)
}
