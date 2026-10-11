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

need() { command -v "$1" >/dev/null 2>&1 || die "need '$1' on PATH"; }
need curl
need tar

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux) GOOS=linux ;;
  Darwin) GOOS=darwin ;;
  MINGW*|MSYS*|CYGWIN*) GOOS=windows ;;
  *) die "unsupported OS: $OS" ;;
esac
case "$ARCH" in
  x86_64|amd64) GOARCH=amd64 ;;
  arm64|aarch64) GOARCH=arm64 ;;
  *) die "unsupported arch: $ARCH" ;;
esac

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

# Verify against the published sums (sha256sum on Linux, shasum on macOS).
SUM_LINE="$(grep -E "[[:space:]]$ASSET\$" "$TMP/SHA256SUMS.txt" | head -1)"
[ -n "$SUM_LINE" ] || die "no checksum entry for $ASSET"
WANT_SUM="$(printf '%s' "$SUM_LINE" | awk '{print $1}')"
if command -v sha256sum >/dev/null 2>&1; then
  GOT_SUM="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  GOT_SUM="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
else
  die "need 'sha256sum' or 'shasum' to verify the download"
fi
[ "$GOT_SUM" = "$WANT_SUM" ] || die "checksum mismatch for $ASSET (integrity: refusing to install)"

tar -xzf "$TMP/$ASSET" -C "$TMP" || die "extract failed"
BIN="$TMP/cyb"
[ "$GOOS" = "windows" ] && BIN="$TMP/cyb.exe"
[ -f "$BIN" ] || die "tarball contains no cyb binary"

mkdir -p "$INSTALL_DIR" || die "cannot create $INSTALL_DIR"
mv "$BIN" "$INSTALL_DIR/" || die "cannot write to $INSTALL_DIR"
chmod +x "$INSTALL_DIR/cyb"* 2>/dev/null || true

say "installed: $INSTALL_DIR/cyb ($("$INSTALL_DIR/cyb" version 2>/dev/null || echo "$TAG"))"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf '→ add to PATH:  export PATH="$INSTALL_DIR:$PATH"\n' ;;
esac
printf '→ start here:  cyb setup\n'
