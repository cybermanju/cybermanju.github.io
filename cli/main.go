// Command cyb is the universal CyberManju OS terminal: files, disks, sync,
// OAuth, cybsh and the AI agent over the dashboard REST API, with a Charm
// (Lipgloss/Bubbles/Huh/Glamour) face.
package main

import (
	"fmt"
	"os"

	"github.com/cybermanju/cybermanju.github.io/cli/cmd"
)

var (
	// Stamped by CI: go build -ldflags "-X main.version=vX.Y.Z -X main.commit=SHA".
	version = "dev"
	commit  = "none"
)

func main() {
	if err := cmd.Execute(version, commit); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
