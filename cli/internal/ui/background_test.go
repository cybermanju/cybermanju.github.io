// CyberManju OS — Adaptive layout tests (cli/internal/ui/background_test.go).
// Role: protect readable surfaces, responsive details and machine-output contracts.
// Exports: TestBackground*, TestAdaptive*, TestDetail*.
// Integrates: Lipgloss profiles, ANSI widths and JSON decoding.
// Contracts: restore process-global theme state after each test.
package ui

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
)

func preserveTheme(t *testing.T) {
	t.Helper()
	dark, profile := IsDarkBackground(), ColorProfile()
	t.Cleanup(func() { SetBackground(dark); lipgloss.Writer.Profile = profile })
}

func TestBackgroundHints(t *testing.T) {
	for hint, want := range map[string]bool{
		"": true, "invalid": true, "15;0": true, "0;15": false,
		"0;7": false, "15;8": true, "0;9": true, "0;10": false,
		"0;11": false, "0;12": true, "0;13": true, "0;14": false,
		"0;255": true, "0;-1": true,
	} {
		if got := backgroundIsDark(hint); got != want {
			t.Errorf("%q: got %v want %v", hint, got, want)
		}
	}
	preserveTheme(t)
	t.Setenv("COLORFGBG", "0;15")
	DetectBackground()
	if IsDarkBackground() {
		t.Fatal("light terminal hint ignored")
	}
}

func TestAdaptivePaletteContrast(t *testing.T) {
	preserveTheme(t)
	luminance := func(hex string) float64 {
		r, g, b, err := hexRGB(hex)
		if err != nil {
			t.Fatal(err)
		}
		linear := func(c uint8) float64 {
			v := float64(c) / 255
			if v <= 0.04045 {
				return v / 12.92
			}
			return math.Pow((v+0.055)/1.055, 2.4)
		}
		return 0.2126*linear(r) + 0.7152*linear(g) + 0.0722*linear(b)
	}
	for _, dark := range []bool{true, false} {
		SetBackground(dark)
		backgrounds := []string{"#11131D", "#202433", "#000000"}
		if !dark {
			backgrounds = []string{"#FAFAFD", "#ECEEF5", "#FFFFFF"}
		}
		for _, bg := range backgrounds {
			for _, fg := range []string{PinkHot, RedHot, CyanNeon, YellowHz, IceWhite, DimGray, PinkDeep} {
				a, b := luminance(adaptiveHex(fg)), luminance(bg)
				if a < b {
					a, b = b, a
				}
				if ratio := (a + 0.05) / (b + 0.05); ratio < 4.5 {
					t.Errorf("dark=%v ink=%s bg=%s contrast %.2f below 4.5", dark, adaptiveHex(fg), bg, ratio)
				}
			}
		}
	}
}

func TestAdaptivePlainJSONKeepsValues(t *testing.T) {
	preserveTheme(t)
	const raw = `{"id":"00001234","size":9007199254740993,"ok":false,"value":null}`
	for _, dark := range []bool{true, false} {
		SetBackground(dark)
		lipgloss.Writer.Profile = colorprofile.NoTTY
		out, ok := RenderJSON([]byte(raw))
		if !ok {
			t.Fatal("JSON rejected")
		}
		plain := Downsample(out)
		if strings.Contains(plain, "\x1b") || !json.Valid([]byte(plain)) {
			t.Fatalf("not plain valid JSON: %q", plain)
		}
		if !strings.Contains(plain, "9007199254740993") || !strings.Contains(plain, `"00001234"`) {
			t.Fatal("JSON data changed")
		}
		for _, builder := range []string{ShellHeader(40, "1", "https://example.test"), ShellFooter(40, false), Surface.Render("body"), SurfaceAlt.Render("row")} {
			if strings.Contains(Downsample(builder), "\x1b") {
				t.Fatal("plain output leaked terminal controls")
			}
		}
	}
}

func TestDetailLayoutsRetainTextAndBounds(t *testing.T) {
	preserveTheme(t)
	pairs := [][2]string{{"Endpoint", "https://example.test/a/long/path"}, {"State", "ready\nnext line"}, {"", "value"}}
	compact := func(s string) string { return strings.Join(strings.Fields(ansi.Strip(s)), "") }
	var want string
	for _, p := range pairs {
		want += compact(p[0] + p[1])
	}
	for _, width := range []int{1, 2, 8, 20, 32, 40, 80, 100} {
		out := RenderKVWidth(width, pairs...)
		if lipgloss.Width(out) > width {
			t.Fatalf("detail width %d exceeded: %q", width, out)
		}
		if compact(out) != want {
			t.Fatalf("detail values lost at %d: %q", width, out)
		}
	}
	if RenderKVWidth(20) != "" {
		t.Fatal("empty details must be empty")
	}
}

func TestAdaptiveStylesAndFormsFollowBackground(t *testing.T) {
	preserveTheme(t)
	SetBackground(true)
	dark := Text.Render("body")
	SetBackground(false)
	lipgloss.Writer.Profile = colorprofile.TrueColor
	if GlamourStyle() != "light" {
		t.Fatal("Markdown must use a light-background stylesheet")
	}
	if Text.Render("body") == dark {
		t.Fatal("body ink did not adapt")
	}
	form := CharmTheme()
	if form.Theme(true).Focused.Option.Render("option") == form.Theme(false).Focused.Option.Render("option") {
		t.Fatal("form option ink did not adapt")
	}
	for _, width := range []int{0, 1, 2, 8, 20, 80} {
		if lipgloss.Width(Rule(width)) > width {
			t.Fatalf("divider overflows %d", width)
		}
	}
}
