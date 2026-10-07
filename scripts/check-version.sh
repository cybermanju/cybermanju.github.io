#!/usr/bin/env bash
# AGENT-4 item 15 — version single-source check.
#
# package.json is the source of truth. Every other file that carries a
# version, and (for releases) the git tag, must agree with it.
#
#   scripts/check-version.sh                 # plain consistency check (CI, every push)
#   scripts/check-version.sh --tag v<X.Y.Z>  # release check, tag included
#                                            # (tag must be `v` + package.json version)
#
# Explicitly NOT carriers — do not add them here:
#   - Android `versionCode` — generated Gradle sources live in gitignored
#     `src-tauri/gen/` (created by `tauri android init`; no Android target is
#     wired yet), so there is nothing to pin in-tree. The store version is
#     assigned at signing/publish time.
#   - iOS — no iOS target (`tauri ios init` never run): no Info.plist version.
#   - Flatpak `src-tauri/flatpak/com.cybermanju.os.yml` — carries only the
#     Freedesktop `runtime-version` (e.g. '47'), not the app version; app
#     releases ship by git tag.
#   - Docker image tag (`cybermanju-os:latest` in docker-compose.yml) —
#     intentionally floating; the shippable version is `x-casaos.version`.
#   - Cargo.lock — registry snapshot: third-party versions must NOT equal the
#     app version. Workspace members are pinned by their own manifests below.
set -euo pipefail

cd "$(dirname "$0")/.."

tag=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Package version of one Cargo.toml: the `version = "…"` line anchored at
# line start (leading whitespace tolerated). Dependency lines such as
# `serde = { version = "1", … }` never match the anchor. A future
# `version.workspace = true` migration resolves against the root
# `[workspace.package]` version instead of silently comparing empty (which
# today means the root defines none — add it together with the migration).
toml_version() {
  local file="$1"
  if grep -Eq '^[[:space:]]*version\.workspace[[:space:]]*=[[:space:]]*true' "$file"; then
    sed -n 's/^[[:space:]]*version[[:space:]]*=[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' Cargo.toml | head -1
    return
  fi
  sed -n 's/^[[:space:]]*version[[:space:]]*=[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' "$file" | head -1
}

fail=0
check() {
  local label="$1" actual="$2"
  if [ "$actual" = "$version" ]; then
    printf 'ok   %-34s %s\n' "$label" "$actual"
  else
    printf 'FAIL %-34s %s (expected %s, from package.json)\n' "$label" "${actual:-<missing>}" "$version"
    fail=1
  fi
}

version=$(node -e "process.stdout.write(require('./package.json').version)")

echo "source of truth: package.json = $version"

check "package-lock.json" "$(node -e "process.stdout.write(require('./package-lock.json').version)")"
check "src-tauri/tauri.conf.json" "$(node -e "process.stdout.write(require('./src-tauri/tauri.conf.json').version)")"
check "src-tauri/Cargo.toml" "$(toml_version src-tauri/Cargo.toml)"
check "crates/web/Cargo.toml (status ep.)" "$(toml_version crates/web/Cargo.toml)"
check "docker/server/Cargo.toml" "$(toml_version docker/server/Cargo.toml)"
# Indent-tolerant: only the `version:` key under `x-casaos` may match.
check "docker-compose.yml x-casaos" "$(sed -n 's/^[[:space:]]*version:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' docker-compose.yml | head -1)"
check "aur/PKGBUILD pkgver" "$(sed -n 's/^[[:space:]]*pkgver[[:space:]]*=[[:space:]]*\(.*\)$/\1/p' aur/PKGBUILD | head -1)"
# `**Version:**` with or without bold markers and flexible gaps, so a README
# reformat does not false-fail; still anchored on a `Version:` line start.
check "README.md" "$(sed -n 's/^[[:space:]]*\(\*\*\)\{0,1\}Version:\(\*\*\)\{0,1\}[[:space:]]*\([^[:space:]]*\).*$/\3/p' README.md | head -1)"

for manifest in crates/*/Cargo.toml; do
  check "$manifest" "$(toml_version "$manifest")"
done

if [ -n "$tag" ]; then
  case "$tag" in
    v*) ;;
    *) echo "tag must look like v<X.Y.Z> (got '$tag')" >&2; exit 2 ;;
  esac
  check "git tag ($tag)" "${tag#v}"
fi

if [ "$fail" -ne 0 ]; then
  echo "version mismatch — see FAIL lines above" >&2
  exit 1
fi
echo "all versions agree"
