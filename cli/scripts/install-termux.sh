#!/usr/bin/env bash
# CyberManju OS — Termux installer (cli/scripts/install-termux.sh).
# Role: install the checksum-verified Go CLI on Android/Termux without Docker.
# Exports: executable `cyb` under PREFIX/bin.
# Integrates: GitHub Releases, curl, tar, sha256sum.
# Contracts: require Termux; validate release tag, archive, and digest before installing; never configure a server.
set -euo pipefail

REPO="${REPO:-cybermanju/cybermanju.github.io}"
PREFIX_VALUE="${PREFIX:-}"
VERSION="${CYB_VERSION:-latest}"
DRY_RUN=0
usage() { printf 'Usage: install-termux.sh [--dry-run] [--version TAG] [--prefix DIR]\n'; }
die() { printf 'cyb Termux installer: %s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --version) (($# >= 2)) || die '--version requires a tag'; VERSION=$2; shift ;;
    --prefix) (($# >= 2)) || die '--prefix requires a directory'; PREFIX_VALUE=$2; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
[[ "$VERSION" == latest || "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid release tag '$VERSION' (expected vMAJOR.MINOR.PATCH or latest)"
if [[ -z "$PREFIX_VALUE" ]]; then
  [[ "$DRY_RUN" == 1 ]] && PREFIX_VALUE="${HOME:-/data/data/com.termux/files/home}/.termux"
  [[ "$DRY_RUN" == 1 ]] || die 'PREFIX is unset; run this inside Termux (pkg install curl tar coreutils)'
fi
[[ "$PREFIX_VALUE" = /* ]] || die 'prefix must be an absolute path'
case "${TERMUX_VERSION:-${PREFIX:-}}" in
  '') [[ "$DRY_RUN" == 1 ]] || die 'Termux environment not detected (PREFIX/TERMUX_VERSION missing)' ;;
esac
# CI publishes only the Go Android arm64 executable; arm32 is not a supported artifact.
DEVICE_ARCH="${CYB_ARCH:-$(uname -m)}"
case "$DEVICE_ARCH" in
  aarch64|arm64) ARCH=arm64 ;;
  armv7l|armv8l|arm) die "unsupported Android architecture '$DEVICE_ARCH': releases contain arm64 only; this device is arm32 (no arm32 binary is built)" ;;
  *) die "unsupported Android architecture '$DEVICE_ARCH': releases contain arm64 only" ;;
esac
ASSET="cyb-android-${ARCH}.tar.gz"
[[ "$VERSION" == latest ]] && BASE="https://github.com/${REPO}/releases/latest/download" || BASE="https://github.com/${REPO}/releases/download/${VERSION}"
DEST="${PREFIX_VALUE%/}/bin/cyb"
if [[ "$DRY_RUN" == 1 ]]; then
  printf 'DRY RUN: download %s/%s and SHA256SUMS.txt; verify digest; install %s (mode 0755)\n' "$BASE" "$ASSET" "$DEST"
  printf 'DRY RUN: no dashboard, Docker, setup, or configuration changes.\n'
  exit 0
fi
for tool in curl tar sha256sum awk install mktemp mkdir chmod uname mv rm; do command -v "$tool" >/dev/null || die "missing $tool; install with: pkg install curl tar coreutils"; done
TMP=$(mktemp -d) || die 'could not create temporary directory'
STAGED=''
cleanup() {
  rm -rf "$TMP"
  if [[ -n "$STAGED" ]]; then rm -f -- "$STAGED"; fi
}
trap cleanup EXIT
# Ignore curlrc overrides; bound slow connections and require TLS across redirects.
CURL_OPTIONS=(-q -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 180 --retry 2 --retry-max-time 600)
curl "${CURL_OPTIONS[@]}" "$BASE/$ASSET" -o "$TMP/$ASSET" || die "could not download $ASSET"
curl "${CURL_OPTIONS[@]}" "$BASE/SHA256SUMS.txt" -o "$TMP/SHA256SUMS.txt" || die 'could not download SHA256SUMS.txt'
DIGEST=$(awk -v name="$ASSET" '$2 == name || $2 == "*"name {count++; digest=$1} END {if (count == 1) print digest; else exit 1}' "$TMP/SHA256SUMS.txt") || die "checksum entry missing or duplicated for $ASSET"
[[ "$DIGEST" =~ ^[[:xdigit:]]{64}$ ]] || die "checksum entry invalid for $ASSET"
printf '%s  %s\n' "$DIGEST" "$TMP/$ASSET" | sha256sum -c - >/dev/null || die 'SHA-256 verification failed'
# Accept exactly one root cyb entry, and only a regular file; do not allow aliases/duplicates.
ENTRY_LIST=$(tar -tzf "$TMP/$ASSET") || die 'invalid tar archive'
ENTRY_COUNT=$(awk '$0 == "cyb" || $0 == "./cyb" {n++} END {print n+0}' <<<"$ENTRY_LIST")
[[ "$ENTRY_COUNT" == 1 ]] || die 'archive must contain exactly one expected cyb binary (duplicate or missing entry)'
ENTRY=$(awk '$0 == "cyb" || $0 == "./cyb" {print}' <<<"$ENTRY_LIST")
[[ "$(tar -tvzf "$TMP/$ASSET" "$ENTRY" | awk 'NR==1 {print substr($1,1,1)}')" == '-' ]] || die 'archive cyb entry is not a regular file'
mkdir "$TMP/unpack"
tar -xzf "$TMP/$ASSET" -C "$TMP/unpack" --no-same-owner "$ENTRY"
BIN="$TMP/unpack/${ENTRY#./}"
[[ -f "$BIN" && ! -L "$BIN" ]] || die 'extracted cyb is not a regular file'
chmod 0755 "$BIN"
mkdir -p "${PREFIX_VALUE%/}/bin"
# Stage on the destination filesystem, then rename without following a destination symlink.
STAGED=$(mktemp "${DEST}.tmp.XXXXXXXX") || die 'could not stage installation'
install -m 0755 "$BIN" "$STAGED" || die 'could not stage binary; existing cyb preserved'
mv -fT -- "$STAGED" "$DEST" || die 'could not replace binary; existing cyb preserved'
STAGED=''
printf 'Installed %s\n' "$DEST"
printf 'Next: cyb setup --server https://YOUR-DASHBOARD (or choose CLI Limited in cyb setup).\n'
