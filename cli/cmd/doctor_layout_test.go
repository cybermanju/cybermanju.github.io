// CyberManju OS — Doctor layout tests (cli/cmd/doctor_layout_test.go).
// Role: keep diagnostic statuses and recovery details readable on phone terminals.
// Exports: TestDoctorChecksResponsive, TestPrintChecksUsesTerminalWidth, TestDoctorChecksEmptyDetails.
// Integrates: diagnostic fixtures, ANSI display widths, shared responsive help rows.
// Contracts: wrapping preserves every status, check name and detail without network calls.
package cmd

import (
	"fmt"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

func TestDoctorChecksResponsive(t *testing.T) {
	checks := []check{
		{"dashboard reachable", false, "network: https://example.invalid/a/very/long/path/without/spaces is unavailable"},
		{"auth session", true, "JWT accepted"},
		{"volume 日本語", true, "Ready for sincronização de arquivos"},
		{"sync providers", false, "none — cyb sync create --backend local"},
	}
	var expected strings.Builder
	for _, ch := range checks {
		fmt.Fprintf(&expected, "%s %s — %s", ui.Downsample(ui.Badge(ch.ok)), ch.name, ch.detail)
	}
	compact := func(s string) string { return strings.Join(strings.Fields(ansi.Strip(s)), "") }
	for _, width := range []int{8, 24, 40, 80, 100} {
		t.Run(fmt.Sprintf("%d columns", width), func(t *testing.T) {
			out := formatChecks(checks, width)
			for _, line := range strings.Split(out, "\n") {
				if n := ansi.StringWidth(line); n > width {
					t.Fatalf("doctor row exceeds %d columns (%d): %q", width, n, line)
				}
			}
			if compact(out) != compact(expected.String()) {
				t.Fatalf("doctor output lost or changed a status or detail: %q", out)
			}
		})
	}
}

func TestPrintChecksUsesTerminalWidth(t *testing.T) {
	checks := []check{{"dashboard reachable", false, strings.Repeat("network unavailable ", 12)}}
	out := captureStdout(t, func() { printChecks(checks) })
	// Captured stdout is a pipe, for which TermWidth uses the 80-column fallback.
	if want := formatChecks(checks, 80); out != want {
		t.Fatalf("printChecks did not use the responsive formatter: %q", out)
	}
}

func TestDoctorChecksEmptyDetails(t *testing.T) {
	if got := formatChecks(nil, 40); got != "" {
		t.Fatalf("empty checklist must not print rows: %q", got)
	}
	out := ansi.Strip(formatChecks([]check{{"ready", true, ""}}, 40))
	if !strings.Contains(out, "ready") || strings.Contains(out, "—") {
		t.Fatalf("a check without details gained a separator or lost its name: %q", out)
	}
}
