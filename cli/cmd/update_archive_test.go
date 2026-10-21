// CyberManju OS — Update archive tests (cli/cmd/update_archive_test.go).
// Role: reject unsafe or ambiguous release archives before CLI installation.
// Exports: TestExtractBinaryRequiresUniqueRegularRootExecutable.
// Integrates: archive/tar, compress/gzip, os, runtime, testing.
// Contracts: only one regular platform executable at the archive root is accepted.
package cmd

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestExtractBinaryRequiresUniqueRegularRootExecutable(t *testing.T) {
	name, other := "cyb", "cyb.exe"
	if runtime.GOOS == "windows" {
		name, other = other, name
	}
	type member struct {
		name string
		kind byte
	}
	regular := member{name, tar.TypeReg}
	tests := []struct {
		name        string
		members     []member
		brokenTail  bool
		preexisting bool
		wantErr     bool
	}{
		{name: "root regular", members: []member{regular}},
		{name: "dot root regular", members: []member{{"./" + name, tar.TypeReg}}},
		{name: "legacy regular", members: []member{{name, tar.TypeRegA}}},
		{name: "unrelated metadata", members: []member{{"README", tar.TypeReg}, regular}},
		{name: "missing executable", wantErr: true},
		{name: "wrong platform", members: []member{{other, tar.TypeReg}}, wantErr: true},
		{name: "nested path", members: []member{{"nested/" + name, tar.TypeReg}}, wantErr: true},
		{name: "parent traversal", members: []member{{"../" + name, tar.TypeReg}}, wantErr: true},
		{name: "absolute path", members: []member{{"/" + name, tar.TypeReg}}, wantErr: true},
		{name: "backslash path", members: []member{{"nested\\" + name, tar.TypeReg}}, wantErr: true},
		{name: "symlink", members: []member{{name, tar.TypeSymlink}}, wantErr: true},
		{name: "hardlink", members: []member{{name, tar.TypeLink}}, wantErr: true},
		{name: "directory", members: []member{{name, tar.TypeDir}}, wantErr: true},
		{name: "duplicate", members: []member{regular, regular}, wantErr: true},
		{name: "duplicate root alias", members: []member{regular, {"./" + name, tar.TypeReg}}, wantErr: true},
		{name: "regular then symlink", members: []member{regular, {name, tar.TypeSymlink}}, wantErr: true},
		{name: "truncated header after executable", members: []member{regular}, brokenTail: true, wantErr: true},
		{name: "existing destination", members: []member{regular}, preexisting: true, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			tarball := filepath.Join(dir, "release.tar.gz")
			file, err := os.Create(tarball)
			if err != nil {
				t.Fatal(err)
			}
			gz := gzip.NewWriter(file)
			tw := tar.NewWriter(gz)
			const contents = "release executable bytes"
			for _, m := range tt.members {
				hdr := &tar.Header{Name: m.name, Typeflag: m.kind, Mode: 0o755}
				if m.kind == tar.TypeReg || m.kind == tar.TypeRegA {
					hdr.Size = int64(len(contents))
				}
				if m.kind == tar.TypeLink || m.kind == tar.TypeSymlink {
					hdr.Linkname = "other-file"
				}
				if err := tw.WriteHeader(hdr); err != nil {
					t.Fatal(err)
				}
				if hdr.Size > 0 {
					if _, err := tw.Write([]byte(contents)); err != nil {
						t.Fatal(err)
					}
				}
			}
			if tt.brokenTail {
				if err := tw.Flush(); err != nil {
					t.Fatal(err)
				}
				if _, err := gz.Write([]byte("incomplete next tar header")); err != nil {
					t.Fatal(err)
				}
			} else if err := tw.Close(); err != nil {
				t.Fatal(err)
			}
			if err := gz.Close(); err != nil {
				t.Fatal(err)
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			dest := filepath.Join(dir, name)
			if tt.preexisting {
				if err := os.WriteFile(dest, []byte("existing binary"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			got, err := extractBinary(tarball, dir)
			if tt.wantErr {
				if err == nil || got != "" {
					t.Fatalf("unsafe archive accepted: path=%q err=%v", got, err)
				}
				if tt.preexisting {
					data, readErr := os.ReadFile(dest)
					if readErr != nil || string(data) != "existing binary" {
						t.Fatalf("existing destination changed: data=%q err=%v", data, readErr)
					}
				}
				return
			}
			if err != nil || got != dest {
				t.Fatalf("valid archive rejected: path=%q err=%v", got, err)
			}
			data, err := os.ReadFile(got)
			if err != nil || string(data) != contents {
				t.Fatalf("executable content mismatch: data=%q err=%v", data, err)
			}
		})
	}
}
