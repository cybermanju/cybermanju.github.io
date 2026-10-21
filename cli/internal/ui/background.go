// CyberManju OS — Adaptive terminal surfaces (cli/internal/ui/background.go).
// Role: keep shared terminal chrome readable on dark and light backgrounds.
// Exports: DetectBackground, SetBackground, IsDarkBackground, Text, Surface, SurfaceAlt.
// Integrates: Lipgloss styles, COLORFGBG and Bubble Tea background notifications.
// Contracts: no terminal queries or side effects on stdout; callers apply Downsample.
package ui

import (
	"os"
	"strconv"
	"strings"

	"charm.land/lipgloss/v2"
)

var (
	darkBackground = true
	Text           lipgloss.Style
	Surface        lipgloss.Style
	SurfaceAlt     lipgloss.Style
)

func init() { DetectBackground() }

// DetectBackground uses the terminal's background hint without probing stdin.
// Interactive programs refine this fallback using tea.BackgroundColorMsg; one-shot
// commands never incur an OSC query timeout or consume piped command input.
func DetectBackground() { SetBackground(backgroundIsDark(os.Getenv("COLORFGBG"))) }

func backgroundIsDark(hint string) bool {
	parts := strings.Split(hint, ";")
	n, err := strconv.Atoi(parts[len(parts)-1])
	if err != nil || n < 0 || n > 15 {
		return true
	}
	switch n {
	case 7, 10, 11, 14, 15:
		return false
	default:
		return true
	}
}

// IsDarkBackground reports the current palette, defaulting to dark when unknown.
func IsDarkBackground() bool { return darkBackground }

// adaptiveHex preserves the neon identity while using darker ink on light terminals.
func adaptiveHex(hex string) string {
	if darkBackground {
		switch hex {
		case RedHot:
			return "#FF6673"
		case PinkDeep, RedDeep:
			return "#CF708C"
		case DimGray, "#55555E":
			return "#A2A8BE"
		}
		return hex
	}
	switch hex {
	case PinkHot:
		return "#A51457"
	case PinkDeep, RedDeep:
		return "#972044"
	case RedHot:
		return "#B42318"
	case CyanNeon:
		return "#006773"
	case YellowHz:
		return "#795500"
	case IceWhite:
		return "#202332"
	case DimGray, "#55555E":
		return "#555B70"
	case "#FF7AB8":
		return "#795500"
	}
	return hex
}

func ink(hex string) lipgloss.Style {
	return lipgloss.NewStyle().Foreground(lipgloss.Color(adaptiveHex(hex)))
}

// SetBackground refreshes shared style atoms. Call on the UI event loop only,
// not from background workers. Standalone output keeps the user's own background;
// filled surfaces are reserved for interactive chrome and table row grouping.
func SetBackground(isDark bool) {
	darkBackground = isDark
	Text = ink(IceWhite)
	base, raised := "#11131D", "#202433"
	if !isDark {
		base, raised = "#FAFAFD", "#ECEEF5"
	}
	Surface = Text.Background(lipgloss.Color(base))
	SurfaceAlt = Text.Background(lipgloss.Color(raised))
	Title = ink(PinkHot).Bold(true)
	Accent = Title
	OK = ink(CyanNeon).Bold(true)
	Err = ink(RedHot).Bold(true)
	Warn = ink(YellowHz).Bold(true)
	Dim = ink(DimGray)
	Subtle = Dim
	Number = ink(CyanNeon)
	BadgeCheck, BadgeCross = OK, Err
	Bullet = ink(CyanNeon).Render("▸")
	Panel = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color(adaptiveHex(PinkHot))).Padding(0, 1)
	jsonKey = Title
	jsonStr = Text
	jsonNum = Number
	jsonBool = ink(YellowHz)
	jsonNull = Dim
	jsonDelim = ink(PinkDeep)
	jsonPunct = Dim
}
