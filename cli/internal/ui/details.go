// CyberManju OS — Detail layouts (cli/internal/ui/details.go).
// Role: width-bounded key/value details that remain readable on mobile terminals.
// Exports: RenderKVWidth.
// Integrates: Lipgloss and the existing ANSI-aware terminal wrapping library.
// Contracts: pure builders; preserve all detail text and leave output profile to Emit.
package ui

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func wrapStyled(s string, width int) string {
	width = max(1, width)
	lines := strings.Split(ansi.Hardwrap(ansi.Wrap(s, width, ""), width, true), "\n")
	for i, line := range lines {
		if ansi.StringWidth(line) > width {
			// A two-cell grapheme cannot fit a one-cell screen. Mark that
			// exceptional clipping rather than wrapping outside the display.
			lines[i] = ansi.Truncate(line, width, "…")
		}
	}
	return strings.Join(lines, "\n")
}

// RenderKVWidth aligns compact details, stacking values when labels leave too
// little reading space. Values wrap rather than disappearing off the screen.
func RenderKVWidth(width int, pairs ...[2]string) string {
	width = max(1, width)
	labelWidth := 0
	for _, pair := range pairs {
		labelWidth = max(labelWidth, lipgloss.Width(pair[0]))
	}
	var out []string
	for _, pair := range pairs {
		label := Accent.Render(pair[0])
		if width-labelWidth-2 < 20 {
			indent := min(2, width-1)
			value := wrapStyled(pair[1], width-indent)
			out = append(out, wrapStyled(label, width), strings.Repeat(" ", indent)+strings.ReplaceAll(value, "\n", "\n"+strings.Repeat(" ", indent)))
			continue
		}
		indent := labelWidth + 2
		value := wrapStyled(pair[1], width-indent)
		out = append(out, label+strings.Repeat(" ", indent-lipgloss.Width(pair[0]))+strings.ReplaceAll(value, "\n", "\n"+strings.Repeat(" ", indent)))
	}
	return strings.Join(out, "\n")
}
