// CyberManju OS — Theme (cli/internal/ui/theme.go).
// Role: one adaptive neon identity for terminal headers, forms and shared atoms.
// Exports: palette constants, Gradient, CharmTheme, NewForm, Logo, Rule, Splash,
// Number, Subtle, BadgeCheck, BadgeCross, Badge, Flag, Chip, Key, Bullet, List,
// PanelTitled, NextSteps and StatusDot.
// Integrates: Lipgloss, Huh, Bubble Tea and shared background-aware surfaces.
// Contracts: pure rendering; output boundaries downsample for pipes and --no-color.
package ui

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"
)

const (
	PinkHot  = "#FF5FA2"
	PinkDeep = "#C9184A"
	RedHot   = "#FF2222"
	RedDeep  = "#8D0801"
	CyanNeon = "#00F0FF"
	YellowHz = "#FFE600"
	IceWhite = "#FFF0F5"
	DimGray  = "#8A8A93"
)

// Gradient blends text per-rune, adapting branded endpoints to the terminal.
func Gradient(text, colorA, colorB string) string {
	runes := []rune(text)
	if len(runes) == 0 {
		return ""
	}
	ra, ga, ba, errA := hexRGB(adaptiveHex(colorA))
	rb, gb, bb, errB := hexRGB(adaptiveHex(colorB))
	if errA != nil || errB != nil {
		return text
	}
	var b strings.Builder
	for i, r := range runes {
		t := 0.0
		if len(runes) > 1 {
			t = float64(i) / float64(len(runes)-1)
		}
		c := lipgloss.Color(fmt.Sprintf("#%02X%02X%02X", lerp(ra, rb, t), lerp(ga, gb, t), lerp(ba, bb, t)))
		b.WriteString(lipgloss.NewStyle().Foreground(c).Render(string(r)))
	}
	return b.String()
}

func lerp(a, b uint8, t float64) uint8 { return uint8(float64(a)*(1-t) + float64(b)*t) }

func hexRGB(s string) (uint8, uint8, uint8, error) {
	var r, g, b uint8
	_, err := fmt.Sscanf(strings.TrimPrefix(s, "#"), "%02X%02X%02X", &r, &g, &b)
	if err != nil {
		_, err = fmt.Sscanf(strings.TrimPrefix(s, "#"), "%02x%02x%02x", &r, &g, &b)
	}
	return r, g, b, err
}

// CharmTheme adapts focused form text as well as borders to Huh's background.
func CharmTheme() huh.Theme {
	return huh.ThemeFunc(func(isDark bool) *huh.Styles {
		t := huh.ThemeCharm(isDark)
		choose := lipgloss.LightDark(isDark)
		pink := choose(lipgloss.Color("#A51457"), lipgloss.Color(PinkHot))
		red := choose(lipgloss.Color("#B42318"), lipgloss.Color("#FF6673"))
		text := choose(lipgloss.Color("#202332"), lipgloss.Color(IceWhite))
		t.Focused.Title = t.Focused.Title.Foreground(pink).Bold(true)
		t.Focused.Description = t.Focused.Description.Foreground(choose(lipgloss.Color("#555B70"), lipgloss.Color("#A2A8BE")))
		t.Focused.Base = t.Focused.Base.BorderForeground(pink)
		t.Focused.SelectSelector = t.Focused.SelectSelector.Foreground(red)
		t.Focused.NextIndicator = t.Focused.NextIndicator.Foreground(red)
		t.Focused.PrevIndicator = t.Focused.PrevIndicator.Foreground(red)
		t.Focused.Option = t.Focused.Option.Foreground(text)
		t.Focused.MultiSelectSelector = t.Focused.MultiSelectSelector.Foreground(red)
		return t
	})
}

// NewForm keeps every form on the same color/no-color profile.
func NewForm(groups ...*huh.Group) *huh.Form {
	return huh.NewForm(groups...).WithTheme(CharmTheme()).WithShowHelp(false).
		WithProgramOptions(tea.WithColorProfile(ColorProfile()))
}

func Logo() string {
	return Gradient("/// CYBERMANJU_OS", CyanNeon, PinkHot) + "\n" + Gradient("◈ cyb", PinkHot, RedHot)
}

func Rule(width int) string {
	if width < 1 {
		return ""
	}
	width = min(width, 80)
	return ink(PinkHot).Render(strings.Repeat("━", width/2)) + ink(CyanNeon).Render(strings.Repeat("━", width-width/2))
}

func Splash(version string) string {
	width := TermWidth()
	return wrapStyled(Logo()+"  "+Dim.Render("v"+strings.TrimPrefix(version, "v")), width) + "\n" +
		wrapStyled(Dim.Render("your vault · your cloud · your terminal"), width) + "\n" + Rule(min(48, width))
}

var (
	Number     = lipgloss.NewStyle().Foreground(lipgloss.Color(CyanNeon))
	Subtle     = lipgloss.NewStyle().Foreground(lipgloss.Color(DimGray))
	BadgeCheck = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(CyanNeon))
	BadgeCross = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color(RedHot))
	Bullet     = lipgloss.NewStyle().Foreground(lipgloss.Color(CyanNeon)).Render("▸")
)

func Badge(ok bool) string {
	if ok {
		return BadgeCheck.Render("✓")
	}
	return BadgeCross.Render("✗")
}

func Flag(text string) string { return ink(PinkHot).Render("‹" + text + "›") }
func Chip(text string) string { return ink(PinkHot).Render("`" + text + "`") }
func Key(text string) string {
	return ink(CyanNeon).Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color(adaptiveHex(CyanNeon))).Padding(0, 1).Render(text)
}

func List(items ...string) string {
	var lines []string
	for _, item := range items {
		lines = append(lines, Bullet+" "+item)
	}
	return strings.Join(lines, "\n")
}

// PanelTitled wraps body text inside the frame, rather than clipping long notes.
func PanelTitled(title, body string) string {
	width := TermWidth()
	head := wrapStyled(Title.Render("◈ "+title), width)
	if width < 8 {
		return head + "\n" + wrapStyled(body, width)
	}
	return head + "\n" + Panel.Width(width-2).Render(wrapStyled(body, width-4))
}

func NextSteps(title string, steps ...[2]string) string {
	var lines []string
	for _, step := range steps {
		lines = append(lines, Accent.Underline(true).Render(step[0])+"  "+Dim.Render(step[1]))
	}
	return PanelTitled(title, strings.Join(lines, "\n"))
}

func StatusDot(ok bool) string {
	if ok {
		return ink(CyanNeon).Render("●")
	}
	return ink(RedHot).Render("●")
}
