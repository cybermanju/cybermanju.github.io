// CyberManju OS — Context tests (cli/internal/client/context_test.go).
// Role: verify cybsh request cancellation without implying remote job abortion.
// Exports: TestExecContextCancellation.
// Integrates: context, httptest and Client.ExecContext.
// Contracts: cancellation must release the HTTP wait and return context.Canceled.
package client

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestExecContextCancellation(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer srv.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := New(srv.URL, "token", 5*time.Second).ExecContext(ctx, "disk list"); result <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request never started")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("want context.Canceled, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancel did not release HTTP wait")
	}
}
