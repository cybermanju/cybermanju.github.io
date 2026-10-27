// CyberManju OS — Setup (cli/cmd/setup.go).
// Role: cybsh command for repeatable backend selection and account setup.
// Exports: module root (see items below).
// Integrates: fmt, os, runtime, strings, huh, client, config, supa, ui, Docker/PRoot runtime, term.
// Contracts: persist the selected backend with its matching server and account session.
//   - interactive forms require a terminal on stdin; non-TTY runs must fail
//     fast (huh would hang and leak terminal capability queries as text).
//   - `cyb setup --server URL` skips the backend menu: a loopback URL matching
//     the saved docker/native backend stays on that backend, others go remote.
//
// Contracts: persist the selected backend with its matching server and account session.
package cmd

import (
	"fmt"
	"os"
	"runtime"
	"strings"

	"charm.land/huh/v2"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/client"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/config"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/supa"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

type setupTarget string

const (
	setupTargetDashboard setupTarget = "remote"
	setupTargetDocker    setupTarget = "docker"
	setupTargetNative    setupTarget = "native"
	setupTargetLimited   setupTarget = "supabase"
)

var (
	setupUsername string
	setupPassword string
	setupDisplay  string
	setupLogin    bool
)

var setupCmd = &cobra.Command{
	Use:   "setup",
	Short: "Choose a backend, connect a dashboard, and save your profile",
	Long: `Choose a backend each time setup runs: remote dashboard, Docker, native
app, or CLI Limited (Supabase; platform-dependent). Dashboard setup probes the
API, then creates or signs into an account and saves the profile
(~/.config/cybermanju/cyb.json, 0600).

No local server yet? On a desktop, run:  cyb serve up`,
	RunE: func(cmd *cobra.Command, args []string) error {
		f := profile()
		nonInteractive := setupUsername != "" || setupLogin
		if !nonInteractive {
			ui.Emit(ui.Splash(cliVersion))
			fmt.Println()
		}

		target := setupTargetDashboard
		if !nonInteractive {
			if !canInteract() {
				return fmt.Errorf("cyb setup needs an interactive terminal; use --username/--password for non-interactive setup, or run `cyb backend use <backend>` outside a terminal")
			}
			var err error
			if srv := strings.TrimSpace(flagServer); srv != "" {
				target = setupTargetForExplicitServer(srv, f)
			} else {
				target, err = chooseSetupTarget(runtime.GOOS, f)
			}
			if err != nil {
				return err
			}
		} else {
			target = setupTargetForBackend(f.Backend.Type)
			if srv := strings.TrimSpace(flagServer); srv != "" {
				target = setupTargetForExplicitServer(srv, f)
			}
		}
		if target == setupTargetLimited {
			return setupLimitedBackend(f)
		}
		switch target {
		case setupTargetDocker:
			f.Backend.Type = config.BackendDocker
		case setupTargetNative:
			f.Backend.Type = config.BackendNative
		default:
			f.Backend.Type = config.BackendRemote
		}
		server := ""
		if target == setupTargetDocker {
			port := f.Backend.DockerPort
			if port == 0 {
				port = 3456
			}
			server = fmt.Sprintf("http://127.0.0.1:%d", port)
			// A dashboard already answering is left running; restart only
			// when the loopback API is down (idempotent, no rm -f of a
			// container that was just brought up by `cyb serve up`).
			if !localDashboardUp(port) {
				if err := ensureDockerUp(port, "", ""); err != nil {
					return err
				}
			}
			f.Backend.DockerPort = port
		} else if target == setupTargetNative {
			port := f.Backend.NativePort
			if port == 0 {
				port = 3456
			}
			server = fmt.Sprintf("http://127.0.0.1:%d", port)
			probe := client.New(server, "", flagTimeout)
			if _, err := probe.AuthStatus(); err != nil {
				return fmt.Errorf("no CyberManju dashboard on 127.0.0.1:%d — is the native app running? (%v)", port, err)
			}
			f.Backend.NativePort = port
		}
		if target != setupTargetDocker && target != setupTargetNative {
			server = config.ResolveServer(flagServer, f)
		}
		// A Termux remote dashboard must be supplied explicitly; localhost is
		// not a useful default when Docker and the native app are unavailable.
		if runtime.GOOS == "android" && strings.TrimSpace(flagServer) == "" &&
			strings.TrimSpace(f.Server) == "" && strings.TrimSpace(os.Getenv("CYBERMANJU_SERVER")) == "" {
			server = ""
		}

		var username, password, display string
		if nonInteractive {
			username, password, display = setupUsername, setupPassword, setupDisplay
			if username == "" || password == "" {
				return fmt.Errorf("non-interactive setup needs --username and --password")
			}
		} else {
			fields := make([]huh.Field, 0, 4)
			if target != setupTargetDocker && target != setupTargetNative {
				fields = append(fields, huh.NewInput().Title("Dashboard URL").Value(&server).Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("a dashboard URL is required")
					}
					return nil
				}))
			}
			fields = append(fields,
				huh.NewInput().Title("Username").Value(&username),
				huh.NewInput().Title("Password").EchoMode(huh.EchoModePassword).Value(&password),
				huh.NewInput().Title("Display name (register only, optional)").Value(&display),
			)
			form := ui.NewForm(
				huh.NewGroup(fields...),
			)
			if err := form.Run(); err != nil {
				return err
			}
		}

		c := client.New(server, "", flagTimeout)
		var st client.AuthStatus
		if err := ui.SpinWhile("Checking dashboard API…", func() error {
			var err error
			st, err = c.AuthStatus()
			return err
		}); err != nil {
			ui.Failure("no dashboard at %s", server)
			ui.Hint("start one with %s", ui.Chip("cyb serve up"))
			ui.Hint("or point elsewhere with %s", ui.Chip("cyb setup --server URL"))
			ui.Hint("if this is a Supabase project URL, rerun setup and choose CLI Limited")
			ui.Hint("(%v)", err)
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
		f.Server = server
		f.Token = login.Token
		switch target {
		case setupTargetDocker:
			f.Backend.Type = config.BackendDocker
		case setupTargetNative:
			f.Backend.Type = config.BackendNative
		default:
			f.Backend.Type = config.BackendRemote
		}
		f = f.WithExpiry(login.ExpiresIn)
		if err := config.Save(f); err != nil {
			return err
		}
		ui.Success("signed in as %s (%s) — profile saved", login.Username, login.Role)
		fmt.Println()
		ui.Header("Backend selected: %s", backendLabel(string(target)))
		ui.Header("Setup complete")
		ui.KV(
			[2]string{"backend", backendLabel(string(target))},
			[2]string{"dashboard", server},
			[2]string{"account", login.Username},
			[2]string{"role", login.Role},
		)
		fmt.Println()
		ui.Emit(ui.NextSteps("next",
			[2]string{"cyb oauth launch google --config <id>", "connect a provider"},
			[2]string{"cyb disk create <config> 10G", "encrypted vault disk"},
			[2]string{`cyb sh "help"`, "the full cybsh verb list"},
		))
		return nil
	},
}

func setupTargetChoices(goos string) []setupTarget {
	if goos != "android" {
		return []setupTarget{setupTargetDashboard, setupTargetDocker, setupTargetNative, setupTargetLimited}
	}
	return []setupTarget{setupTargetDashboard, setupTargetDocker, setupTargetLimited}
}

func setupTargetForBackend(backend string) setupTarget {
	switch backend {
	case config.BackendDocker:
		return setupTargetDocker
	case config.BackendNative:
		return setupTargetNative
	case config.BackendSupabase:
		return setupTargetLimited
	default:
		return setupTargetDashboard
	}
}

func chooseSetupTarget(goos string, f config.File) (setupTarget, error) {
	target := setupTargetForBackend(f.Backend.Type)
	options := make([]huh.Option[setupTarget], 0, 2)
	for _, choice := range setupTargetChoices(goos) {
		switch choice {
		case setupTargetDashboard:
			options = append(options, huh.NewOption("Remote dashboard — full CLI", choice))
		case setupTargetDocker:
			label := "Docker — local dashboard container"
			if goos == "android" {
				label = "Docker image — Termux PRoot-Distro (no Docker daemon)"
			}
			options = append(options, huh.NewOption(label, choice))
		case setupTargetNative:
			options = append(options, huh.NewOption("Native app — local dashboard", choice))
		case setupTargetLimited:
			options = append(options, huh.NewOption("CLI Limited — Supabase direct, read-only", choice))
		}
	}
	form := ui.NewForm(huh.NewGroup(
		huh.NewSelect[setupTarget]().
			Title("Choose a backend").
			Options(options...).
			Value(&target),
	))
	if err := form.Run(); err != nil {
		return "", err
	}
	return target, nil
}

// canInteract reports whether stdin is a terminal. Without one, huh forms
// hang and bubbletea's terminal capability query responses arrive as
// literal escape text (e.g. `^[[?2026;2$y^[[?2027;0$y`) instead of UI.
func canInteract() bool {
	return term.IsTerminal(int(os.Stdin.Fd()))
}

// setupTargetForExplicitServer maps an explicit `--server` URL onto the
// right target without re-showing the backend menu: a loopback URL that
// matches the saved docker/native backend's dashboard port keeps that
// backend (so `cyb serve up` + `cyb setup --server …` stays docker),
// anything else is the remote-dashboard flow.
func setupTargetForExplicitServer(server string, f config.File) setupTarget {
	local := f.Backend.TypeOrDefault()
	if local == config.BackendDocker || local == config.BackendNative {
		localURL := fmt.Sprintf("http://127.0.0.1:%d", f.Backend.DashboardPort())
		if server == localURL {
			return setupTargetForBackend(local)
		}
	}
	return setupTargetDashboard
}

func setupLimitedBackend(f config.File) error {
	brokerURL, brokerKey, source := "", "", ""
	if f.Supa != nil && f.Supa.URL != "" && f.Supa.Key != "" {
		brokerURL, brokerKey, source = f.Supa.URL, f.Supa.Key, "saved profile"
	} else if url, key, src := supa.BrokerPair("", ""); src == "baked into this build" {
		brokerURL, brokerKey, source = url, key, src
		ui.Info("using the broker baked into this CLI build")
	}
	if brokerURL == "" || brokerKey == "" {
		form := ui.NewForm(huh.NewGroup(
			huh.NewInput().Title("Supabase project URL").Value(&brokerURL),
			huh.NewInput().Title("Anon / publishable key").EchoMode(huh.EchoModePassword).Value(&brokerKey),
		))
		if err := form.Run(); err != nil {
			return err
		}
		if source == "" {
			source = "entered during setup"
		}
	}

	updated, err := withSupabaseBackend(f, brokerURL, brokerKey)
	if err != nil {
		return err
	}
	if err := config.Save(updated); err != nil {
		return err
	}
	ui.Success("setup complete — CLI Limited (Supabase direct, read-only; broker %s)", source)
	ui.Header("Backend selected: %s", backendLabel(string(setupTargetLimited)))
	ui.Emit(ui.NextSteps("Supabase allowlist",
		[2]string{"http://127.0.0.1:54329/callback", "allow under Authentication → URL Configuration → Redirect URLs"},
		[2]string{"cyb supa login", "sign in through the broker"},
	))
	return nil
}

func withSupabaseBackend(f config.File, brokerURL, brokerKey string) (config.File, error) {
	brokerURL = strings.TrimSpace(brokerURL)
	brokerKey = strings.TrimSpace(brokerKey)
	if brokerURL == "" || brokerKey == "" {
		return f, fmt.Errorf("Supabase project URL and anon key are required")
	}
	f.Backend.Type = config.BackendSupabase
	if f.Supa == nil {
		f.Supa = &config.SupaSession{}
	}
	f.Supa.URL = brokerURL
	f.Supa.Key = brokerKey
	return f, nil
}

func init() {
	setupCmd.Flags().StringVar(&setupUsername, "username", "", "non-interactive username")
	setupCmd.Flags().StringVar(&setupPassword, "password", "", "non-interactive password")
	setupCmd.Flags().StringVar(&setupDisplay, "display-name", "", "display name for registration")
	setupCmd.Flags().BoolVar(&setupLogin, "login", false, "force login even when registration is open")
	rootCmd.AddCommand(setupCmd)
}
