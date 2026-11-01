#!/usr/bin/env bash
set -Eeuo pipefail

SDK_VERSION="8.5.3"
SDK_URL="https://www.renpy.org/dl/8.5.3/renpy-8.5.3-sdk.tar.bz2"
SDK_SHA256="eb0a9be7f0fb13632fe25ceade9a8bed5a1b4d6b6e83bd19eeeb29e1a1bb4a45"
WEB_URL="https://www.renpy.org/dl/8.5.3/renpy-8.5.3-web.zip"
WEB_SHA256="954db897e65f51ea63cb2fb7b203d02be0447f4e22069514020bbe6c6691fdfc"
DEST="${1:-$HOME/.cache/renpy/8.5.3/renpy-8.5.3-sdk}"

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

curl --fail --location --retry 3 "$SDK_URL" -o "$TEMP/renpy-sdk.tar.bz2"
printf '%s  %s\n' "$SDK_SHA256" "$TEMP/renpy-sdk.tar.bz2" | sha256sum --check --status || {
  echo "Official Ren'Py SDK SHA-256 mismatch." >&2
  exit 3
}
tar -xjf "$TEMP/renpy-sdk.tar.bz2" -C "$TEMP/extract"
SDK_DIR="$TEMP/extract/renpy-${SDK_VERSION}-sdk"
if [[ ! -x "$SDK_DIR/renpy.sh" ]]; then
  echo "Expected renpy-${SDK_VERSION}-sdk/renpy.sh inside the official SDK archive." >&2
  exit 4
fi

curl --fail --location --retry 3 "$WEB_URL" -o "$TEMP/renpy-web.zip"
printf '%s  %s\n' "$WEB_SHA256" "$TEMP/renpy-web.zip" | sha256sum --check --status || {
  echo "Official Ren'Py Web support SHA-256 mismatch." >&2
  exit 3
}
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
echo "Installed verified Ren'Py ${SDK_VERSION} SDK + Web support at $DEST"
