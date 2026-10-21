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

type replModel struct {
	client        *client.Client
	view          viewport.Model
	input         textinput.Model
	spinner       spinner.Model
	history       []string
	histIdx       int
	draft         string
	lines         []string
	ready         bool
	width, height int
	busy          bool
	requestID     uint64
	cancel        context.CancelFunc
}

func newReplModel(c *client.Client, history []string) replModel {
	ti := textinput.New()
	ti.Placeholder = "help · Tab completes · :help for keys"
	ti.Prompt = "cybsh › "
	ti.CharLimit = 64 * 1024
	ti.SetSuggestions(shellSuggestions)
	ti.ShowSuggestions = true
	styles := textinput.DefaultDarkStyles()
	styles.Focused.Prompt = ui.Accent
	styles.Focused.Text = lipgloss.NewStyle().Foreground(lipgloss.Color(ui.IceWhite))
	ti.SetStyles(styles)
	ti.Focus()
	sp := spinner.New(spinner.WithSpinner(spinner.Dot), spinner.WithStyle(ui.Accent))
	if len(history) > historyLimit {
		history = history[len(history)-historyLimit:]
	}
	return replModel{client: c, input: ti, spinner: sp, history: history, histIdx: len(history), lines: []string{
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

func (m replModel) Init() tea.Cmd { return textinput.Blink }

func (m *replModel) resize(width, height int) {
	m.width, m.height = max(1, width), max(1, height)
	chrome := lipgloss.Height(ui.ShellHeader(m.width, cliVersion, m.client.BaseURL)) + 2
	vw, vh := m.width, max(1, m.height-chrome)
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
		m.view.Style = m.view.Style.Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color(ui.PinkDeep))
	}
	m.view.SetContent(strings.Join(m.lines, "\n"))
	m.input.SetWidth(max(1, m.width-lipgloss.Width(m.input.Prompt)))
}

func (m replModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.resize(msg.Width, msg.Height)
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
		switch msg.String() {
		case "ctrl+c":
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
				return m, nil
			}
			return m, tea.Quit
		case "esc":
			if m.cancel != nil {
				m.cancel()
			}
			return m, tea.Quit
		case "ctrl+l":
			m.lines = nil
			m.view.SetContent("")
			return m, nil
		case "tab":
			value := m.input.Value()
			for _, suggestion := range shellSuggestions {
				if value != "" && strings.HasPrefix(suggestion, value) && suggestion != value {
					m.input.SetValue(suggestion)
					m.input.CursorEnd()
					break
				}
			}
			return m, nil
		case "enter":
			if m.busy {
				return m, nil
			}
			raw := m.input.Value()
			line := strings.TrimSpace(raw)
			if line == "" {
				return m, nil
			}
			m.input.Reset()
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
				m.view.SetContent("")
				return m, nil
			case ":help":
				m.emit(ui.Accent.Render("CUTE CLI · cybsh") + "\n" +
					"Tab complete · ↑/↓ history · PgUp/PgDn scroll · Ctrl+L clear\n" +
					"Ctrl+C clears input / stops waiting · Esc exits\n" +
					":help · :clear · :quit · help (server commands)\n" +
					"Prefix a command with a space to keep it out of local history.\n" +
					"Commands run on the selected dashboard, not in your Android shell.")
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
		case "up":
			if m.histIdx == len(m.history) {
				m.draft = m.input.Value()
			}
			if m.histIdx > 0 {
				m.histIdx--
				m.input.SetValue(m.history[m.histIdx])
				m.input.CursorEnd()
			}
			return m, nil
		case "down":
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
	var cmds []tea.Cmd
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	cmds = append(cmds, cmd)
	if m.ready {
		m.view, cmd = m.view.Update(msg)
		cmds = append(cmds, cmd)
	}
	return m, tea.Batch(cmds...)
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
	m.lines = append(m.lines, strings.Split(strings.TrimRight(text, "\n"), "\n")...)
	if len(m.lines) > 500 {
		m.lines = m.lines[len(m.lines)-500:]
	}
	m.view.SetContent(strings.Join(m.lines, "\n"))
	m.view.GotoBottom()
}

func (m replModel) View() tea.View {
	if !m.ready {
		return tea.NewView(ui.Dim.Render("CUTE CLI · warming up the neon…"))
	}
	input := m.input.View()
	if m.busy {
		input = m.spinner.View() + " " + ui.Dim.Render("waiting for dashboard… Ctrl+C stops waiting")
	}
	content := ui.ShellHeader(m.width, cliVersion, m.client.BaseURL) + "\n" + m.view.View() + "\n" + input + "\n" + ui.ShellFooter(m.width, m.busy)
	// Final hard bounds also cover software-keyboard resizes and tiny terminals.
	view := tea.NewView(lipgloss.NewStyle().MaxWidth(m.width).MaxHeight(m.height).Render(content))
	view.AltScreen = true
	return view
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
