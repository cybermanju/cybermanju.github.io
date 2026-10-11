// Package ui is the Charm face: one Lipgloss theme, tables, spinners and
// markdown rendering shared by every command.
package ui

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

var (
	// Title renders command headers.
	Title = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	// OK renders success lines.
	OK = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	// Err renders failure lines.
	Err = lipgloss.NewStyle().Foreground(lipgloss.Color("196"))
	// Warn renders caution lines.
	Warn = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	// Dim renders secondary text.
	Dim = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	// Accent renders ids and highlights.
	Accent = lipgloss.NewStyle().Foreground(lipgloss.Color("87"))
	// Panel boxes notes and next steps.
	Panel = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("63")).
		Padding(0, 1)
)

// NoColor disables all styling (for pipes and --no-color).
func NoColor() {
	lipgloss.SetColorProfile(termenv.Ascii)
}

// Banner is the `cyb` mark.
func Banner(version string) string {
	return Title.Render("◈ cybermanju") + " " + Dim.Render("v"+strings.TrimPrefix(version, "v"))
}

// Success prints a green check line.
func Success(format string, args ...any) {
	fmt.Fprintln(os.Stdout, OK.Render("✓ ")+fmt.Sprintf(format, args...))
}

// Failure prints a red cross line.
func Failure(format string, args ...any) {
	fmt.Fprintln(os.Stderr, Err.Render("✗ ")+fmt.Sprintf(format, args...))
}

// Info prints a dim informational line.
func Info(format string, args ...any) {
	fmt.Fprintln(os.Stdout, Dim.Render("• ")+fmt.Sprintf(format, args...))
}

// Header prints a section title.
func Header(format string, args ...any) {
	fmt.Fprintln(os.Stdout, Title.Render(fmt.Sprintf(format, args...)))
}

// Table renders padded columns; widths grow to fit cells.
func Table(headers []string, rows [][]string) {
	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = lipgloss.Width(h)
	}
	for _, row := range rows {
		for i, cell := range row {
			if i < len(widths) && lipgloss.Width(cell) > widths[i] {
				widths[i] = lipgloss.Width(cell)
			}
		}
	}
	pad := func(s string, w int) string {
		return s + strings.Repeat(" ", max(0, w-lipgloss.Width(s)+2))
	}
	var head strings.Builder
	for i, h := range headers {
		head.WriteString(pad(Dim.Render(h), widths[i]))
	}
	fmt.Fprintln(os.Stdout, head.String())
	for _, row := range rows {
		var line strings.Builder
		for i := range headers {
			cell := ""
			if i < len(row) {
				cell = row[i]
			}
			line.WriteString(pad(cell, widths[i]))
		}
		fmt.Fprintln(os.Stdout, line.String())
	}
}

// KV prints key: value rows.
func KV(pairs ...[2]string) {
	w := 0
	for _, p := range pairs {
		if lipgloss.Width(p[0]) > w {
			w = lipgloss.Width(p[0])
		}
	}
	for _, p := range pairs {
		fmt.Fprintf(os.Stdout, "%s  %s\n", Dim.Render(p[0]+strings.Repeat(" ", max(0, w-lipgloss.Width(p[0])))), p[1])
	}
}

// PrintJSON pretty-prints raw bytes for --json.
func PrintJSON(raw []byte) error {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		fmt.Println(strings.TrimSpace(string(raw)))
		return nil
	}
	pretty, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(pretty))
	return nil
}

// RenderMarkdown glamour-renders agent/LLM output for the terminal.
func RenderMarkdown(text string) string {
	out, err := glamour.Render(text, "dark")
	if err != nil {
		return text
	}
	return out
}

// SpinWhile runs fn with a Charm spinner until it returns.
func SpinWhile(msg string, fn func() error) error {
	frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	done := make(chan error, 1)
	go func() { done <- fn() }()
	tick := time.NewTicker(80 * time.Millisecond)
	defer tick.Stop()
	frame := 0
	for {
		select {
		case err := <-done:
			fmt.Fprintf(os.Stderr, "\r\033[K")
			return err
		case <-tick.C:
			fmt.Fprintf(os.Stderr, "\r%s %s", Accent.Render(frames[frame%len(frames)]), msg)
			frame++
		}
	}
}
