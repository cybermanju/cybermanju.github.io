// CyberManju OS — Android installer (cli/cmd/android.go).
// Role: download the latest signed Android APK from CI or a GitHub release and offer platform install.
// Exports: none.
// Integrates: GitHub Actions/Release APIs, ZIP, SHA-256, Termux, adb, ui.
// Contracts: install only a signed arm64 APK; verify CI archive digest or release SHA-256 before use.
package cmd

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/cybermanju/cybermanju.github.io/cli/internal/ui"
)

const githubAPI = "https://api.github.com"

var androidDownloadOnly bool

type androidWorkflowRuns struct {
	Runs []struct {
		ID         int64  `json:"id"`
		Branch     string `json:"head_branch"`
		Event      string `json:"event"`
		Conclusion string `json:"conclusion"`
	} `json:"workflow_runs"`
}

type androidRunArtifacts struct {
	Artifacts []struct {
		Name               string `json:"name"`
		Expired            bool   `json:"expired"`
		Digest             string `json:"digest"`
		ArchiveDownloadURL string `json:"archive_download_url"`
	} `json:"artifacts"`
}

var androidCmd = &cobra.Command{
	Use:   "android",
	Short: "Download and install the latest Android app",
}

var androidInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Download the latest signed arm64 APK and open or install it",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		apkPath, source, err := downloadLatestAndroidAPK()
		if err != nil {
			return err
		}
		ui.Success("downloaded Android APK from %s: %s", source, apkPath)
		if androidDownloadOnly {
			return nil
		}
		if runtime.GOOS == "android" {
			if opener, err := exec.LookPath("termux-open"); err == nil {
				if out, openErr := exec.Command(opener, apkPath).CombinedOutput(); openErr != nil {
					return fmt.Errorf("APK is saved at %s, but termux-open failed: %v\n%s", apkPath, openErr, out)
				}
				ui.Info("complete the installation in Android's package installer")
				return nil
			}
			ui.Hint("APK saved at %s; install Termux tools or open the file from Android", apkPath)
			return nil
		}
		adb, err := exec.LookPath("adb")
		if err != nil {
			ui.Hint("APK saved at %s; install Android platform-tools and connect a device to use `adb install -r %s`", apkPath, apkPath)
			return nil
		}
		install := exec.Command(adb, "install", "-r", apkPath)
		install.Stdout, install.Stderr = os.Stdout, os.Stderr
		if err := install.Run(); err != nil {
			return fmt.Errorf("APK is saved at %s, but adb install failed: %w", apkPath, err)
		}
		ui.Success("Android app installed with adb")
		return nil
	},
}

func downloadLatestAndroidAPK() (string, string, error) {
	dir, err := androidDownloadDir()
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", err
	}
	tmp, err := os.MkdirTemp("", "cyb-android-apk-")
	if err != nil {
		return "", "", err
	}
	defer os.RemoveAll(tmp)

	artifact, err := latestSuccessfulAndroidArtifact()
	if err == nil {
		archive := filepath.Join(tmp, "dist-android.zip")
		ui.Info("downloading Android APK from successful CI run %d…", artifact.runID)
		if _, downloadErr := ui.Download(artifact.url, archive); downloadErr != nil {
			return "", "", fmt.Errorf("network: cannot download CI Android artifact: %w", downloadErr)
		}
		if err := verifyFileDigest(archive, artifact.digest); err != nil {
			return "", "", fmt.Errorf("integrity: CI Android artifact: %w", err)
		}
		apkPath, err := extractAndroidAPK(archive, dir)
		if err != nil {
			return "", "", err
		}
		return apkPath, fmt.Sprintf("CI run %d", artifact.runID), nil
	}
	ui.Warning("no usable signed CI Android artifact found (%v); checking the latest release", err)
	return downloadReleaseAndroidAPK(dir, tmp)
}

type androidArtifactDownload struct {
	runID int64
	url   string
	digest string
}

func latestSuccessfulAndroidArtifact() (androidArtifactDownload, error) {
	var found androidArtifactDownload
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 25 * time.Second}
	requestURL := githubAPI + "/repos/" + updateRepo + "/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=50"
	var runs androidWorkflowRuns
	if err := getGitHubJSON(ctx, client, requestURL, &runs); err != nil {
		return found, err
	}
	checked := 0
	for _, run := range runs.Runs {
		if run.Branch != "main" || run.Event != "push" || run.Conclusion != "success" {
			continue
		}
		if checked >= 20 {
			break
		}
		checked++
		url := fmt.Sprintf("%s/repos/%s/actions/runs/%d/artifacts?name=dist-android&per_page=100", githubAPI, updateRepo, run.ID)
		var artifacts androidRunArtifacts
		if err := getGitHubJSON(ctx, client, url, &artifacts); err != nil {
			continue
		}
		for _, artifact := range artifacts.Artifacts {
			if artifact.Name != "dist-android" || artifact.Expired || artifact.ArchiveDownloadURL == "" || !validArtifactDigest(artifact.Digest) {
				continue
			}
			return androidArtifactDownload{runID: run.ID, url: artifact.ArchiveDownloadURL, digest: artifact.Digest}, nil
		}
	}
	return found, fmt.Errorf("no unexpired dist-android artifact on the latest successful main pushes")
}

func getGitHubJSON(ctx context.Context, client *http.Client, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "cyb-android-installer")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("network: GitHub API request failed: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("network: GitHub API returned %s", res.Status)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(out); err != nil {
		return fmt.Errorf("network: invalid GitHub API response: %w", err)
	}
	return nil
}

func validArtifactDigest(digest string) bool {
	if !strings.HasPrefix(digest, "sha256:") {
		return false
	}
	decoded, err := hex.DecodeString(strings.TrimPrefix(digest, "sha256:"))
	return err == nil && len(decoded) == sha256.Size
}

func verifyFileDigest(file, expected string) error {
	if !validArtifactDigest(expected) {
		return fmt.Errorf("GitHub returned no valid SHA-256 digest")
	}
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != strings.TrimPrefix(expected, "sha256:") {
		return fmt.Errorf("archive digest mismatch")
	}
	return nil
}

func extractAndroidAPK(archive, destination string) (string, error) {
	zr, err := zip.OpenReader(archive)
	if err != nil {
		return "", fmt.Errorf("integrity: CI artifact is not a valid ZIP archive: %w", err)
	}
	defer zr.Close()
	var selected *zip.File
	for _, file := range zr.File {
		name := path.Base(file.Name)
		if !strings.HasPrefix(name, "CyberManju-OS-") || !strings.HasSuffix(name, "-arm64-v8a.apk") {
			continue
		}
		if file.Mode()&os.ModeSymlink != 0 || file.FileInfo().IsDir() || file.UncompressedSize64 == 0 || file.UncompressedSize64 > 1<<30 {
			return "", fmt.Errorf("integrity: CI artifact contains an invalid Android APK entry")
		}
		if selected != nil {
			return "", fmt.Errorf("integrity: CI artifact contains multiple installable arm64 APKs")
		}
		selected = file
	}
	if selected == nil {
		return "", fmt.Errorf("not_found: CI artifact contains no signed CyberManju-OS arm64-v8a APK")
	}
	dest := filepath.Join(destination, path.Base(selected.Name))
	in, err := selected.Open()
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dest)
		return "", err
	}
	if err := out.Close(); err != nil {
		os.Remove(dest)
		return "", err
	}
	return dest, nil
}

func downloadReleaseAndroidAPK(destination, tmp string) (string, string, error) {
	release, err := latestRelease()
	if err != nil {
		return "", "", err
	}
	var apk, apkURL, sums string
	for _, asset := range release.Assets {
		if strings.HasPrefix(asset.Name, "CyberManju-OS-") && strings.HasSuffix(asset.Name, "-arm64-v8a.apk") {
			if apk != "" {
				return "", "", fmt.Errorf("integrity: release has multiple arm64 APKs")
			}
			apk = asset.Name
			apkURL = asset.URL
		}
		if asset.Name == "SHA256SUMS.txt" {
			sums = asset.URL
		}
	}
	if apk == "" {
		return "", "", fmt.Errorf("not_found: latest release %s has no signed arm64 APK", release.Tag)
	}
	if sums == "" {
		return "", "", fmt.Errorf("integrity: latest release has no SHA256SUMS.txt")
	}
	dest := filepath.Join(destination, apk)
	ui.Info("downloading Android APK from release %s…", release.Tag)
	if _, err := ui.Download(apkURL, dest); err != nil {
		return "", "", err
	}
	if err := downloadAndVerifyChecksum(sums, filepath.Join(tmp, "SHA256SUMS.txt"), dest, apk, ui.Download); err != nil {
		os.Remove(dest)
		return "", "", fmt.Errorf("integrity: release APK: %w", err)
	}
	return dest, "release " + release.Tag, nil
}

func androidDownloadDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Downloads", "CyberManju-OS"), nil
}

func init() {
	androidInstallCmd.Flags().BoolVar(&androidDownloadOnly, "download-only", false, "download the APK without opening or installing it")
	androidCmd.AddCommand(androidInstallCmd)
	rootCmd.AddCommand(androidCmd)
}
