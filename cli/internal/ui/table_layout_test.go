// CyberManju OS — Table layout regressions (cli/internal/ui/table_layout_test.go).
// Role: protect bounded readable table and record layouts on mobile terminals.
// Exports: TestRenderTable*.
// Integrates: Lipgloss display widths and the shared rendering layer.
// Contracts: preserve columns, source values, Unicode graphemes and caller inputs.
package ui

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
)

func TestRenderTableWidthPreservesColumnsWhenStacked(t *testing.T) {
	preserveTheme(t)
	lipgloss.Writer.Profile = colorprofile.NoTTY
	out := RenderTableWidth(10, []string{"ID", "Name", "Status"}, [][]string{{"x1", "vault", "ready"}})
	plain := Downsample(out)
	for _, want := range []string{"ID", "Name", "Status", "vault", "ready"} {
		if !strings.Contains(plain, want) {
			t.Errorf("narrow output omitted %q: %q", want, plain)
		}
	}
	if w := lipgloss.Width(plain); w > 10 {
		t.Errorf("narrow output width %d > 10: %q", w, plain)
	}
}

func TestRenderTableWidthUnicodeAndVisibleTruncation(t *testing.T) {
	preserveTheme(t)
	lipgloss.Writer.Profile = colorprofile.NoTTY
	out := Downsample(RenderTableWidth(12, []string{"地区", "NAME"}, [][]string{{"東京", "🧑‍💻-long-name"}}))
	for _, line := range strings.Split(out, "\n") {
		if lipgloss.Width(line) > 12 {
			t.Errorf("line exceeds width: %q (%d)", line, lipgloss.Width(line))
		}
	}
	if !strings.Contains(out, "…") {
		t.Errorf("expected visible truncation: %q", out)
	}
}

func TestRenderTableWidthSanitizesMultilineAndANSI(t *testing.T) {
	preserveTheme(t)
	lipgloss.Writer.Profile = colorprofile.NoTTY
	out := Downsample(RenderTableWidth(30, []string{"VALUE"}, [][]string{{"first\nsecond\x1b[31mRED\x1b[0m\x00"}}))
	if strings.Contains(out, "\x1b") || strings.Contains(out, "\x00") || strings.Contains(out, "\nsecond") {
		t.Fatalf("unsafe/unflattened cell: %q", out)
	}
	if !strings.Contains(out, "first secondRED") {
		t.Fatalf("cell content not retained: %q", out)
	}
}

func TestRenderTableWidthRaggedAndEmptyInputs(t *testing.T) {
	preserveTheme(t)
	lipgloss.Writer.Profile = colorprofile.NoTTY
	for _, tc := range []struct {
		name    string
		headers []string
		rows    [][]string
	}{
		{"no data", nil, nil}, {"no headers", nil, [][]string{{"one", "two"}}},
		{"ragged", []string{"A", "B"}, [][]string{{"only-a"}, {"a", "b", "extra"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for width := 1; width <= 24; width++ {
				out := Downsample(RenderTableWidth(width, tc.headers, tc.rows))
				for _, line := range strings.Split(out, "\n") {
					if lipgloss.Width(line) > width {
						t.Errorf("width %d line overflow: %q", width, line)
					}
				}
			}
		})
	}
}

func TestRenderTableDoesNotMutateInputs(t *testing.T) {
	preserveTheme(t)
	lipgloss.Writer.Profile = colorprofile.NoTTY
	headers := []string{"A", "B"}
	rows := [][]string{{"one", "two"}, {"three"}}
	beforeH := append([]string(nil), headers...)
	beforeR := [][]string{append([]string(nil), rows[0]...), append([]string(nil), rows[1]...)}
	_ = RenderTableWidth(4, headers, rows)
	if strings.Join(headers, "|") != strings.Join(beforeH, "|") {
		t.Fatalf("headers mutated: %#v", headers)
	}
	for i := range rows {
		if strings.Join(rows[i], "|") != strings.Join(beforeR[i], "|") {
			t.Fatalf("row %d mutated: %#v", i, rows[i])
		}
	}
}

func TestRenderTablePreservesSignificantSpacesAndGraphemes(t *testing.T) {
	preserveTheme(t)
	lipgloss.Writer.Profile = colorprofile.NoTTY
	name := "  notes  final.md"
	out := stripANSI(RenderTableWidth(80, []string{"NAME"}, [][]string{{name}}))
	if !strings.Contains(out, name) {
		t.Fatalf("filename spaces changed: %q", out)
	}
	if got := truncateCell("👨‍👩‍👧‍👦report", 4); got != "👨‍👩‍👧‍👦r…" {
		t.Fatalf("truncation broke a grapheme: %q", got)
	}
	if got := cleanTableCell("safe\x1b]52;c;clipboard\a\x1bPsecret\x1b\\\u202Etext"); got != "safetext" {
		t.Fatalf("terminal controls leaked: %q", got)
	}
	for _, width := range []int{1, 2, 8, 20} {
		out := RenderTableWidth(width, []string{"Long identifier", "Status"}, nil)
		if out == "" || lipgloss.Width(out) > width {
			t.Fatalf("empty table headers lost or overflowed at %d: %q", width, out)
		}
	}
}
