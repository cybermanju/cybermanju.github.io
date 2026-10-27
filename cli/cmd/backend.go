// CyberManju OS — Backend (cli/cmd/backend.go).
// Role: `cyb backend` command — show the active backend and switch on command.
// Exports: backendCmd (status, select, use subcommands).
// Integrates: cobra, huh forms, client probes, profile config, Docker/PRoot runtime, ui.
// Contracts: status survives an unreachable dashboard (warning + switch hint, exit 0); every saved backend is reachable or the probe explains why.
package cmd

import (
	"fmt"
	"runtime"
	"strings"

	"charm.land/huh/v2"
	"github.com/spf13/cobra"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/client"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/config"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/supa"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

var (
	backendServer string
	backendPort   int
	backendURL    string
	backendKey    string
)

var backendCmd = &cobra.Command{
	Use:   "backend",
	Short: "Show or select the active backend",
	Long: `Backends:
  remote    dashboard URL (server flag / CYBERMANJU_SERVER / saved)
  docker    local OCI image (Docker Engine, or PRoot-Distro on Termux)
  native    installed CyberManju OS app (its localhost dashboard)
  CLI Limited (supabase)  broker-direct: read-only, no decrypt/encrypt`,
	RunE: func(cmd *cobra.Command, args []string) error {
		return backendStatusCmd.RunE(cmd, args)
	},
}

var backendStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show the active backend and probe it",
	RunE: func(cmd *cobra.Command, args []string) error {
		f := profile()
		t := f.Backend.TypeOrDefault()
		ui.Header("active backend: %s", backendLabel(t))
		ui.Hint("change backend: %s", ui.Chip("cyb backend use <remote|docker|native|supabase>"))
		switch t {
		case config.BackendSupabase:
			if f.Supa == nil || f.Supa.URL == "" {
				ui.Info("broker not configured — cyb backend use supabase --url URL --key KEY")
				return nil
			}
			ui.KV(
				[2]string{"broker", f.Supa.URL},
				[2]string{"session", supaSessionState(f)},
			)
		default:
			server := config.ResolveDashboard(flagServer, f)
			ui.KV([2]string{"server", server})
			c := client.New(server, "", flagTimeout)
			if _, err := c.AuthStatus(); err != nil {
				// A down dashboard must not break status: report it, keep the
				// exit code clean and hand the user the escape hatch.
				ui.Warning("unreachable: %v", err)
				ui.Hint("stuck here? switch: %s — or start the dashboard: %s", ui.Chip("cyb backend use docker"), ui.Chip("cyb serve"))
				return nil
			}
			ui.Success("dashboard answers")
		}
		return nil
	},
}

var backendSelectCmd = &cobra.Command{
	Use:   "select",
	Short: "Interactively choose a backend",
	RunE: func(cmd *cobra.Command, args []string) error {
		f := profile()
		if !canInteract() {
			return fmt.Errorf("cyb backend select needs an interactive terminal; use `cyb backend use <backend>` instead")
		}
		selected := setupTargetForBackend(f.Backend.Type)
		targets := setupTargetChoices(runtime.GOOS)
		supported := false
		for _, target := range targets {
			if target == selected {
				supported = true
				break
			}
		}
		if !supported && len(targets) > 0 {
			selected = targets[0]
		}
		options := make([]huh.Option[setupTarget], 0, len(targets))
		for _, target := range targets {
			label := ""
			switch target {
			case setupTargetDashboard:
				label = "Remote dashboard"
			case setupTargetDocker:
				label = "Docker local image"
				if runtime.GOOS == "android" {
					label = "Docker image via Termux PRoot-Distro"
				}
			case setupTargetNative:
				label = "Native CyberManju OS app"
			case setupTargetLimited:
				label = "CLI Limited (Supabase, read-only)"
			}
			options = append(options, huh.NewOption(label, target))
		}
		form := ui.NewForm(huh.NewGroup(huh.NewSelect[setupTarget]().Title("Select backend").Options(options...).Value(&selected)))
		if err := form.Run(); err != nil {
			return err
		}
		if selected == setupTargetDashboard {
			server := f.Server
			if flagServer != "" {
				server = flagServer
			}
			serverForm := ui.NewForm(huh.NewGroup(huh.NewInput().Title("Remote dashboard URL").Value(&server).Validate(func(value string) error {
				if strings.TrimSpace(value) == "" {
					return fmt.Errorf("a dashboard URL is required")
				}
				return nil
			})))
			if err := serverForm.Run(); err != nil {
				return err
			}
			backendServer = strings.TrimSpace(server)
		}
		if err := backendUseCmd.RunE(cmd, []string{string(selected)}); err != nil {
			return err
		}
		return nil
	},
}

func backendLabel(backend string) string {
	if runtime.GOOS == "android" && backend == config.BackendDocker {
		return "Docker image (Termux PRoot-Distro)"
	}
	switch backend {
	case config.BackendDocker:
		return "Docker"
	case config.BackendNative:
		return "Native app"
	case config.BackendSupabase:
		return "CLI Limited (Supabase)"
	default:
		return "Remote dashboard"
	}
}

func supaSessionState(f config.File) string {
	if f.Supa == nil || f.Supa.AccessToken == "" {
		return "signed out — cyb supa login"
	}
	if f.Supa.Expired() {
		return "expired — cyb supa login (refresh on next status)"
	}
	who := f.Supa.Email
	if who == "" {
		who = f.Supa.UserID
	}
	return "signed in as " + who
}

var backendUseCmd = &cobra.Command{
	Use:   "use <remote|docker|native|supabase>",
	Short: "Select and configure a backend",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		f := profile()
		switch args[0] {
		case config.BackendRemote:
			f.Backend.Type = config.BackendRemote
			if backendServer != "" {
				f.Server = backendServer
			}
			if err := config.Save(f); err != nil {
				return err
			}
			ui.Success("backend → remote (%s)", config.ResolveDashboard("", f))
		case config.BackendDocker:
			port := backendPort
			if port == 0 {
				port = 3456
			}
			// Only bring the container up when its dashboard isn't already
			// answering; never rm -f a running dashboard on re-select.
			if !localDashboardUp(port) {
				if err := ensureDockerUp(port, "", ""); err != nil {
					return err
				}
			}
			f.Backend.Type = config.BackendDocker
			f.Backend.DockerPort = port
			if err := config.Save(f); err != nil {
				return err
			}
			ui.Success("backend → docker (http://127.0.0.1:%d)", port)
		case config.BackendNative:
			port := backendPort
			if port == 0 {
				port = 3456
			}
			probe := client.New(fmt.Sprintf("http://127.0.0.1:%d", port), "", flagTimeout)
			if _, err := probe.AuthStatus(); err != nil {
				return fmt.Errorf("no CyberManju dashboard on 127.0.0.1:%d — is the native app (deb/appimage/dmg/apk) running? (%v)", port, err)
			}
			f.Backend.Type = config.BackendNative
			f.Backend.NativePort = port
			if err := config.Save(f); err != nil {
				return err
			}
			ui.Success("backend → native app (http://127.0.0.1:%d)", port)
		case config.BackendSupabase:
			brokerURL, brokerKey := backendURL, backendKey
			source := "paste"
			if brokerURL == "" || brokerKey == "" {
				if bURL, bKey, src := supa.BrokerPair("", ""); src == "baked into this build" {
					brokerURL, brokerKey, source = bURL, bKey, src
					ui.Info("using the broker baked into this build")
				} else {
					form := ui.NewForm(huh.NewGroup(
						huh.NewInput().Title("Supabase project URL").Value(&brokerURL),
						huh.NewInput().Title("Anon / publishable key").EchoMode(huh.EchoModePassword).Value(&brokerKey),
					))
					if err := form.Run(); err != nil {
						return err
					}
				}
			}
			if brokerURL == "" || brokerKey == "" {
				return fmt.Errorf("broker URL and key are required (same pair as Settings → OAuth broker)")
			}
			f.Backend.Type = config.BackendSupabase
			if f.Supa == nil {
				f.Supa = &config.SupaSession{}
			}
			f.Supa.URL = brokerURL
			f.Supa.Key = brokerKey
			if err := config.Save(f); err != nil {
				return err
			}
			ui.Success("backend → CLI Limited (Supabase direct, read-only; broker %s)", source)
			ui.Emit(ui.NextSteps("supabase allowlist",
				[2]string{"http://127.0.0.1:54329/callback", "allow under Authentication → URL Configuration → Redirect URLs"},
				[2]string{"cyb supa login", "sign in through the broker"},
			))
		default:
			return fmt.Errorf("unsupported: backend must be remote|docker|native|supabase (got %q)", args[0])
		}
		ui.Header("Backend selected: %s", backendLabel(args[0]))
		return nil
	},
}

func init() {
	backendUseCmd.Flags().StringVar(&backendServer, "server", "", "remote dashboard URL")
	backendUseCmd.Flags().IntVar(&backendPort, "port", 0, "loopback port (docker/native, default 3456)")
	backendUseCmd.Flags().StringVar(&backendURL, "url", "", "Supabase project URL")
	backendUseCmd.Flags().StringVar(&backendKey, "key", "", "Supabase anon key")
	backendCmd.AddCommand(backendStatusCmd, backendSelectCmd, backendUseCmd)
	rootCmd.AddCommand(backendCmd)
}
