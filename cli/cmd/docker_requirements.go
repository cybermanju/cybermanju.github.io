// CyberManju OS — Docker requirements (cli/cmd/docker_requirements.go).
// Role: identify native Docker prerequisites and run the OCI server through Termux PRoot-Distro.
// Exports: none.
// Integrates: os-release, package managers, sudo, PRoot-Distro, huh, ui.
// Contracts: package installation requires explicit confirmation; Termux server binds to loopback.
package cmd

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"charm.land/huh/v2"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
	"golang.org/x/term"
)

type dockerInstallPlan struct {
	manager string
	args    []string
	service []string
}

func detectDockerInstallPlan(goos, osRelease string, lookPath func(string) (string, error)) (dockerInstallPlan, error) {
	if goos != "linux" {
		return dockerInstallPlan{}, fmt.Errorf("Docker is not installed. In-app installation is available on supported Linux distributions; install Docker Desktop manually on %s", goos)
	}
	ids := map[string]bool{}
	scanner := bufio.NewScanner(strings.NewReader(osRelease))
	for scanner.Scan() {
		key, value, ok := strings.Cut(scanner.Text(), "=")
		if !ok || key != "ID" && key != "ID_LIKE" {
			continue
		}
		value = strings.Trim(value, "\"'")
		for _, id := range strings.Fields(strings.ToLower(value)) {
			ids[id] = true
		}
	}
	if ids["termux"] {
		return dockerInstallPlan{}, fmt.Errorf("Termux uses the PRoot-Distro OCI runtime instead of installing Docker Engine")
	}
	for _, candidate := range []struct {
		bin     string
		args    []string
		service []string
	}{
		{"apt-get", []string{"install", "-y", "docker.io"}, []string{"systemctl", "enable", "--now", "docker"}},
		{"pacman", []string{"-S", "--needed", "--noconfirm", "docker"}, []string{"systemctl", "enable", "--now", "docker"}},
		{"dnf", []string{"install", "-y", "docker"}, []string{"systemctl", "enable", "--now", "docker"}},
		{"zypper", []string{"--non-interactive", "install", "docker"}, []string{"systemctl", "enable", "--now", "docker"}},
		{"apk", []string{"add", "docker"}, []string{"rc-update", "add", "docker", "default"}},
		{"xbps-install", []string{"-Sy", "docker"}, []string{"ln", "-s", "/etc/sv/docker", "/var/service/docker"}},
	} {
		if _, err := lookPath(candidate.bin); err == nil {
			return dockerInstallPlan{manager: candidate.bin, args: candidate.args, service: candidate.service}, nil
		}
	}
	return dockerInstallPlan{}, fmt.Errorf("Docker is missing and no supported package manager (apt-get, pacman, dnf, zypper, apk, xbps-install) was found; install Docker for your distribution, then rerun cyb serve up")
}

func installDockerWithConsent() error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf("docker not found — install Docker Desktop manually or point cyb at a dashboard with --server")
	}
	release, _ := os.ReadFile("/etc/os-release")
	plan, err := detectDockerInstallPlan(runtime.GOOS, string(release), exec.LookPath)
	if err != nil {
		return err
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return fmt.Errorf("docker not found; interactive permission is required to install it. Rerun cyb serve up in a terminal, or install Docker manually")
	}
	confirmed := false
	form := huh.NewForm(huh.NewGroup(huh.NewConfirm().Title("Docker is required for the local dashboard").Description("Install Docker using " + plan.manager + "? This requires administrator permission.").Affirmative("Install Docker").Negative("Cancel").Value(&confirmed)))
	if err := form.Run(); err != nil {
		return err
	}
	if !confirmed {
		return fmt.Errorf("Docker installation cancelled; choose a remote dashboard or install Docker before selecting the Docker backend")
	}
	if plan.manager == "apt-get" {
		if err := runPrivileged("apt-get", "update"); err != nil {
			return err
		}
	}
	if err := runPrivileged(plan.manager, plan.args...); err != nil {
		return err
	}
	if len(plan.service) > 0 {
		serviceManager := plan.service[0]
		if _, err := exec.LookPath(serviceManager); err == nil {
			if err := runPrivileged(plan.service[0], plan.service[1:]...); err != nil {
				ui.Warning("Docker installed, but its service could not be enabled automatically: %v", err)
			}
		}
	}
	return nil
}

// ensureTermuxImageUp runs the same OCI server image through PRoot-Distro.
// PRoot shares the Android host network, so BIND_ADDR is forced to loopback.
func ensureTermuxImageUp(port int, dataDir, image string) error {
	runtimeCmd, err := findProotDistro()
	if err != nil {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return fmt.Errorf("Termux Docker-image mode needs PRoot-Distro. Rerun in an interactive terminal to approve its installation, or run `pkg install proot-distro` manually")
		}
		install := false
		form := huh.NewForm(huh.NewGroup(huh.NewConfirm().Title("Install PRoot-Distro for the local server?").Description("This downloads the Termux package and lets cyb run its OCI image without Docker Engine.").Affirmative("Install").Negative("Cancel").Value(&install)))
		if formErr := form.Run(); formErr != nil {
			return formErr
		}
		if !install {
			return fmt.Errorf("PRoot-Distro installation cancelled; choose a remote dashboard or install it with `pkg install proot-distro`")
		}
		pkg, lookErr := exec.LookPath("pkg")
		if lookErr != nil {
			return fmt.Errorf("Termux `pkg` command not found; install PRoot-Distro manually with `pkg install proot-distro`")
		}
		if out, installErr := exec.Command(pkg, "install", "-y", "proot-distro").CombinedOutput(); installErr != nil {
			return fmt.Errorf("could not install PRoot-Distro: %v\n%s", installErr, out)
		}
		runtimeCmd, err = findProotDistro()
		if err != nil {
			return fmt.Errorf("PRoot-Distro was installed but its command is not on PATH; restart Termux and retry")
		}
	}
	if err := ensureProotRunSupport(runtimeCmd); err != nil {
		return err
	}
	if port < 1 {
		port = 3456
	}
	if dataDir == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return homeErr
		}
		dataDir = filepath.Join(home, ".local", "share", "cybermanju-os", "data")
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	if image == "" {
		image = serveImage
	}
	// Remove only our image rootfs, then pull the requested tag again. User data
	// lives in dataDir, outside the rootfs, and remains intact across updates.
	_ = exec.Command(runtimeCmd, "kill", serveName).Run()
	if prootContainerInstalled(runtimeCmd, serveName) {
		if out, removeErr := exec.Command(runtimeCmd, "remove", serveName).CombinedOutput(); removeErr != nil {
			return fmt.Errorf("could not replace the existing PRoot-Distro image: %v\n%s", removeErr, out)
		}
	}
	ui.Info("pulling OCI image %s with PRoot-Distro…", image)
	if out, installErr := exec.Command(runtimeCmd, "install", "--name", serveName, image).CombinedOutput(); installErr != nil {
		return fmt.Errorf("PRoot-Distro could not install %s: %v\n%s", image, installErr, out)
	}
	args := []string{"run", "--detach", "--env", fmt.Sprintf("PORT=%d", port), "--env", "BIND_ADDR=127.0.0.1", "--bind", dataDir + ":/data", serveName}
	if out, runErr := exec.Command(runtimeCmd, args...).CombinedOutput(); runErr != nil {
		return fmt.Errorf("PRoot-Distro could not start the dashboard image: %v\n%s", runErr, out)
	}
	address := fmt.Sprintf("127.0.0.1:%d", port)
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		conn, dialErr := net.DialTimeout("tcp", address, 400*time.Millisecond)
		if dialErr == nil {
			_ = conn.Close()
			ui.Success("local OCI dashboard running through PRoot-Distro (data: %s)", dataDir)
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	_ = exec.Command(runtimeCmd, "kill", serveName).Run()
	return fmt.Errorf("PRoot-Distro started the session but no dashboard answered on %s; check Android battery/background restrictions and run `cyb serve up` again", address)
}

func ensureProotRunSupport(runtimeCmd string) error {
	if out, err := exec.Command(runtimeCmd, "run", "--help").CombinedOutput(); err == nil {
		return nil
	} else {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return fmt.Errorf("installed PRoot-Distro does not support running OCI image entrypoints; update it with `pkg upgrade proot-distro` and retry\n%s", out)
		}
		upgrade := false
		form := huh.NewForm(huh.NewGroup(huh.NewConfirm().Title("Update PRoot-Distro?").Description("The installed version cannot run OCI image entrypoints. Upgrade the Termux package before continuing.").Affirmative("Update").Negative("Cancel").Value(&upgrade)))
		if formErr := form.Run(); formErr != nil {
			return formErr
		}
		if !upgrade {
			return fmt.Errorf("PRoot-Distro update cancelled; run `pkg upgrade proot-distro` to enable the local server")
		}
		pkg, lookErr := exec.LookPath("pkg")
		if lookErr != nil {
			return fmt.Errorf("Termux `pkg` command not found; update PRoot-Distro manually")
		}
		if updateOut, updateErr := exec.Command(pkg, "upgrade", "-y", "proot-distro").CombinedOutput(); updateErr != nil {
			return fmt.Errorf("could not update PRoot-Distro: %v\n%s", updateErr, updateOut)
		}
		if out, err := exec.Command(runtimeCmd, "run", "--help").CombinedOutput(); err != nil {
			return fmt.Errorf("updated PRoot-Distro still lacks OCI image run support; install a current Termux package\n%s", out)
		}
		return nil
	}
}

func findProotDistro() (string, error) {
	for _, name := range []string{"proot-distro", "pd"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("proot-distro is not installed")
}

func prootContainerInstalled(runtimeCmd, name string) bool {
	out, err := exec.Command(runtimeCmd, "list", "--quiet").Output()
	if err != nil {
		return false
	}
	for _, entry := range strings.Fields(string(out)) {
		if entry == name {
			return true
		}
	}
	return false
}

func runPrivileged(program string, args ...string) error {
	if os.Geteuid() == 0 {
		return runCommand(program, args...)
	}
	sudo, err := exec.LookPath("sudo")
	if err != nil {
		return fmt.Errorf("%s needs administrator permission; sudo was not found. Install Docker manually and rerun", program)
	}
	return runCommand(sudo, append([]string{program}, args...)...)
}

func runCommand(program string, args ...string) error {
	cmd := exec.Command(program, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s failed: %w", program, err)
	}
	return nil
}
