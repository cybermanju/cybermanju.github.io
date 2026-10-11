package ui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// CyberManju Charm palette — hot pink into signal red on near-black,
// with cyberpunk neon cyan + hazard yellow accents.
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

// Gradient blends text per-rune from colorA to colorB (hex "#RRGGBB").
// Pure function — safe everywhere, including pipes.
func Gradient(text, colorA, colorB string) string {
	runes := []rune(text)
	if len(runes) == 0 {
		return ""
	}
	ra, ga, ba, errA := hexRGB(colorA)
	rb, gb, bb, errB := hexRGB(colorB)
	if errA != nil || errB != nil {
		return text
	}
	var b strings.Builder
	for i, r := range runes {
		t := 0.0
		if len(runes) > 1 {
			t = float64(i) / float64(len(runes)-1)
		}
		c := lipgloss.Color(fmt.Sprintf("#%02X%02X%02X",
			lerp(ra, rb, t), lerp(ga, gb, t), lerp(ba, bb, t)))
		b.WriteString(lipgloss.NewStyle().Foreground(c).Render(string(r)))
	}
	return b.String()
}

func lerp(a, b uint8, t float64) uint8 {
	return uint8(float64(a)*(1-t) + float64(b)*t)
}

func hexRGB(s string) (uint8, uint8, uint8, error) {
	var r, g, b uint8
	_, err := fmt.Sscanf(strings.TrimPrefix(s, "#"), "%02X%02X%02X", &r, &g, &b)
	if err != nil {
		_, err = fmt.Sscanf(strings.TrimPrefix(s, "#"), "%02x%02x%02x", &r, &g, &b)
	}
	return r, g, b, err
}

// CharmTheme is the Huh form theme: pink focus, red accents.
func CharmTheme() *huh.Theme {
	t := huh.ThemeCharm()
	pink := lipgloss.Color(PinkHot)
	red := lipgloss.Color(RedHot)
	t.Focused.Title = t.Focused.Title.Foreground(pink).Bold(true)
	t.Focused.Description = t.Focused.Description.Foreground(pink)
	t.Focused.Base = t.Focused.Base.BorderForeground(pink)
	t.Focused.SelectSelector = t.Focused.SelectSelector.Foreground(red)
	t.Focused.NextIndicator = t.Focused.NextIndicator.Foreground(red)
	t.Focused.PrevIndicator = t.Focused.PrevIndicator.Foreground(red)
	t.Focused.Option = t.Focused.Option.Foreground(lipgloss.Color(IceWhite))
	t.Focused.MultiSelectSelector = t.Focused.MultiSelectSelector.Foreground(red)
	return t
}

// NewForm builds a Huh form in the CyberManju Charm theme.
func NewForm(groups ...*huh.Group) *huh.Form {
	return huh.NewForm(groups...).WithTheme(CharmTheme()).WithShowHelp(false)
}

// Logo is the cyberpunk mark: gradient blades over the wordmark.
func Logo() string {
	blades := Gradient("/// CYBERMANJU_OS v1", CyanNeon, PinkHot)
	word := Gradient("◈ cyb", PinkHot, RedHot)
	return blades + "\n" + word
}

// Rule renders a deterministic neon divider (pink/cyan segments).
func Rule(width int) string {
	if width < 8 {
		width = 8
	}
	if width > 80 {
		width = 80
	}
	pink := lipgloss.NewStyle().Foreground(lipgloss.Color(PinkHot)).Render(strings.Repeat("━", width/2))
	cyan := lipgloss.NewStyle().Foreground(lipgloss.Color(CyanNeon)).Render(strings.Repeat("━", width-width/2))
	return pink + cyan
}

// Splash is the setup/boot header: logo + tagline + rule.
func Splash(version string) string {
	return Logo() + "  " + Dim.Render("v"+strings.TrimPrefix(version, "v")) + "\n" +
		Dim.Render("your vault · your cloud · your terminal") + "\n" +
		Rule(48)
}
