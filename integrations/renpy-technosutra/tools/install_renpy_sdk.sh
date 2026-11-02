#!/usr/bin/env bash
# CyberManju OS — Ren’Py SDK installer.
# Role: fetches and verifies the pinned SDK; Integrates: Ren’Py web build scripts.
set -Eeuo pipefail

SDK_VERSION="8.5.3"
SDK_URL="https://www.renpy.org/dl/8.5.3/renpy-8.5.3-sdk.tar.bz2"
SDK_SHA256="eb0a9be7f0fb13632fe25ceade9a8bed5a1b4d6b6e83bd19eeeb29e1a1bb4a45"
WEB_URL="https://www.renpy.org/dl/8.5.3/renpy-8.5.3-web.zip"
WEB_SHA256="954db897e65f51ea63cb2fb7b203d02be0447f4e22069514020bbe6c6691fdfc"
DEST="${1:-$HOME/.cache/renpy/8.5.3/renpy-8.5.3-sdk}"
DOWNLOAD_CACHE="${RENPY_DOWNLOAD_CACHE:-}"

for command in curl sha256sum tar unzip; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 2; }
done
if [[ -e "$DEST" ]]; then
  echo "Refusing to overwrite SDK destination: $DEST" >&2
  exit 2
fi

PARENT="$(dirname "$DEST")"
mkdir -p "$PARENT"
TEMP="$(mktemp -d "$PARENT/.renpy-sdk-${SDK_VERSION}.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/extract" "$TEMP/web-extract"

verify_sha256() {
  local expected="$1"
  local file="$2"
  printf '%s  %s\n' "$expected" "$file" | sha256sum --check --status
}

fetch_verified() {
  local url="$1"
  local expected="$2"
  local filename="$3"
  local description="$4"
  local destination="$TEMP/$filename"
  local cached=""

  if [[ -n "$DOWNLOAD_CACHE" ]]; then
    mkdir -p "$DOWNLOAD_CACHE"
    cached="$DOWNLOAD_CACHE/$filename"
    if [[ -f "$cached" ]]; then
      if verify_sha256 "$expected" "$cached"; then
        echo "Using cached $description after SHA-256 verification."
        cp -- "$cached" "$destination"
        verify_sha256 "$expected" "$destination" || {
          echo "Copied cached $description failed SHA-256 verification." >&2
          exit 3
        }
        return
      fi
      echo "Cached $description failed SHA-256 verification; downloading a fresh copy." >&2
      rm -f -- "$cached"
    fi
  fi

  curl --fail --location --retry 3 "$url" -o "$destination"
  verify_sha256 "$expected" "$destination" || {
    echo "Official $description SHA-256 mismatch." >&2
    exit 3
  }
  if [[ -n "$cached" ]]; then
    local cache_temp="$DOWNLOAD_CACHE/.${filename}.${BASHPID}.tmp"
    cp -- "$destination" "$cache_temp"
    verify_sha256 "$expected" "$cache_temp" || {
      rm -f -- "$cache_temp"
      echo "Cached copy of $description failed SHA-256 verification." >&2
      exit 3
    }
    mv -f -- "$cache_temp" "$cached"
  fi
}

fetch_verified "$SDK_URL" "$SDK_SHA256" "renpy-sdk.tar.bz2" "Ren'Py SDK archive"
tar -xjf "$TEMP/renpy-sdk.tar.bz2" -C "$TEMP/extract"
SDK_DIR="$TEMP/extract/renpy-${SDK_VERSION}-sdk"
if [[ ! -x "$SDK_DIR/renpy.sh" ]]; then
  echo "Expected renpy-${SDK_VERSION}-sdk/renpy.sh inside the official SDK archive." >&2
  exit 4
fi

fetch_verified "$WEB_URL" "$WEB_SHA256" "renpy-web.zip" "Ren'Py Web support archive"
unzip -q "$TEMP/renpy-web.zip" -d "$TEMP/web-extract"
WEB_DIR="$(find "$TEMP/web-extract" -type d -name web -print -quit)"
if [[ -z "$WEB_DIR" ]]; then
  echo "The official Web support archive did not contain its web/ directory." >&2
  exit 4
fi
rm -rf "$SDK_DIR/web"
mv "$WEB_DIR" "$SDK_DIR/web"
mkdir -p "$(dirname "$DEST")"
mv "$SDK_DIR" "$DEST"
echo "Installed freshly extracted, SHA-256-verified Ren'Py ${SDK_VERSION} SDK + Web support at $DEST"
