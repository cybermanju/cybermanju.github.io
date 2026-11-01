#!/usr/bin/env bash
# CyberManju OS — Ren’Py web build environment setup.
# Role: installs build dependencies; Integrates: Python, Playwright, and the Ren’Py integration.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3.12 -m pip install -r "$ROOT/requirements-renpy-build.txt"
python3.12 -m playwright install chromium
SDK="${RENPY_SDK:-$HOME/.cache/renpy/8.5.3/renpy-8.5.3-sdk}"
if [[ ! -x "$SDK/renpy.sh" || ! -d "$SDK/web" ]]; then
  "$ROOT/tools/install_renpy_sdk.sh" "$SDK"
fi
export RENPY_SDK="$SDK"
exec bash "$ROOT/build_web.sh" "$@"
