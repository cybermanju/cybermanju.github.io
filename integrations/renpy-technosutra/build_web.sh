#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
SDK="${RENPY_SDK:-/tmp/renpy-sdk/renpy-8.5.3-sdk}"
STAGING="$ROOT/build/staging"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CANDIDATE="$STAGING/candidate-$STAMP"
OUTPUT_NEXT="$ROOT/build/output.next-$STAMP"
PUBLIC="$REPO/public/technosutra-vn"
PUBLIC_NEXT="$REPO/public/technosutra-vn.next-$STAMP"
PREVIOUS_OUTPUT="$STAGING/previous-build-output-$STAMP"
PREVIOUS_PUBLIC="$STAGING/previous-public-$STAMP"
FAILED_OUTPUT="$STAGING/failed-build-output-$STAMP"
FAILED_PUBLIC="$STAGING/failed-public-$STAMP"
OLD_OUTPUT_STAGED=0
OLD_PUBLIC_STAGED=0

if [[ ! -x "$SDK/renpy.sh" ]]; then
  echo "Ren'Py SDK not found at $SDK. Set RENPY_SDK to an installed Ren'Py 8.5+ SDK." >&2
  exit 2
fi
mkdir -p "$STAGING"
if [[ -e "$CANDIDATE" || -e "$OUTPUT_NEXT" || -e "$PUBLIC_NEXT" ]]; then
  echo "Refusing to overwrite a build/staging path for $STAMP" >&2
  exit 2
fi
mkdir -p "$CANDIDATE"

restore_previous_on_failure() {
  local result=$?
  if [[ $result -ne 0 ]]; then
    if [[ -d "$PUBLIC" && -d "$PREVIOUS_PUBLIC" ]]; then
      mv "$PUBLIC" "$FAILED_PUBLIC" || true
      mv "$PREVIOUS_PUBLIC" "$PUBLIC" || true
    elif [[ ! -e "$PUBLIC" && -d "$PREVIOUS_PUBLIC" ]]; then
      mv "$PREVIOUS_PUBLIC" "$PUBLIC" || true
    fi
    if [[ -d "$ROOT/build/output" && -d "$PREVIOUS_OUTPUT" ]]; then
      mv "$ROOT/build/output" "$FAILED_OUTPUT" || true
      mv "$PREVIOUS_OUTPUT" "$ROOT/build/output" || true
    elif [[ ! -e "$ROOT/build/output" && -d "$PREVIOUS_OUTPUT" ]]; then
      mv "$PREVIOUS_OUTPUT" "$ROOT/build/output" || true
    fi
  fi
  return "$result"
}
trap restore_previous_on_failure EXIT

# Generate the scripts and prepare assets, but do not remove or overwrite any build output.
python3 "$ROOT/tools/generate_renpy_script.py"
python3 "$ROOT/tools/generate_master_sprite_script.py"
python3 "$ROOT/tools/prepare_assets.py"

# Fail early if the gallery jump and generated label drift apart.
python3 - "$ROOT/game" <<'PY'
from pathlib import Path
import json, re, sys
root = Path(sys.argv[1])
story = (root / "script.rpy").read_text(encoding="utf-8")
gallery = (root / "technosutra_masters.rpy").read_text(encoding="utf-8")
manifest = json.loads((root / "images/masters/sprites/manifest.json").read_text(encoding="utf-8"))
if "jump technosutra_master_gallery" not in story or not re.search(r"^label technosutra_master_gallery:", gallery, re.M):
    raise SystemExit("Generated story references a missing provisional-render gallery label")
if len(re.findall(r"^image gallery_master_\d{2}_provisional =", gallery, re.M)) != 54:
    raise SystemExit("Generated gallery must define the 54 manifest-backed provisional renders")
if manifest.get("availableCount") != 54 or len(manifest.get("assets", [])) != 54:
    raise SystemExit("Sprite manifest count does not match the 54 verified renders")
PY

# Lint before creating or promoting any web output. Existing artifacts remain untouched on failure.
xvfb-run -a "$SDK/renpy.sh" "$ROOT" lint --error-code

# Build into a unique candidate directory so a failed web_build cannot corrupt prior outputs.
xvfb-run -a "$SDK/renpy.sh" "$SDK/launcher" web_build "$ROOT" --destination "$CANDIDATE"
INDEX="$(find "$CANDIDATE" -type f -name index.html -print -quit)"
if [[ -z "$INDEX" ]]; then
  echo "Ren'Py web_build completed without index.html under $CANDIDATE" >&2
  exit 3
fi
WEB_DIR="$(dirname "$INDEX")"
ZIP="$WEB_DIR/game.zip"
for required in index.html game.zip renpy.js renpy.wasm; do
  if [[ ! -f "$WEB_DIR/$required" ]]; then
    echo "Ren'Py candidate is missing required web artifact: $WEB_DIR/$required" >&2
    exit 4
  fi
done
python3 - "$ZIP" <<'PY'
import sys, zipfile
path = sys.argv[1]
try:
    with zipfile.ZipFile(path) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise zipfile.BadZipFile(f"corrupt member: {corrupt}")
        if len(archive.infolist()) < 100:
            raise zipfile.BadZipFile("archive is unexpectedly incomplete")
except zipfile.BadZipFile as error:
    print(f"Invalid Ren'Py game archive {path}: {error}", file=sys.stderr)
    raise SystemExit(4)
print(f"Verified Ren'Py game.zip archive ({len(archive.infolist())} members).")
PY

# Prepare and verify both new destinations before staging any previous artifact.
mkdir -p "$OUTPUT_NEXT" "$PUBLIC_NEXT"
cp -a "$WEB_DIR"/. "$OUTPUT_NEXT"/
cp -a "$WEB_DIR"/. "$PUBLIC_NEXT"/
for copied in "$OUTPUT_NEXT" "$PUBLIC_NEXT"; do
  if [[ ! -s "$copied/game.zip" || ! -s "$copied/renpy.wasm" || ! -s "$copied/index.html" ]]; then
    echo "Copied candidate is incomplete: $copied" >&2
    exit 5
  fi
done
CANDIDATE_HASH="$(sha256sum "$ZIP" | cut -d' ' -f1)"
for copied in "$OUTPUT_NEXT/game.zip" "$PUBLIC_NEXT/game.zip"; do
  if [[ "$(sha256sum "$copied" | cut -d' ' -f1)" != "$CANDIDATE_HASH" ]]; then
    echo "Copied game.zip hash differs from validated candidate: $copied" >&2
    exit 6
  fi
done

# Preserve old serving/build outputs only after lint, web_build, ZIP, and copy checks pass.
if [[ -e "$PUBLIC" ]]; then
  mv "$PUBLIC" "$PREVIOUS_PUBLIC"
  OLD_PUBLIC_STAGED=1
fi
if [[ -e "$ROOT/build/output" ]]; then
  mv "$ROOT/build/output" "$PREVIOUS_OUTPUT"
  OLD_OUTPUT_STAGED=1
fi
mv "$OUTPUT_NEXT" "$ROOT/build/output"
mv "$PUBLIC_NEXT" "$PUBLIC"
echo "Built and validated Ren'Py WebAssembly game at $PUBLIC/index.html"
echo "Validated candidate retained at $CANDIDATE"
if [[ $OLD_PUBLIC_STAGED -eq 1 ]]; then echo "Previous panel build preserved at $PREVIOUS_PUBLIC"; fi
if [[ $OLD_OUTPUT_STAGED -eq 1 ]]; then echo "Previous build output preserved at $PREVIOUS_OUTPUT"; fi
