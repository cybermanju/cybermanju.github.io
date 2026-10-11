#!/usr/bin/env bash
# CyberManju OS — universal `cyb` installer.
#   curl -fsSL https://cybermanju.github.io/install.sh | bash
# Installs the `cyb` terminal (Charm UI) for Linux, macOS and Windows
# (Git Bash / MSYS2 / WSL). Checksum-verified against the release SHA256SUMS.
#
# Env knobs:
#   CYB_VERSION   release tag (default: latest). Example: CYB_VERSION=v0.2.0
#   INSTALL_DIR   where the binary lands (default: $HOME/.local/bin)
#   REPO          owner/repo override (default: cybermanju/cybermanju.github.io)
set -u

REPO="${REPO:-cybermanju/cybermanju.github.io}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
WANT_VERSION="${CYB_VERSION:-latest}"

say() { printf '◈ %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux) GOOS=linux ;;
  Darwin) GOOS=darwin ;;
  MINGW*|MSYS*|CYGWIN*) GOOS=windows ;;
  *) die "unsupported OS: $OS (cyb ships linux/darwin/windows — see the release page for alternatives)" ;;
esac
case "$ARCH" in
  x86_64|amd64) GOARCH=amd64 ;;
  arm64|aarch64) GOARCH=arm64 ;;
  *) die "unsupported arch: $ARCH (cyb ships amd64/arm64 — see the release page for alternatives)" ;;
esac

# Per-OS install hint for a missing tool (package name may differ from the
# tool name, e.g. sha256sum lives in coreutils). Distro detection reads
# /etc/os-release in a subshell so no variables leak into the installer.
pkg_hint() {
  tool="$1"; pkg="$2"
  case "$OS" in
    Darwin) printf 'brew install %s' "$pkg" ;;
    Linux)
      dist_id=""
      if [ -r /etc/os-release ]; then
        dist_id="$( ( . /etc/os-release 2>/dev/null; printf '%s %s' "${ID:-}" "${ID_LIKE:-}" ) )"
      fi
      case "$dist_id" in
        *debian*|*ubuntu*) printf 'sudo apt-get update && sudo apt-get install -y %s' "$pkg" ;;
        *fedora*|*rhel*|*centos*|*rocky*|*alma*) printf 'sudo dnf install -y %s' "$pkg" ;;
        *arch*|*cachyos*|*manjaro*|*endeavouros*) printf 'sudo pacman -S --needed %s' "$pkg" ;;
        *alpine*) printf 'sudo apk add %s' "$pkg" ;;
        *suse*|*opensuse*) printf 'sudo zypper install -y %s' "$pkg" ;;
        *) printf 'your package manager (%s)' "$pkg" ;;
      esac
      ;;
    MINGW*|MSYS*|CYGWIN*) printf 'the Git-Bash/MSYS2 package for %s (pacman -S %s on MSYS2)' "$tool" "$pkg" ;;
    *) printf 'a %s package providing %s' "$pkg" "$tool" ;;
  esac
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "need '$1' on PATH — $(pkg_hint "$1" "$2")"
}
need curl curl
need tar tar
# Fail fast on the hash tool too: macOS ships shasum, everywhere else
# sha256sum — don't waste a download discovering neither exists.
if command -v sha256sum >/dev/null 2>&1; then
  HASH_TOOL=sha256sum
elif command -v shasum >/dev/null 2>&1; then
  HASH_TOOL=shasum
else
  die "need 'sha256sum' or 'shasum' to verify the download — $(pkg_hint sha256sum coreutils)"
fi

if [ "$WANT_VERSION" = "latest" ]; then
  say "resolving latest release…"
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)"
  [ -n "$TAG" ] || die "could not resolve the latest release"
else
  TAG="$WANT_VERSION"
fi

ASSET="cyb-$GOOS-$GOARCH.tar.gz"
BASE="https://github.com/$REPO/releases/download/$TAG"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "installing cyb $TAG ($GOOS/$GOARCH)…"
curl -fsSL -o "$TMP/$ASSET" "$BASE/$ASSET" || die "download failed: $BASE/$ASSET"
curl -fsSL -o "$TMP/SHA256SUMS.txt" "$BASE/SHA256SUMS.txt" || die "checksum file download failed"

# Verify against the published sums with the tool detected up front.
SUM_LINE="$(grep -E "[[:space:]]$ASSET\$" "$TMP/SHA256SUMS.txt" | head -1)"
[ -n "$SUM_LINE" ] || die "no checksum entry for $ASSET"
WANT_SUM="$(printf '%s' "$SUM_LINE" | awk '{print $1}')"
if [ "$HASH_TOOL" = "sha256sum" ]; then
  GOT_SUM="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"
else
  GOT_SUM="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
fi
[ "$GOT_SUM" = "$WANT_SUM" ] || die "checksum mismatch for $ASSET (integrity: refusing to install)"

tar -xzf "$TMP/$ASSET" -C "$TMP" || die "extract failed"
BIN="$TMP/cyb"
[ "$GOOS" = "windows" ] && BIN="$TMP/cyb.exe"
[ -f "$BIN" ] || die "tarball contains no cyb binary"

mkdir -p "$INSTALL_DIR" || die "cannot create $INSTALL_DIR"
mv "$BIN" "$INSTALL_DIR/" || die "cannot write to $INSTALL_DIR"
chmod +x "$INSTALL_DIR/cyb"* 2>/dev/null || true

# On Windows shells the binary is cyb.exe — report the real path so the
# version probe below actually executes it instead of falling back.
CYB_BIN="$INSTALL_DIR/cyb"
[ "$GOOS" = "windows" ] && CYB_BIN="$INSTALL_DIR/cyb.exe"
say "installed: $CYB_BIN ($("$CYB_BIN" version 2>/dev/null || echo "$TAG"))"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf '→ add to PATH:  export PATH="%s:$PATH"\n' "$INSTALL_DIR" ;;
esac
printf '→ start here:  cyb setup\n'
