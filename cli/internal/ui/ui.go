// Package ui is the Charm face: one Lipgloss theme (hot pink → signal
// red), gradient banner, Bubble Tea spinner, progress downloads, tables
// and Glamour markdown shared by every command.
package ui

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
	"golang.org/x/term"
)

var (
	// Title renders command headers in hot pink.
	Title = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(PinkHot))
	// OK renders success lines in hot pink.
	OK = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(PinkHot))
	// Err renders failure lines in signal red.
	Err = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(RedHot))
	// Warn renders caution lines in deep pink.
	Warn = lipgloss.NewStyle().Foreground(lipgloss.Color("#FF7AB8"))
	// Dim renders secondary text.
	Dim = lipgloss.NewStyle().Foreground(lipgloss.Color(DimGray))
	// Accent renders ids, prompts and highlights in hot pink.
	Accent = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(PinkHot))
	// Panel boxes notes and next steps in a pink rounded frame.
	Panel = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color(PinkHot)).
		Padding(0, 1)
)

// NoColor disables all styling (for pipes and --no-color).
func NoColor() {
	lipgloss.SetColorProfile(termenv.Ascii)
}

// Banner is the `cyb` mark in a pink → red gradient.
func Banner(version string) string {
	return Gradient("◈ cybermanju", PinkHot, RedHot) + " " + Dim.Render("v"+strings.TrimPrefix(version, "v"))
}

// Success prints a pink check line.
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
	headStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(PinkHot))
	var head strings.Builder
	for i, h := range headers {
		head.WriteString(pad(headStyle.Render(h), widths[i]))
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
	keyStyle := lipgloss.NewStyle().Foreground(lipgloss.Color(PinkHot))
	for _, p := range pairs {
		fmt.Fprintf(os.Stdout, "%s  %s\n", keyStyle.Render(p[0]+strings.Repeat(" ", max(0, w-lipgloss.Width(p[0])))), p[1])
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

// isTTY reports whether stderr is an interactive terminal.
func isTTY() bool {
	return term.IsTerminal(int(os.Stderr.Fd()))
}

// ── Bubble Tea spinner ────────────────────────────────────────────

type spinDoneMsg struct{ err error }

type spinModel struct {
	spinner spinner.Model
	msg     string
	done    chan error
}

func newSpinModel(msg string, done chan error) spinModel {
	s := spinner.New(
		spinner.WithSpinner(spinner.Dot),
		spinner.WithStyle(lipgloss.NewStyle().Foreground(lipgloss.Color(PinkHot))),
	)
	return spinModel{spinner: s, msg: msg, done: done}
}

// pinkFrames pulses the message dot between pink and red.
var pinkFrames = []string{"◈", "◉", "⬢", "⬣"}

func (m spinModel) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		func() tea.Msg { return spinDoneMsg{<-m.done} },
	)
}

func (m spinModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case spinDoneMsg:
		return m, tea.Quit
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m spinModel) View() string {
	dot := Gradient(pinkFrames[0], PinkHot, RedHot)
	return fmt.Sprintf("%s %s  %s", m.spinner.View(), dot, m.msg)
}

// SpinWhile runs fn under a hot-pink Bubble Tea spinner (plain fallback
// when stderr is not a TTY, e.g. pipes and CI logs).
func SpinWhile(msg string, fn func() error) error {
	done := make(chan error, 1)
	go func() { done <- fn() }()
	if !isTTY() {
		err := <-done
		return err
	}
	p := tea.NewProgram(newSpinModel(msg, done), tea.WithOutput(os.Stderr))
	if _, err := p.Run(); err != nil {
		return <-done
	}
	return <-done
}

// ── Progress download ─────────────────────────────────────────────

type progressReader struct {
	r     io.Reader
	n     int64
	total int64
	bar   progress.Model
	last  time.Time
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.n += int64(n)
	if p.total > 0 && time.Since(p.last) > 80*time.Millisecond {
		p.last = time.Now()
		fmt.Fprintf(os.Stderr, "\r%s", p.bar.ViewAs(float64(p.n)/float64(p.total)))
	}
	return n, err
}

// Download fetches url to dest with a pink → red progress bar (plain copy
// when not a TTY). Returns bytes written.
func Download(url, dest string) (int64, error) {
	res, err := http.Get(url) //nolint:gosec // release artifact download
	if err != nil {
		return -1, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return -1, fmt.Errorf("network: download %d", res.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return -1, err
	}
	defer f.Close()
	total := res.ContentLength
	if !isTTY() || total <= 0 {
		n, err := io.Copy(f, res.Body)
		return n, err
	}
	bar := progress.New(
		progress.WithGradient(PinkHot, RedHot),
		progress.WithWidth(40),
		progress.WithoutPercentage(),
	)
	pr := &progressReader{r: res.Body, total: total, bar: bar, last: time.Now()}
	n, err := io.Copy(f, pr)
	fmt.Fprintf(os.Stderr, "\r%s\n", bar.ViewAs(1))
	return n, err
}
