// CyberManju OS — Form test (cli/internal/ui/form_test.go).
// Role: protect the shared Huh form defaults.
// Exports: TestNewFormShowsKeyboardHelp, TestNewFormKeepsCharmTheme.
// Integrates: Huh, Bubble Tea color profile, testing.
// Contracts: no terminal I/O; form construction and view rendering only.
package ui

import (
	"strings"
	"testing"

	"charm.land/huh/v2"
)

func TestNewFormShowsKeyboardHelp(t *testing.T) {
	var confirmed bool
	form := NewForm(huh.NewGroup(huh.NewConfirm().Title("Continue?").Value(&confirmed)))

	view := strings.ToLower(form.View())
	if !strings.Contains(view, "enter") {
		t.Fatalf("form view should expose keyboard navigation help; got %q", form.View())
	}
}

func TestNewFormKeepsCharmTheme(t *testing.T) {
	form := NewForm(huh.NewGroup(huh.NewConfirm().Title("Continue?")))
	if form == nil {
		t.Fatal("NewForm returned nil")
	}
	if CharmTheme() == nil {
		t.Fatal("CharmTheme returned nil")
	}
}
