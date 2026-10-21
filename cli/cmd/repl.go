// CyberManju OS — CUTE cybsh (cli/cmd/repl.go).
// Role: responsive Charm terminal workspace with asynchronous remote execution.
// Exports: replModel, Init, Update, View.
// Integrates: Bubble Tea, Bubbles, Lipgloss, dashboard client and UI theme.
// Contracts: one request at a time; cancellation stops waiting, not remote jobs;
// leading-space commands stay out of persisted history; non-TTY output is clean.
package cmd

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"
	"unicode"

	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/client"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/config"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

const historyLimit = 1000

var shellSuggestions = []string{
	":help", ":clear", ":quit", ":exit", ":q",
	"help", "version", "echo", "history", "pwd", "cd", "ls", "cat", "cp", "mv", "rm",
	"mkdir", "touch", "stat", "du", "df", "disk list", "disk check", "mount", "umount",
	"providers", "quota", "oauth status", "sync status", "sync start", "scrub", "repair",
	"gc", "lease", "ps", "top", "kill", "jobs", "compute", "workers", "keygen",
	"encrypt", "decrypt", "compress", "decompress", "search", "grep", "find", "head",
	"tail", "wc", "write", "edit", "ai status", "ai sessions", "run", "cron list", "backup",
}

type shellResultMsg struct {
	id       uint64
	response client.ExecResp
	err      error
}

type replKeys struct{}

var (
	replRunBinding        = key.NewBinding(key.WithKeys("enter"), key.WithHelp("enter", "run command"))
	replCompletionBinding = key.NewBinding(key.WithKeys("tab", "shift+tab"), key.WithHelp("tab/shift+tab", "cycle completion"))
	replHistoryBinding    = key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑/↓", "history; restore draft"))
	replScrollBinding     = key.NewBinding(key.WithKeys("pgup", "pgdown"), key.WithHelp("pgup/pgdn", "scrollback"))
	replEscBinding        = key.NewBinding(key.WithKeys("esc"), key.WithHelp("esc", "dismiss / clear / stop waiting"))
	replHelpBinding       = key.NewBinding(key.WithKeys("ctrl+g", "f1"), key.WithHelp("ctrl+g/f1", "toggle help"))
	replBottomBinding     = key.NewBinding(key.WithKeys("ctrl+end"), key.WithHelp("ctrl+end", "jump to latest"))
	replCancelBinding     = key.NewBinding(key.WithKeys("ctrl+c"), key.WithHelp("ctrl+c", "clear / stop waiting / exit if empty"))
	replClearBinding      = key.NewBinding(key.WithKeys("ctrl+l"), key.WithHelp("ctrl+l", "clear scrollback"))
	replQuitBinding       = key.NewBinding(key.WithKeys("ctrl+d"), key.WithHelp(":q/ctrl+d", "exit with empty input"))
)

func (replKeys) ShortHelp() []key.Binding {
	return []key.Binding{replRunBinding, replHistoryBinding, replCompletionBinding, replHelpBinding, replCancelBinding, replBottomBinding}
}
func (replKeys) FullHelp() [][]key.Binding {
	return [][]key.Binding{{replRunBinding, replCompletionBinding, replHistoryBinding, replScrollBinding}, {replEscBinding, replHelpBinding, replBottomBinding, replCancelBinding, replClearBinding, replQuitBinding}}
}

type replModel struct {
	client           *client.Client
	view             viewport.Model
	input            textinput.Model
	spinner          spinner.Model
	history          []string
	histIdx          int
	draft            string
	lines            []string
	ready            bool
	width, height    int
	busy             bool
	requestID        uint64
	cancel           context.CancelFunc
	dark             bool
	help             help.Model
	helpVisible      bool
	helpOffset       int
	completion       []string
	completionIndex  int
	completionPrefix string
	completionLead   string
	newOutput        bool
}

func newReplModel(c *client.Client, history []string) replModel {
	dark := ui.IsDarkBackground()
	ti := textinput.New()
	ti.Placeholder = "help · Tab completes · :help for keys"
	ti.Prompt = "cybsh › "
	ti.CharLimit = 64 * 1024
	ti.SetSuggestions(shellSuggestions)
	ti.ShowSuggestions = true
	applyInputTheme(&ti, dark)
	ti.Focus()
	sp := spinner.New(spinner.WithSpinner(spinner.Dot), spinner.WithStyle(ui.Accent))
	if len(history) > historyLimit {
		history = history[len(history)-historyLimit:]
	}
	h := help.New()
	h.ShowAll = true
	return replModel{help: h, client: c, input: ti, spinner: sp, history: history, histIdx: len(history), dark: dark, lines: []string{
		ui.Gradient("◈ CYBERMANJU / cybsh", ui.CyanNeon, ui.PinkHot),
		ui.Dim.Render("Your terminal. Your vault. Your neon."),
		"",
		ui.Accent.Render("help") + ui.Dim.Render("     discover server commands"),
		ui.Accent.Render("disk list") + ui.Dim.Render("   inspect connected disks"),
		ui.Accent.Render(":help") + ui.Dim.Render("    keyboard and privacy tips"),
		"",
		ui.Dim.Render("Commands run on your dashboard, not Android."),
	}}
}

func applyInputTheme(input *textinput.Model, dark bool) {
	styles := textinput.DefaultDarkStyles()
	if !dark {
		styles = textinput.DefaultLightStyles()
	}
	styles.Focused.Text = ui.Text
	styles.Focused.Prompt = ui.Accent
	input.SetStyles(styles)
}

func (m replModel) Init() tea.Cmd { return textinput.Blink }

func (m *replModel) resize(width, height int) {
	atBottom := !m.ready || m.view.AtBottom()
	oldOffset := m.view.YOffset()
	bottom := m.view
	bottom.GotoBottom()
	gap := bottom.YOffset() - oldOffset
	m.width, m.height = max(1, width), max(1, height)
	// Both the model and compositor use the same viewport dimensions. Full
	// help replaces scrollback temporarily instead of squeezing fixed controls.
	vw, vh := m.width, max(0, m.height-2)
	if m.height >= 4 {
		vh-- // header
	}
	if !m.ready {
		m.view = viewport.New(viewport.WithWidth(vw), viewport.WithHeight(vh))
		m.view.SoftWrap = true
		// The viewport defaults include ordinary letters and space; those
		// belong to the input, never to the pager while editing a command.
		m.view.KeyMap.PageUp.SetKeys("pgup")
		m.view.KeyMap.PageDown.SetKeys("pgdown")
		m.view.KeyMap.Up.SetEnabled(false)
		m.view.KeyMap.Down.SetEnabled(false)
		m.view.KeyMap.Left.SetEnabled(false)
		m.view.KeyMap.Right.SetEnabled(false)
		m.view.KeyMap.HalfPageUp.SetEnabled(false)
		m.view.KeyMap.HalfPageDown.SetEnabled(false)
		m.ready = true
	} else {
		m.view.SetWidth(vw)
		m.view.SetHeight(vh)
	}
	m.view.Style = lipgloss.NewStyle()
	if vw >= 3 && vh >= 3 {
		m.view.Style = m.view.Style.Border(lipgloss.RoundedBorder()).BorderForeground(ui.Dim.GetForeground())
	}
	m.view.SetContent(strings.Join(m.lines, "\n"))
	if atBottom {
		m.view.GotoBottom()
	} else {
		m.view.SetYOffset(oldOffset)
		if m.view.AtBottom() && gap > 0 {
			// A taller/wider view can clamp a reader to the end. Retain their
			// distance from the end rather than silently enabling auto-follow.
			m.view.SetYOffset(max(0, m.view.YOffset()-gap))
		}
	}
	m.input.Prompt = "cybsh › "
	if m.width < 10 {
		m.input.Prompt = "› "
	}
	if m.width < 3 {
		m.input.Prompt = ""
	}
	m.input.SetWidth(max(1, m.width-lipgloss.Width(m.input.Prompt)))
}

// displayViewport reuses Bubbles help bindings, rendered as one wrapped column
// so no controls vanish when Bubbles' multi-column help exceeds the screen.
// Its independent offset lets help scroll without moving the command log.
func (m replModel) displayViewport() viewport.Model {
	v := m.view
	if !m.helpVisible {
		return v
	}
	h := m.help
	h.Styles = help.DefaultStyles(m.dark)
	h.SetWidth(0)
	var bindings []key.Binding
	for _, group := range (replKeys{}).FullHelp() {
		bindings = append(bindings, group...)
	}
	width := max(1, m.width-v.Style.GetHorizontalFrameSize())
	text := h.FullHelpView([][]key.Binding{bindings})
	rows := strings.Split(text, "\n")
	for i := range rows {
		rows[i] = strings.TrimRight(rows[i], " ")
	}
	text = strings.Join(rows, "\n")
	text += "\n\nPrefix a command with a space to keep it out of local history.\nCtrl+C/Esc stop local waiting, not remote work; check jobs before retrying."
	v.SetContent(ansi.Hardwrap(text, width, true))
	v.SetYOffset(m.helpOffset)
	return v
}

func (m replModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.resize(msg.Width, msg.Height)
		return m, nil
	case tea.BackgroundColorMsg:
		m.dark = msg.IsDark()
		ui.SetBackground(m.dark)
		applyInputTheme(&m.input, m.dark)
		m.spinner.Style = ui.Accent
		// Previously colored scrollback must not retain low-contrast ink after
		// a terminal theme switch. Preserve its text, inheriting the new surface.
		for i := range m.lines {
			m.lines[i] = ansi.Strip(m.lines[i])
		}
		if m.ready {
			m.view.SetContent(strings.Join(m.lines, "\n"))
			m.view.Style = m.view.Style.BorderForeground(ui.Dim.GetForeground())
		}
		return m, nil
	case shellResultMsg:
		if msg.id != m.requestID {
			return m, nil
		}
		if m.cancel != nil {
			m.cancel()
			m.cancel = nil
		}
		m.busy = false
		if msg.err != nil {
			m.emit(ui.Err.Render(safeTerminalText(msg.err.Error())))
		} else {
			if msg.response.Output != "" {
				m.emit(safeTerminalText(msg.response.Output))
			}
			if !msg.response.OK {
				errText := msg.response.Error
				if errText == "" {
					errText = "shell command failed"
				}
				m.emit(ui.Err.Render(safeTerminalText(errText)))
			}
		}
		return m, nil
	case spinner.TickMsg:
		if !m.busy {
			return m, nil
		}
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	case tea.KeyPressMsg:
		switch {
		case key.Matches(msg, replCancelBinding):
			if m.busy {
				if m.cancel != nil {
					m.cancel()
					m.cancel = nil
				}
				m.requestID++ // Ignore the eventual response to the cancelled wait.
				m.busy = false
				m.emit(ui.Warn.Render("Stopped waiting; the server command may still be running. Check jobs before retrying."))
				return m, nil
			}
			if m.input.Value() != "" {
				m.input.Reset()
				m.completion = nil
				return m, nil
			}
			return m, tea.Quit
		case key.Matches(msg, replEscBinding):
			if m.helpVisible {
				m.helpVisible = false
				return m, nil
			}
			if m.busy {
				if m.cancel != nil {
					m.cancel()
					m.cancel = nil
				}
				m.requestID++
				m.busy = false
				m.emit(ui.Warn.Render("Stopped waiting; the server command may still be running."))
				return m, nil
			}
			if m.input.Value() != "" {
				m.input.Reset()
				m.completion = nil
				return m, nil
			}
			return m, nil
		case key.Matches(msg, replHelpBinding):
			m.helpVisible = !m.helpVisible
			m.helpOffset = 0
			return m, nil
		case key.Matches(msg, replQuitBinding):
			if m.input.Value() == "" && !m.busy {
				return m, tea.Quit
			}
			return m, nil
		case key.Matches(msg, replBottomBinding):
			if m.helpVisible {
				v := m.displayViewport()
				v.GotoBottom()
				m.helpOffset = v.YOffset()
				return m, nil
			}
			m.view.GotoBottom()
			m.newOutput = false
			return m, nil
		case key.Matches(msg, replScrollBinding):
			v := m.displayViewport()
			v, cmd := v.Update(msg)
			if m.helpVisible {
				m.helpOffset = v.YOffset()
			} else {
				m.view = v
				if v.AtBottom() {
					m.newOutput = false
				}
			}
			return m, cmd
		case key.Matches(msg, replClearBinding):
			m.lines = nil
			m.newOutput = false
			m.completion = nil
			m.view.SetContent("")
			return m, nil
		case key.Matches(msg, replCompletionBinding):
			value := m.input.Value()
			prefix := strings.TrimLeft(value, " ")
			lead := value[:len(value)-len(prefix)]
			cycling := len(m.completion) > 0 && lead == m.completionLead && (prefix == m.completionPrefix || (m.completionIndex < len(m.completion) && prefix == m.completion[m.completionIndex]))
			if !cycling {
				m.completion = nil
				m.completionLead = lead
				m.completionPrefix = prefix
				for _, v := range shellSuggestions {
					if prefix != "" && strings.HasPrefix(v, prefix) && v != prefix {
						m.completion = append(m.completion, v)
					}
				}
				m.completionIndex = 0
				if msg.String() == "shift+tab" && len(m.completion) > 0 {
					m.completionIndex = len(m.completion) - 1
				}
			} else if msg.String() == "shift+tab" {
				m.completionIndex = (m.completionIndex + len(m.completion) - 1) % len(m.completion)
			} else {
				m.completionIndex = (m.completionIndex + 1) % len(m.completion)
			}
			if len(m.completion) > 0 {
				m.input.SetValue(m.completionLead + m.completion[m.completionIndex])
				m.input.CursorEnd()
			}
			return m, nil
		case key.Matches(msg, replRunBinding):
			if m.busy {
				return m, nil
			}
			raw := m.input.Value()
			line := strings.TrimSpace(raw)
			if line == "" {
				return m, nil
			}
			m.input.Reset()
			m.completion = nil
			m.draft = ""
			if !strings.HasPrefix(raw, " ") && !strings.HasPrefix(line, ":") {
				if len(m.history) == 0 || m.history[len(m.history)-1] != line {
					m.history = append(m.history, line)
					if len(m.history) > historyLimit {
						m.history = m.history[1:]
					}
					appendHistoryLine(line)
				}
			}
			m.histIdx = len(m.history)
			switch line {
			case ":quit", ":exit", ":q":
				return m, tea.Quit
			case ":clear":
				m.lines = nil
				m.newOutput = false
				m.completion = nil
				m.view.SetContent("")
				return m, nil
			case ":help":
				m.helpVisible = true
				m.helpOffset = 0
				return m, nil
			}
			m.emit(ui.Accent.Render("› " + safeTerminalText(line)))
			m.busy = true
			m.requestID++
			id := m.requestID
			ctx, cancel := context.WithCancel(context.Background())
			m.cancel = cancel
			c := m.client
			return m, tea.Batch(m.spinner.Tick, func() tea.Msg {
				res, err := c.ExecContext(ctx, line)
				return shellResultMsg{id: id, response: res, err: err}
			})
		case key.Matches(msg, replHistoryBinding) && msg.String() == "up":
			m.completion = nil
			if m.histIdx == len(m.history) {
				m.draft = m.input.Value()
			}
			if m.histIdx > 0 {
				m.histIdx--
				m.input.SetValue(m.history[m.histIdx])
				m.input.CursorEnd()
			}
			return m, nil
		case key.Matches(msg, replHistoryBinding) && msg.String() == "down":
			m.completion = nil
			if m.histIdx < len(m.history) {
				m.histIdx++
				if m.histIdx == len(m.history) {
					m.input.SetValue(m.draft)
				} else {
					m.input.SetValue(m.history[m.histIdx])
				}
				m.input.CursorEnd()
			}
			return m, nil
		}
	}
	var cmd tea.Cmd
	oldValue := m.input.Value()
	m.input, cmd = m.input.Update(msg)
	if m.input.Value() != oldValue {
		m.completion = nil
	}
	return m, cmd
}

// safeTerminalText refuses remote terminal controls (OSC clipboard/title, CSI,
// carriage return, bidi formatting), leaving only printable text, tabs and LF.
func safeTerminalText(text string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, ansi.Strip(text))
}

func (m *replModel) emit(text string) {
	atBottom := m.view.AtBottom()
	offset := m.view.YOffset()
	m.lines = append(m.lines, strings.Split(strings.TrimRight(text, "\n"), "\n")...)
	if len(m.lines) > 500 {
		dropped := len(m.lines) - 500
		width := max(1, m.width-m.view.Style.GetHorizontalFrameSize())
		for _, line := range m.lines[:dropped] {
			offset -= max(1, (ansi.StringWidth(line)+width-1)/width)
		}
		m.lines = m.lines[dropped:]
	}
	m.view.SetContent(strings.Join(m.lines, "\n"))
	if atBottom {
		m.view.GotoBottom()
		m.newOutput = false
	} else {
		m.view.SetYOffset(max(0, offset))
		m.newOutput = true
	}
}

func (m replModel) View() tea.View {
	if !m.ready {
		return tea.NewView(ui.Dim.Render("CUTE CLI · warming up the neon…"))
	}
	input := m.input.View()
	if m.busy {
		label := "waiting for dashboard… Ctrl+C stops waiting"
		if m.width < 48 {
			label = "waiting… ^C stops waiting"
		}
		if m.width < 24 {
			label = "wait · ^C"
		}
		input = m.spinner.View() + " " + ui.Dim.Render(label)
	}
	input = ansi.Truncate(strings.ReplaceAll(strings.ReplaceAll(input, "\n", " "), "\r", " "), m.width, "")
	if m.height == 1 {
		v := tea.NewView(ui.Surface.Width(m.width).MaxWidth(m.width).MaxHeight(1).Render(input))
		v.AltScreen = true
		return v
	}
	footer := ui.ShellFooter(m.width, m.busy)
	if m.newOutput {
		footer = ui.Dim.Render("new output · Ctrl+End latest")
	}
	if m.helpVisible {
		footer = ui.Dim.Render("PgUp/PgDn scroll help · Esc back")
	}
	parts := make([]string, 0, m.height)
	if m.height >= 4 {
		parts = append(parts, ui.ShellHeader(m.width, cliVersion, m.client.BaseURL))
	}
	footer = ansi.Truncate(strings.ReplaceAll(footer, "\n", " "), m.width, "")
	if m.view.Height() > 0 {
		viewport := m.displayViewport()
		parts = append(parts, viewport.View())
	}
	parts = append(parts, input, footer)
	content := strings.Join(parts, "\n")
	v := tea.NewView(ui.Surface.Width(m.width).Height(m.height).MaxWidth(m.width).MaxHeight(m.height).Render(content))
	v.AltScreen = true
	return v
}

var histFile string

func appendHistoryLine(line string) {
	if histFile == "" {
		return
	}
	f, err := os.OpenFile(histFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	if err := f.Chmod(0o600); err != nil {
		return
	}
	_, _ = fmt.Fprintln(f, line)
}

func loadHistory() []string {
	histFile = ""
	path, err := config.HistoryPath()
	if err != nil {
		return nil
	}
	histFile = path
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 4096), 64*1024+1)
	for scanner.Scan() {
		if line := scanner.Text(); strings.TrimSpace(line) != "" {
			out = append(out, line)
			if len(out) > historyLimit {
				out = out[1:]
			}
		}
	}
	return out
}

var replCmd = &cobra.Command{
	Use:     "repl",
	Aliases: []string{"cute", "cybsh"},
	Short:   "CUTE CLI workspace (cybsh, completion, history, responsive neon UI)",
	Args:    cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		if flagJSON {
			return fmt.Errorf("--json is for one-shot commands; use cyb sh --json <line>")
		}
		c := mustClient()
		if err := requireAuth(c); err != nil {
			return err
		}
		history := loadHistory()
		if !term.IsTerminal(int(os.Stdin.Fd())) || !term.IsTerminal(int(os.Stdout.Fd())) {
			return plainRepl(c, history)
		}
		p := tea.NewProgram(newReplModel(c, history), tea.WithColorProfile(ui.ColorProfile()))
		_, err := p.Run()
		return err
	},
}

// plainRepl is a line protocol: no banners, prompts, ANSI or status decorations.
func plainRepl(c *client.Client, history []string) error {
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 4096), 1024*1024)
	for in.Scan() {
		raw := in.Text()
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		switch line {
		case ":quit", ":exit", ":q":
			return nil
		case ":clear":
			continue
		case ":help":
			fmt.Println(":help · :clear · :quit · help (server commands)")
			continue
		}
		if !strings.HasPrefix(raw, " ") {
			appendHistoryLine(line)
		}
		res, err := c.Exec(line)
		if err != nil {
			return err
		}
		if res.Output != "" {
			fmt.Println(safeTerminalText(strings.TrimRight(res.Output, "\n")))
		}
		if !res.OK {
			if res.Error == "" {
				return fmt.Errorf("shell command failed")
			}
			return fmt.Errorf("%s", safeTerminalText(res.Error))
		}
	}
	return in.Err()
}
