package cmd

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/spf13/cobra"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
	"github.com/cybermanju/cybermanju.github.io/cli/internal/util"
)

const updateRepo = "cybermanju/cybermanju.github.io"

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Self-update cyb from GitHub releases (checksum-verified)",
	RunE: func(cmd *cobra.Command, args []string) error {
		rel, err := latestRelease()
		if err != nil {
			return err
		}
		tag := rel.Tag
		ui.Info("latest release: %s (installed: %s)", tag, cliVersion)
		if cliVersion != "dev" && util.CompareVersions(tag, cliVersion) <= 0 {
			ui.Success("already up to date")
			return nil
		}
		asset := util.AssetName(runtime.GOOS, runtime.GOARCH)
		var assetURL, sumsURL string
		for _, a := range rel.Assets {
			switch a.Name {
			case asset:
				assetURL = a.URL
			case "SHA256SUMS.txt":
				sumsURL = a.URL
			}
		}
		if assetURL == "" {
			return fmt.Errorf("not_found: release %s ships no %s", tag, asset)
		}
		if !flagYes {
			var ok bool
			form := huh.NewForm(huh.NewGroup(
				huh.NewConfirm().Title(fmt.Sprintf("Install %s %s?", "cyb", tag)).Value(&ok),
			)).WithShowHelp(false)
			if err := form.Run(); err != nil {
				return err
			}
			if !ok {
				return fmt.Errorf("aborted")
			}
		}
		tmp, err := os.MkdirTemp("", "cyb-update")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmp)
		tarball := filepath.Join(tmp, asset)
		if err := ui.SpinWhile("Downloading "+asset+"…", func() error {
			return downloadFile(assetURL, tarball)
		}); err != nil {
			return err
		}
		if sumsURL != "" {
			sumsFile := filepath.Join(tmp, "SHA256SUMS.txt")
			if err := downloadFile(sumsURL, sumsFile); err == nil {
				if err := verifyChecksum(sumsFile, tarball, asset); err != nil {
					return fmt.Errorf("integrity: %w", err)
				}
				ui.Success("checksum verified")
			}
		}
		bin, err := extractBinary(tarball, tmp)
		if err != nil {
			return err
		}
		self, err := os.Executable()
		if err != nil {
			return err
		}
		self, err = filepath.EvalSymlinks(self)
		if err != nil {
			return err
		}
		backup := self + ".bak"
		os.Remove(backup)
		if err := os.Rename(self, backup); err != nil {
			return fmt.Errorf("cannot replace %s: %w", self, err)
		}
		if err := os.Rename(bin, self); err != nil {
			os.Rename(backup, self)
			return fmt.Errorf("install failed (rolled back): %w", err)
		}
		os.Remove(backup)
		ui.Success("cyb updated to %s — restart your shell sessions as needed", tag)
		return nil
	},
}

type ghAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

type ghRelease struct {
	Tag    string    `json:"tag_name"`
	Assets []ghAsset `json:"assets"`
}

func latestRelease() (ghRelease, error) {
	var rel ghRelease
	req, _ := http.NewRequest("GET", "https://api.github.com/repos/"+updateRepo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return rel, fmt.Errorf("network: cannot reach api.github.com: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return rel, fmt.Errorf("network: GitHub API %d", res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(&rel); err != nil {
		return rel, err
	}
	return rel, nil
}

func downloadFile(url, dest string) error {
	res, err := http.Get(url) //nolint:gosec // release artifact download
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("network: download %d", res.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, res.Body)
	return err
}

func verifyChecksum(sumsFile, tarball, asset string) error {
	raw, err := os.ReadFile(sumsFile)
	if err != nil {
		return err
	}
	var want string
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && (fields[1] == asset || strings.HasSuffix(fields[1], "/"+asset)) {
			want = fields[0]
			break
		}
	}
	if want == "" {
		return fmt.Errorf("no checksum entry for %s", asset)
	}
	f, err := os.Open(tarball)
	if err != nil {
		return err
	}
	defer f.Close()
	sum := sha256.New()
	if _, err := io.Copy(sum, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(sum.Sum(nil)); got != want {
		return fmt.Errorf("checksum mismatch for %s", asset)
	}
	return nil
}

func extractBinary(tarball, dir string) (string, error) {
	f, err := os.Open(tarball)
	if err != nil {
		return "", err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		base := filepath.Base(hdr.Name)
		if base != "cyb" && base != "cyb.exe" {
			continue
		}
		dest := filepath.Join(dir, base)
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return "", err
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			return "", err
		}
		out.Close()
		return dest, nil
	}
	return "", fmt.Errorf("integrity: tarball contains no cyb binary")
}

func init() {
	rootCmd.AddCommand(updateCmd)
}
