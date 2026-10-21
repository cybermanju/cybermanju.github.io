// CyberManju OS — Ui (cli/internal/ui/ui.go).
// Package ui is the Charm v2 face of `cyb`: one Lipgloss cyberpunk-neon
// theme (hot pink into signal red, neon cyan + hazard yellow accents), a
// gradient banner, Bubble Tea spinner, gradient progress downloads, neon
// tables with header rules and zebra rows, syntax-tinted JSON, and
// width-aware Glamour markdown shared by every command. Builders emit
// full-fidelity ANSI; every print boundary downsamples to the active
// colorprofile (NoTTY when --no-color), so stdout stays pipe-clean and
// honest. Interactive programs (spinner, Huh forms, REPL) are pinned to
// the same profile via tea.WithColorProfile.
package ui

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/muesli/reflow/truncate"
	"golang.org/x/term"

	"charm.land/bubbles/v2/progress"
	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/glamour/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
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

// NoColor disables all styling (for pipes and --no-color) by pinning the
// Lipgloss writer to the NoTTY profile, which strips every escape sequence.
// (The Ascii profile keeps non-color SGR like bold — not plain enough.)
func NoColor() {
	lipgloss.Writer.Profile = colorprofile.NoTTY
}

// ColorProfile reports the active Lipgloss output profile (tests pin it;
// production auto-detects from the terminal).
func ColorProfile() colorprofile.Profile {
	return lipgloss.Writer.Profile
}

// Banner is the `cyb` mark in a pink → red gradient.
func Banner(version string) string {
	return Gradient("◈ cybermanju", PinkHot, RedHot) + " " + Dim.Render("v"+strings.TrimPrefix(version, "v"))
}

// Success prints a pink check line.
func Success(format string, args ...any) {
	fmt.Fprintln(os.Stdout, Downsample(OK.Render("✓ ")+fmt.Sprintf(format, args...)))
}

// Failure prints a red cross line.
func Failure(format string, args ...any) {
	fmt.Fprintln(os.Stderr, Downsample(Err.Render("✗ ")+fmt.Sprintf(format, args...)))
}

// Info prints a dim informational line.
func Info(format string, args ...any) {
	fmt.Fprintln(os.Stdout, Downsample(Dim.Render("• ")+fmt.Sprintf(format, args...)))
}

// Header prints a neon section title.
func Header(format string, args ...any) {
	fmt.Fprintln(os.Stdout, Downsample(Title.Render("◈ "+fmt.Sprintf(format, args...))))
}

// Hint prints a dim next-step line to stderr so stdout stays pipe-clean.
// Wrap `cyb …` references in Chip for scanability.
func Hint(format string, args ...any) {
	fmt.Fprintln(os.Stderr, Downsample(Dim.Render("→  ")+fmt.Sprintf(format, args...)))
}

// Emit prints one pre-styled line to stdout, downsampled to the active
// color profile.
func Emit(s string) {
	fmt.Fprintln(os.Stdout, Downsample(s))
}

// Table renders width-aware columns, switching to labeled records when a conventional
// table cannot preserve all columns at a useful width.
func Table(headers []string, rows [][]string) { Emit(RenderTable(headers, rows)) }

// RenderTable is the pure Table builder (stdout-free, unit-testable).
func RenderTable(headers []string, rows [][]string) string {
	return RenderTableWidth(TermWidth(), headers, rows)
}

// RenderTableWidth renders every column within an explicit display width. At
// postage-stamp widths it uses one labeled field per line instead of dropping data.
func RenderTableWidth(width int, headers []string, rows [][]string) string {
	if width < 1 {
		width = 1
	}
	cols := len(headers)
	for _, row := range rows {
		if len(row) > cols {
			cols = len(row)
		}
	}
	if cols == 0 {
		return ""
	}
	labels := make([]string, cols)
	for i := range labels {
		if i < len(headers) {
			labels[i] = cleanTableCell(headers[i])
		}
		if labels[i] == "" {
			labels[i] = fmt.Sprintf("Column %d", i+1)
		}
	}
	if cols > 1 && width < cols*4+cols-1 {
		return renderStackedTable(width, labels, rows)
	}
	widths := make([]int, cols)
	for i := range widths {
		widths[i] = displayWidth(labels[i])
	}
	for _, row := range rows {
		for i := range widths {
			if i < len(row) {
				if w := displayWidth(cleanTableCell(row[i])); w > widths[i] {
					widths[i] = w
				}
			}
		}
	}
	fitWidths(widths, width)
	pad := func(s string, w int) string {
		s = truncateCell(s, w)
		return s + strings.Repeat(" ", max(0, w-displayWidth(s)))
	}
	var out strings.Builder
	var head, rule strings.Builder
	for i, h := range labels {
		if i > 0 {
			head.WriteByte(' ')
			rule.WriteByte(' ')
		}
		head.WriteString(Title.Render(pad(h, widths[i])))
		rule.WriteString(Dim.Render(pad(strings.Repeat("─", widths[i]), widths[i])))
	}
	out.WriteString(strings.TrimRight(head.String(), " ") + "\n")
	out.WriteString(strings.TrimRight(rule.String(), " ") + "\n")
	for ri, row := range rows {
		var line strings.Builder
		for i := range labels {
			if i > 0 {
				line.WriteByte(' ')
			}
			cell := ""
			if i < len(row) {
				cell = cleanTableCell(row[i])
			}
			cell = pad(cell, widths[i])
			if ri%2 == 1 {
				cell = SurfaceAlt.Render(cell)
			} else {
				cell = Text.Render(cell)
			}
			line.WriteString(cell)
		}
		out.WriteString(strings.TrimRight(line.String(), " "))
		if ri < len(rows)-1 {
			out.WriteByte('\n')
		}
	}
	return out.String()
}

func renderStackedTable(width int, labels []string, rows [][]string) string {
	var out strings.Builder
	if len(rows) == 0 {
		for i, label := range labels {
			if i > 0 {
				out.WriteByte('\n')
			}
			out.WriteString(Title.Render(strings.Join(wrapCell(label, width), "\n")))
		}
		return out.String()
	}
	for ri, row := range rows {
		if ri > 0 {
			out.WriteByte('\n')
		}
		for i, label := range labels {
			if i > 0 {
				out.WriteByte('\n')
			}
			out.WriteString(Title.Render(strings.Join(wrapCell(label+":", width), "\n")))
			value := ""
			if i < len(row) {
				value = cleanTableCell(row[i])
			}
			for _, part := range wrapCell(value, width) {
				out.WriteByte('\n')
				out.WriteString(Text.Render(part))
			}
		}
	}
	return out.String()
}

func wrapCell(s string, width int) []string {
	if width < 1 {
		return []string{""}
	}
	if s == "" {
		return []string{""}
	}
	wrapped := ansi.Hardwrap(s, width, true)
	parts := strings.Split(wrapped, "\n")
	for i, part := range parts {
		if displayWidth(part) > width {
			parts[i] = truncateCell(part, width)
		}
	}
	return parts
}

// cleanTableCell flattens multiline input and removes terminal/control escapes.
func cleanTableCell(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) || r >= 0x202A && r <= 0x202E || r >= 0x2066 && r <= 0x2069 {
			return -1
		}
		return r
	}, ansi.Strip(s))
}

func displayWidth(s string) int { return lipgloss.Width(s) }

// truncateCell preserves whole runes and always makes shortening visible.
func truncateCell(s string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if displayWidth(s) <= limit {
		return s
	}
	if limit == 1 {
		return "…"
	}
	return ansi.Truncate(s, limit, "…")
}

// fitWidths shrinks the widest columns (never below one cell) until the
// table fits the requested terminal width.
func fitWidths(widths []int, limit int) {
	total := func() int {
		n := 0
		for _, w := range widths {
			n += w
		}
		if len(widths) > 1 {
			n += len(widths) - 1
		}
		return n
	}
	for total() > limit {
		best, bi := 1, -1
		for i, w := range widths {
			if w > best {
				best, bi = w, i
			}
		}
		if bi < 0 {
			return
		}
		widths[bi]--
	}
}

// ShellHeader renders a width-bounded neon CUTE CLI/cybsh welcome header.
// Credentials, query parameters and fragments in endpoint are never shown.
func ShellHeader(width int, version, endpoint string) string {
	if width < 1 {
		return ""
	}
	label := "◈ CUTE CLI · cybsh"
	if v := strings.TrimSpace(strings.TrimPrefix(version, "v")); v != "" {
		label += " · v" + v
	}
	if ep := safeEndpoint(endpoint); ep != "" {
		label += " · " + ep
	}
	return SurfaceAlt.Width(width).Render(fitStyled(Title.Render(label), width))
}

// ShellFooter renders a compact pure REPL status hint.
func ShellFooter(width int, busy bool) string {
	if width < 1 {
		return ""
	}
	text := "Ctrl+G help · Tab complete · ↑/↓ history · Ctrl+D exit"
	if busy {
		text = "Ctrl+C stop waiting · Esc stop · Ctrl+G help"
	}
	if width < 54 {
		text = "Ctrl+G help · Tab · Ctrl+D exit"
		if busy {
			text = "Ctrl+C stop · Ctrl+G help"
		}
	}
	if width < 30 {
		text = "Ctrl+G help · :q exit"
		if busy {
			text = "Ctrl+C stop waiting"
		}
	}
	if width < 20 {
		text = "^G help · :q"
		if busy {
			text = "^C stop wait"
		}
	}
	return fitStyled(Dim.Render(text), width)
}

func safeEndpoint(endpoint string) string {
	s := strings.TrimSpace(endpoint)
	if s == "" {
		return ""
	}
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		u.User = nil
		u.RawQuery, u.Fragment = "", ""
		s = u.String()
	} else {
		if i := strings.IndexAny(s, "?#"); i >= 0 {
			s = s[:i]
		}
		if i := strings.LastIndex(s, "@"); i >= 0 {
			s = s[i+1:]
		}
	}
	return s
}

func fitStyled(s string, width int) string {
	if lipgloss.Width(s) <= width {
		return s
	}
	return truncate.StringWithTail(s, uint(width), "…")
}

// KV prints key: value rows.
func KV(pairs ...[2]string) {
	if len(pairs) > 0 {
		Emit(RenderKVWidth(TermWidth(), pairs...))
	}
}

// JSON tint atoms: pink keys, ice strings, cyan numbers, yellow bools.
var (
	jsonKey   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(PinkHot))
	jsonStr   = lipgloss.NewStyle().Foreground(lipgloss.Color(IceWhite))
	jsonNum   = lipgloss.NewStyle().Foreground(lipgloss.Color(CyanNeon))
	jsonBool  = lipgloss.NewStyle().Foreground(lipgloss.Color(YellowHz))
	jsonNull  = lipgloss.NewStyle().Faint(true).Foreground(lipgloss.Color(DimGray))
	jsonDelim = lipgloss.NewStyle().Foreground(lipgloss.Color(PinkDeep))
	jsonPunct = lipgloss.NewStyle().Foreground(lipgloss.Color(DimGray))
)

// PrintJSON pretty-prints raw bytes for --json, syntax-tinted on color
// terminals (plain pretty JSON when --no-color). Non-JSON passes through.
func PrintJSON(raw []byte) error {
	if s, ok := RenderJSON(raw); ok {
		fmt.Println(Downsample(s))
		return nil
	}
	fmt.Println(strings.TrimSpace(string(raw)))
	return nil
}

// RenderJSON is the pure JSON renderer (stdout-free, unit-testable):
// pretty-prints and tints; ok=false when raw is not a JSON value.
func RenderJSON(raw []byte) (out string, ok bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var b strings.Builder
	if err := writeJSONValue(dec, &b, 0); err != nil {
		return "", false
	}
	if _, err := dec.Token(); err != io.EOF {
		return "", false
	}
	return b.String(), true
}

func writeJSONIndent(b *strings.Builder, indent int) {
	b.WriteString(strings.Repeat("  ", indent))
}

func writeJSONValue(dec *json.Decoder, b *strings.Builder, indent int) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			b.WriteString(jsonDelim.Render("{"))
			if !dec.More() {
				if ct, err := dec.Token(); err != nil {
					return err
				} else if d, isDelim := ct.(json.Delim); !isDelim || d != '}' {
					return fmt.Errorf("ui: unterminated object")
				}
				b.WriteString(jsonDelim.Render("}"))
				return nil
			}
			b.WriteString("\n")
			for dec.More() {
				writeJSONIndent(b, indent+1)
				kt, err := dec.Token()
				if err != nil {
					return err
				}
				ks, isStr := kt.(string)
				if !isStr {
					return fmt.Errorf("ui: object key is not a string")
				}
				b.WriteString(jsonKey.Render(strconv.Quote(ks)))
				b.WriteString(jsonPunct.Render(": "))
				if err := writeJSONValue(dec, b, indent+1); err != nil {
					return err
				}
				if dec.More() {
					b.WriteString(jsonPunct.Render(","))
				}
				b.WriteString("\n")
			}
			if ct, err := dec.Token(); err != nil {
				return err
			} else if d, isDelim := ct.(json.Delim); !isDelim || d != '}' {
				return fmt.Errorf("ui: unterminated object")
			}
			writeJSONIndent(b, indent)
			b.WriteString(jsonDelim.Render("}"))
			return nil
		case '[':
			b.WriteString(jsonDelim.Render("["))
			if !dec.More() {
				if ct, err := dec.Token(); err != nil {
					return err
				} else if d, isDelim := ct.(json.Delim); !isDelim || d != ']' {
					return fmt.Errorf("ui: unterminated array")
				}
				b.WriteString(jsonDelim.Render("]"))
				return nil
			}
			b.WriteString("\n")
			for dec.More() {
				writeJSONIndent(b, indent+1)
				if err := writeJSONValue(dec, b, indent+1); err != nil {
					return err
				}
				if dec.More() {
					b.WriteString(jsonPunct.Render(","))
				}
				b.WriteString("\n")
			}
			if ct, err := dec.Token(); err != nil {
				return err
			} else if d, isDelim := ct.(json.Delim); !isDelim || d != ']' {
				return fmt.Errorf("ui: unterminated array")
			}
			writeJSONIndent(b, indent)
			b.WriteString(jsonDelim.Render("]"))
			return nil
		default:
			return fmt.Errorf("ui: unexpected delimiter %v", t)
		}
	case string:
		b.WriteString(jsonStr.Render(strconv.Quote(t)))
	case json.Number:
		b.WriteString(jsonNum.Render(t.String()))
	case bool:
		b.WriteString(jsonBool.Render(strconv.FormatBool(t)))
	case nil:
		b.WriteString(jsonNull.Render("null"))
	default:
		return fmt.Errorf("ui: unexpected token %T", tok)
	}
	return nil
}

// TermWidth reports stdout width up to 100 columns; narrow terminals keep their
// actual width (80 when stdout is not a terminal, e.g. pipes and CI logs).
func TermWidth() int {
	if w, _, err := term.GetSize(int(os.Stdout.Fd())); err == nil && w > 0 {
		return min(w, 100)
	}
	return 80
}

// GlamourStyle picks the markdown stylesheet for the active color profile:
// ascii when color is off, the cyberpunk pink style on color terminals.
func GlamourStyle() string {
	if ColorProfile() <= colorprofile.Ascii {
		return "ascii"
	}
	if !IsDarkBackground() {
		return "light"
	}
	return "pink"
}

// IsMarkdown reports whether name looks like a markdown document.
func IsMarkdown(name string) bool {
	lower := strings.ToLower(name)
	for _, ext := range []string{".md", ".markdown", ".mdown", ".mkd", ".mdx"} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

// Downsample re-emits styled text for the active color profile (strips ANSI
// entirely when --no-color).
func Downsample(s string) string {
	return lipgloss.Sprint(s)
}

// RenderMarkdown glamour-renders markdown for the terminal: word-wrapped to
// the terminal width, styled per the color profile (GLAMOUR_STYLE wins when
// set), colors downsampled via Lipgloss. Unrenderable input passes through.
func RenderMarkdown(text string) string {
	return RenderMarkdownWidth(TermWidth(), text)
}

// RenderMarkdownWidth keeps Markdown prose, long URLs and code blocks inside
// a known reading area. Glamour's word wrapping alone does not constrain code.
func RenderMarkdownWidth(width int, text string) string {
	width = max(1, width)
	// Stylesheet margins and fenced-code padding overwhelm a tiny display.
	if width < 20 {
		return Downsample(wrapStyled(text, width))
	}
	opts := []glamour.TermRendererOption{glamour.WithWordWrap(width)}
	if os.Getenv("GLAMOUR_STYLE") != "" {
		opts = append(opts, glamour.WithEnvironmentConfig())
	} else {
		opts = append(opts, glamour.WithStandardStyle(GlamourStyle()))
	}
	r, err := glamour.NewTermRenderer(opts...)
	if err != nil {
		return Downsample(wrapStyled(text, width))
	}
	out, err := r.Render(text)
	if err != nil {
		return Downsample(wrapStyled(text, width))
	}
	return Downsample(wrapStyled(strings.TrimRight(out, "\n"), width))
}

// isTTY reports whether stderr is an interactive terminal.
func isTTY() bool {
	return term.IsTerminal(int(os.Stderr.Fd()))
}

// ── Bubble Tea spinner ────────────────────────────────────────────

type spinDoneMsg struct{ err error }

// A closed completion channel broadcasts to both the model and the caller.
// A single error channel cannot do that: the model used to consume the result,
// leaving SpinWhile blocked forever on its second receive.
type spinTask struct {
	done chan struct{}
	err  error
}

type spinModel struct {
	spinner spinner.Model
	msg     string
	frame   int
	width   int
	task    *spinTask
}

func newSpinModel(msg string, task *spinTask) spinModel {
	s := spinner.New(
		spinner.WithSpinner(spinner.Dot),
		spinner.WithStyle(Accent),
	)
	return spinModel{spinner: s, msg: msg, task: task}
}

// pinkFrames pulses the message dot between pink and red shapes.
var pinkFrames = []string{"◈", "◉", "⬢", "⬣"}

func (m spinModel) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		func() tea.Msg {
			<-m.task.done
			return spinDoneMsg{m.task.err}
		},
	)
}

func (m spinModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = max(1, msg.Width)
		return m, nil
	case spinDoneMsg:
		return m, tea.Quit
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		m.frame++
		return m, cmd
	}
	return m, nil
}

func (m spinModel) View() tea.View {
	dot := Gradient(pinkFrames[m.frame%len(pinkFrames)], PinkHot, RedHot)
	text := fmt.Sprintf("%s %s  %s", m.spinner.View(), dot, cleanTableCell(m.msg))
	if m.width > 0 {
		text = truncateCell(text, m.width)
	}
	return tea.NewView(text)
}

// SpinWhile runs fn under a hot-pink Bubble Tea spinner (plain fallback
// when stderr is not a TTY, e.g. pipes and CI logs).
func SpinWhile(msg string, fn func() error) error {
	task := &spinTask{done: make(chan struct{})}
	go func() {
		task.err = fn()
		close(task.done)
	}()
	if !isTTY() {
		<-task.done
		return task.err
	}
	p := tea.NewProgram(newSpinModel(msg, task),
		tea.WithOutput(os.Stderr),
		tea.WithColorProfile(ColorProfile()),
	)
	// Rendering failure does not cancel the operation. Wait for its actual
	// result whether the renderer consumed the completion message or not.
	_, _ = p.Run()
	<-task.done
	return task.err
}

// ── Progress download ─────────────────────────────────────────────

type progressReader struct {
	r     io.Reader
	n     int64
	total int64
	last  time.Time
	out   io.Writer
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.n += int64(n)
	if p.total > 0 && time.Since(p.last) > 80*time.Millisecond {
		p.last = time.Now()
		fmt.Fprintf(p.out, "\r%s", Downsample(renderDownloadProgress(stderrWidth(), p.n, p.total, "")))
	}
	return n, err
}

// Progress belongs to stderr, whose size may differ from piped stdout.
func stderrWidth() int {
	if w, _, err := term.GetSize(int(os.Stderr.Fd())); err == nil && w > 0 {
		return w
	}
	return 80
}

func renderDownloadProgress(width int, n, total int64, status string) string {
	width = max(1, width)
	percent := 0.0
	if total > 0 {
		percent = min(1.0, max(0.0, float64(n)/float64(total)))
	}
	label := fmt.Sprintf("%d%%", int(percent*100))
	if status != "" {
		label = status + " " + label
	}
	if width < 16 {
		return truncateCell(label, width)
	}
	bar := progress.New(
		progress.WithColors(lipgloss.Color(adaptiveHex(PinkHot)), lipgloss.Color(adaptiveHex(RedHot))),
		progress.WithWidth(max(1, min(40, width-lipgloss.Width(label)-1))),
		progress.WithoutPercentage(),
	)
	return bar.ViewAs(percent) + " " + label
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
	interactive := isTTY() && total > 0
	var reader io.Reader = res.Body
	if interactive {
		reader = &progressReader{r: res.Body, total: total, last: time.Now(), out: os.Stderr}
	}
	n, err := io.Copy(f, reader)
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if interactive {
		status := "downloaded"
		if err != nil {
			status = "failed"
		}
		fmt.Fprintf(os.Stderr, "\r%s\n", Downsample(renderDownloadProgress(stderrWidth(), n, total, status)))
	}
	return n, err
}
