#!/usr/bin/env bash
# CyberManju OS — Termux installer tests (cli/scripts/install-termux_test.sh).
# Role: offline regression tests for install safety using a mocked curl and real tarballs.
# Exports: test runner exit status.
# Integrates: install-termux.sh, bash, tar, sha256sum.
# Contracts: all downloads are local fixtures; no network access.
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/install-termux.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
out=$(env -u PREFIX -u TERMUX_VERSION CYB_ARCH=arm64 bash "$SCRIPT" --dry-run --prefix "$TMP/prefix")
grep -q 'DRY RUN: download .*cyb-android-arm64' <<<"$out" || fail 'arm64 dry-run does not select arm64 artifact'
grep -q 'no dashboard, Docker, setup' <<<"$out" || fail 'dry-run scope message missing'
for arch in arm armv7l armv8l; do
  msg=$(env -u PREFIX -u TERMUX_VERSION CYB_ARCH="$arch" bash "$SCRIPT" --dry-run --prefix "$TMP/prefix" 2>&1) && fail "$arch unexpectedly supported"
  grep -qi 'arm32.*arm64 only\|arm64 only.*arm32' <<<"$msg" || fail "$arch refusal is not diagnostic"
done
if env -u PREFIX -u TERMUX_VERSION CYB_ARCH=arm64 bash "$SCRIPT" --dry-run --prefix relative >/dev/null 2>&1; then fail 'relative prefix should fail'; fi
if env -u PREFIX -u TERMUX_VERSION CYB_ARCH=arm64 bash "$SCRIPT" --dry-run --prefix "$TMP/prefix" --unknown >/dev/null 2>&1; then fail 'unknown option should fail'; fi
if env -u PREFIX -u TERMUX_VERSION CYB_ARCH=arm64 bash "$SCRIPT" --dry-run --prefix "$TMP/prefix" --version v1.2 >/dev/null 2>&1; then fail 'malformed release tag should fail'; fi
mkdir -p "$TMP/mockbin" "$TMP/prefix/bin" "$TMP/fixture"
printf '#!/bin/sh\nexit 0\n' > "$TMP/fixture/cyb"
chmod +x "$TMP/fixture/cyb"
make_archive() { tar -czf "$TMP/archive.tar.gz" -C "$TMP/fixture" "$@"; }
make_archive cyb
ASSET=cyb-android-arm64.tar.gz
sha256sum "$TMP/archive.tar.gz" | awk -v name="$ASSET" '{print $1 "  " name}' > "$TMP/SHA256SUMS.txt"
cat > "$TMP/mockbin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
out=
url= proto= redir= connect= timeout= retries= retry_time=
[[ "${1:-}" == -q ]] || { echo 'curlrc must be disabled first' >&2; exit 2; }
while (($#)); do
  case "$1" in
    -q|-fsSL) shift ;;
    --proto) proto=$2; shift 2 ;;
    --proto-redir) redir=$2; shift 2 ;;
    --connect-timeout) connect=$2; shift 2 ;;
    --max-time) timeout=$2; shift 2 ;;
    --retry) retries=$2; shift 2 ;;
    --retry-max-time) retry_time=$2; shift 2 ;;
    -o) out=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) echo "unexpected curl argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$url" && "$proto" == '=https' && "$redir" == '=https' && "$connect" == 15 && "$timeout" == 180 && "$retries" == 2 && "$retry_time" == 600 ]] || { echo 'unsafe or unbounded curl options' >&2; exit 2; }
if [[ "${MOCK_FAIL_ASSET:-}" == "${out##*/}" ]]; then
  printf 'incomplete download\n' > "$out"
  exit 28
fi
case "$out" in
  */cyb-android-arm64.tar.gz) cp "$MOCK_ARCHIVE" "$out" ;;
  */SHA256SUMS.txt) cp "$MOCK_SUMS" "$out" ;;
  *) echo "unexpected curl output: $out" >&2; exit 2 ;;
esac
MOCK
chmod +x "$TMP/mockbin/curl"
export PATH="$TMP/mockbin:$PATH" MOCK_ARCHIVE="$TMP/archive.tar.gz" MOCK_SUMS="$TMP/SHA256SUMS.txt" PREFIX="$TMP/prefix" TERMUX_VERSION=mock CYB_ARCH=arm64 REPO=test/repo
bash "$SCRIPT" --version v1.2.3 --prefix "$PREFIX"
[[ -x "$PREFIX/bin/cyb" ]] || fail 'successful install did not create executable'
# Timeout/partial download of either release file must preserve an existing installation.
cp "$PREFIX/bin/cyb" "$TMP/before-network-failure"
for download in "$ASSET" SHA256SUMS.txt; do
  if msg=$(MOCK_FAIL_ASSET="$download" bash "$SCRIPT" --version v1.2.3 --prefix "$PREFIX" 2>&1); then fail "$download timeout unexpectedly succeeded"; fi
  grep -q "could not download $download" <<<"$msg" || fail "$download failure lacks a download diagnostic"
  cmp -s "$PREFIX/bin/cyb" "$TMP/before-network-failure" || fail "$download timeout changed existing binary"
done
# Replacing a destination symlink must not overwrite its target.
printf 'unrelated target\n' > "$TMP/link-target"
cp "$TMP/link-target" "$TMP/link-original"
rm "$PREFIX/bin/cyb"
ln -s "$TMP/link-target" "$PREFIX/bin/cyb"
bash "$SCRIPT" --version v1.2.3 --prefix "$PREFIX"
[[ ! -L "$PREFIX/bin/cyb" && -x "$PREFIX/bin/cyb" ]] || fail 'destination symlink was not replaced by executable'
cmp -s "$TMP/link-target" "$TMP/link-original" || fail 'installation overwrote destination symlink target'
cmp -s "$PREFIX/bin/cyb" "$TMP/fixture/cyb" || fail 'replacement executable differs from release'
# A partial staging copy must never truncate the installed binary, and must be cleaned up.
cp "$PREFIX/bin/cyb" "$TMP/before-copy-failure"
cat > "$TMP/mockbin/install" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'partial copy\n' > "${@: -1}"
exit 1
MOCK
chmod +x "$TMP/mockbin/install"
if bash "$SCRIPT" --version v1.2.3 --prefix "$PREFIX" >/dev/null 2>&1; then fail 'partial install unexpectedly succeeded'; fi
cmp -s "$PREFIX/bin/cyb" "$TMP/before-copy-failure" || fail 'partial install changed existing binary'
shopt -s nullglob
staged=("$PREFIX/bin/"cyb.tmp.*)
[[ ${#staged[@]} == 0 ]] || fail 'failed install left a staged binary'
rm "$TMP/mockbin/install"
# A directory destination must fail instead of receiving a nested staged executable.
rm "$PREFIX/bin/cyb"
mkdir "$PREFIX/bin/cyb"
if bash "$SCRIPT" --version v1.2.3 --prefix "$PREFIX" >/dev/null 2>&1; then fail 'directory destination unexpectedly succeeded'; fi
[[ -d "$PREFIX/bin/cyb" ]] || fail 'directory destination was replaced'
contents=("$PREFIX/bin/cyb/"*)
[[ ${#contents[@]} == 0 ]] || fail 'directory destination received a nested binary'
staged=("$PREFIX/bin/"cyb.tmp.*)
[[ ${#staged[@]} == 0 ]] || fail 'rename failure left a staged binary'
rmdir "$PREFIX/bin/cyb"
# Corrupt checksum must fail and must leave the installed executable byte-for-byte intact.
printf 'preexisting binary\n' > "$PREFIX/bin/cyb"
cp "$PREFIX/bin/cyb" "$TMP/existing"
awk '{print substr($0,1,64) ~ /^0+$/ ? "f" substr($0,2) : "0" substr($0,2) "  cyb-android-arm64.tar.gz"}' "$TMP/SHA256SUMS.txt" > "$TMP/bad-sums"
export MOCK_SUMS="$TMP/bad-sums"
if bash "$SCRIPT" --version v1.2.3 --prefix "$PREFIX" >/dev/null 2>&1; then fail 'checksum mismatch unexpectedly succeeded'; fi
cmp -s "$PREFIX/bin/cyb" "$TMP/existing" || fail 'checksum mismatch changed installed binary'
# A correctly checksummed symlink entry must be rejected before installation.
ln -sf /bin/false "$TMP/fixture/cyb"
make_archive cyb
sha256sum "$TMP/archive.tar.gz" | awk -v name="$ASSET" '{print $1 "  " name}' > "$TMP/SHA256SUMS.txt"
export MOCK_ARCHIVE="$TMP/archive.tar.gz" MOCK_SUMS="$TMP/SHA256SUMS.txt"
if bash "$SCRIPT" --version v1.2.3 --prefix "$PREFIX" >/dev/null 2>&1; then fail 'symlink archive entry unexpectedly succeeded'; fi
cmp -s "$PREFIX/bin/cyb" "$TMP/existing" || fail 'symlink rejection changed installed binary'
# Two root aliases are ambiguous even if both entries are regular files.
printf 'second\n' > "$TMP/fixture/second"
tar -czf "$TMP/archive.tar.gz" -C "$TMP/fixture" cyb --transform='s,^second,./cyb,' second
sha256sum "$TMP/archive.tar.gz" | awk -v name="$ASSET" '{print $1 "  " name}' > "$TMP/SHA256SUMS.txt"
export MOCK_ARCHIVE="$TMP/archive.tar.gz" MOCK_SUMS="$TMP/SHA256SUMS.txt"
if bash "$SCRIPT" --version v1.2.3 --prefix "$PREFIX" >/dev/null 2>&1; then fail 'duplicate cyb entries unexpectedly succeeded'; fi
printf 'Termux installer offline tests passed\n'
