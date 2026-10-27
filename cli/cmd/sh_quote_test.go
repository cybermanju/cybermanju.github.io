// CyberManju OS — cyb sh line-building tests (cli/cmd/sh_quote_test.go).
//
// Role: pins how sh arguments become one cybsh line, so the quoting
// regression that silently re-tokenized multi-word arguments (review
// P1-CLI-1) stays fixed.

package cmd

import "testing"

func TestJoinShLineSingleArgStaysVerbatim(t *testing.T) {
	// Dominant usage: one string = the whole line (pipes, flags, &&).
	shRaw = false
	t.Cleanup(func() { shRaw = false })
	got := joinShLine([]string{"disk list --json | head 5"})
	want := `disk list --json | head 5`
	if got != want {
		t.Fatalf("single arg = %q, want %q", got, want)
	}
}

func TestJoinShLineQuotesWhitespaceArgs(t *testing.T) {
	shRaw = false
	t.Cleanup(func() { shRaw = false })
	got := joinShLine([]string{"disk", "cat", `my file.txt`})
	want := `disk cat "my file.txt"`
	if got != want {
		t.Fatalf("multi arg = %q, want %q", got, want)
	}
}

func TestJoinShLineRawDisablesQuoting(t *testing.T) {
	shRaw = true
	t.Cleanup(func() { shRaw = false })
	got := joinShLine([]string{"disk", "cat", `my file.txt`})
	want := `disk cat my file.txt`
	if got != want {
		t.Fatalf("raw = %q, want %q", got, want)
	}
}
