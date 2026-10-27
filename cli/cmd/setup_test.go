// CyberManju OS — Setup test (cli/cmd/setup_test.go).
// Role: protect repeated setup backend selection and profile preservation.
// Exports: TestSetupTargetChoices, TestSetupTargetForBackend, TestWithSupabaseBackend.
// Integrates: testing, internal/config.
// Contracts: Termux exposes remote, PRoot-Distro and Supabase choices; saved profile state is preserved.
package cmd

import (
	"reflect"
	"testing"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/config"
)

func TestSetupTargetChoices(t *testing.T) {
	want := []setupTarget{setupTargetDashboard, setupTargetDocker, setupTargetLimited}
	if got := setupTargetChoices("android"); !reflect.DeepEqual(got, want) {
		t.Fatalf("android setup choices = %v, want %v", got, want)
	}
	want = []setupTarget{setupTargetDashboard, setupTargetDocker, setupTargetNative, setupTargetLimited}
	if got := setupTargetChoices("linux"); !reflect.DeepEqual(got, want) {
		t.Fatalf("linux setup choices = %v, want %v", got, want)
	}
}

func TestSetupTargetForBackend(t *testing.T) {
	for backend, want := range map[string]setupTarget{
		config.BackendRemote:   setupTargetDashboard,
		config.BackendDocker:   setupTargetDocker,
		config.BackendNative:   setupTargetNative,
		config.BackendSupabase: setupTargetLimited,
	} {
		if got := setupTargetForBackend(backend); got != want {
			t.Errorf("setupTargetForBackend(%q) = %q, want %q", backend, got, want)
		}
	}
}

func TestWithSupabaseBackendPreservesProfile(t *testing.T) {
	original := config.File{
		Server: "https://dashboard.example",
		Token:  "dashboard-session",
		Backend: config.Backend{
			Type: config.BackendRemote,
		},
		Supa: &config.SupaSession{AccessToken: "existing-supa-session"},
	}
	got, err := withSupabaseBackend(original, " https://project.supabase.co/ ", " anon-key ")
	if err != nil {
		t.Fatal(err)
	}
	if got.Backend.Type != config.BackendSupabase {
		t.Fatalf("backend = %q, want %q", got.Backend.Type, config.BackendSupabase)
	}
	if got.Server != original.Server || got.Token != original.Token {
		t.Fatalf("dashboard profile fields were lost: %#v", got)
	}
	if got.Supa == nil || got.Supa.URL != "https://project.supabase.co/" || got.Supa.Key != "anon-key" {
		t.Fatalf("Supabase pair not stored correctly: %#v", got.Supa)
	}
	if got.Supa.AccessToken != "existing-supa-session" {
		t.Fatalf("existing Supabase session was lost: %#v", got.Supa)
	}
}

func TestWithSupabaseBackendRequiresCompletePair(t *testing.T) {
	for _, tc := range []struct{ url, key string }{{"", "anon"}, {"https://project.supabase.co", ""}, {" ", "anon"}} {
		if _, err := withSupabaseBackend(config.File{}, tc.url, tc.key); err == nil {
			t.Fatalf("withSupabaseBackend(%q, %q) should fail", tc.url, tc.key)
		}
	}
}
