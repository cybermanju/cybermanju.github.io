#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${RENPY_SDK:-/tmp/renpy-sdk/renpy-8.5.3-sdk}"
if [[ -n "${BUILD_ID:-}" ]]; then
  :
elif [[ -n "${RENPY_STAGING_DIR:-}" ]]; then
  BUILD_ID="ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
else
  BUILD_ID="local-$(date -u +%Y%m%dT%H%M%SZ)"
fi
PARENT="${RENPY_STAGING_DIR:-$ROOT/build/local}"
BUILD_ROOT="$PARENT/$BUILD_ID"
PROJECT="$BUILD_ROOT/source"
STAGING="$BUILD_ROOT/candidate"
OUTPUT="$BUILD_ROOT/output"
VISUAL="$BUILD_ROOT/visual-review"
LOG="$BUILD_ROOT/build.log"
EXPECTED_PYTHON="3.12"
EXPECTED_PILLOW="12.3.0"
EXPECTED_PLAYWRIGHT="1.62.0"

if [[ $# -gt 1 || ( $# -eq 1 && "${1:-}" != "--candidate-only" ) ]]; then
  echo "Only the legacy no-publish flag --candidate-only is accepted; this script never promotes or publishes." >&2
  exit 2
fi
if [[ ! "$BUILD_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "BUILD_ID may contain only letters, numbers, dot, underscore, and hyphen." >&2
  exit 2
fi
if [[ -e "$BUILD_ROOT" ]]; then
  echo "Refusing to overwrite existing build path: $BUILD_ROOT" >&2
  exit 2
fi
if [[ ! -x "$SDK/renpy.sh" || ! -d "$SDK/web" ]]; then
  echo "Ren'Py 8.5.3 SDK with Web support not found at $SDK. Set RENPY_SDK or use tools/install_renpy_sdk.sh." >&2
  exit 2
fi
if ! command -v xvfb-run >/dev/null; then
  echo "xvfb-run is required for headless Ren'Py lint/build." >&2
  exit 2
fi

PYTHON_VERSION="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')"
PILLOW_VERSION="$(python3 -c 'import PIL; print(PIL.__version__)' 2>/dev/null || true)"
PLAYWRIGHT_VERSION="$(python3 -c 'from importlib.metadata import version; print(version("playwright"))' 2>/dev/null || true)"
if [[ "$PYTHON_VERSION" != "$EXPECTED_PYTHON" || "$PILLOW_VERSION" != "$EXPECTED_PILLOW" || "$PLAYWRIGHT_VERSION" != "$EXPECTED_PLAYWRIGHT" ]]; then
  echo "Build dependencies differ from the pinned environment:" >&2
  echo "  Python $PYTHON_VERSION (expected $EXPECTED_PYTHON.x)" >&2
  echo "  Pillow $PILLOW_VERSION (expected $EXPECTED_PILLOW)" >&2
  echo "  Playwright $PLAYWRIGHT_VERSION (expected $EXPECTED_PLAYWRIGHT)" >&2
  echo "Install integrations/renpy-technosutra/requirements-renpy.txt with Python 3.12." >&2
  exit 2
fi

mkdir -p "$BUILD_ROOT"
exec > >(tee -a "$LOG") 2>&1
export TZ=UTC
export PYTHONHASHSEED=0

SDK_VERSION="$(xvfb-run -a "$SDK/renpy.sh" --version 2>&1 | tail -n 1)"
if [[ "$SDK_VERSION" != "Ren'Py 8.5.3."* ]]; then
  echo "Expected Ren'Py 8.5.3, found: $SDK_VERSION" >&2
  exit 2
fi

echo "Build ID: $BUILD_ID"
echo "SDK: $SDK_VERSION ($SDK)"
echo "Python: $PYTHON_VERSION; Pillow: $PILLOW_VERSION; Playwright: $PLAYWRIGHT_VERSION"
echo "All outputs stay under $BUILD_ROOT; public/ is never read or written."

# Work on a disposable copy: generation, lint, and Ren'Py compilation cannot
# alter the source tree or its ignored original assets/saves.
mkdir -p "$PROJECT"
cp -a "$ROOT/game" "$PROJECT/game"
cp "$ROOT/chapters.json" "$ROOT/project.json" "$PROJECT/"
mkdir -p "$PROJECT/tools"
cp "$ROOT/tools/"*.py "$PROJECT/tools/"
find "$PROJECT/game" -type f -name '*.rpyc' -delete
rm -rf "$PROJECT/game/cache" "$PROJECT/game/saves"

# Generate in the staging copy with all upstream render references disabled.
python3 "$PROJECT/tools/generate_renpy_script.py" --exclude-upstream-renders
python3 "$PROJECT/tools/generate_master_sprite_script.py" --exclude-upstream-renders
python3 "$PROJECT/tools/prepare_assets.py"
python3 "$PROJECT/tools/validate_optimized_assets.py" --project "$PROJECT"
python3 "$PROJECT/tools/create_art_comparison.py" --project "$PROJECT" --output "$VISUAL"
python3 "$PROJECT/tools/prepare_local_build.py" --project "$PROJECT"

python3 - "$PROJECT/game" <<'PY'
from pathlib import Path
import re, sys
root = Path(sys.argv[1])
images = root / "images"
story = (root / "script.rpy").read_text(encoding="utf-8")
gallery = (root / "technosutra_masters.rpy").read_text(encoding="utf-8")
if len(re.findall(r'^image bg_ch\d{2} = "images/optimized/bg_ch\d{2}\.jpg"$', story, re.M)) != 56:
    raise SystemExit("Sanitized story must reference all 56 optimized backgrounds")
if re.search(r"image\s+(?:master_ch|gallery_master)_\d{2}_provisional|show\s+master_ch\d{2}_provisional", story + gallery):
    raise SystemExit("Upstream render image declarations/references remain in the staging scripts")
if not re.search(r"^label technosutra_master_gallery:", gallery, re.M) or "renders brutos do upstream" not in gallery:
    raise SystemExit("License-safe gallery notice is missing")
if (images / "masters").exists():
    raise SystemExit("Upstream renders/manifests must be removed from staging before packaging")
if len(list((images / "optimized").glob("bg_ch*.jpg"))) != 56:
    raise SystemExit("Expected exactly 56 optimized chapter backgrounds")
if list(images.rglob("*.png")) or list(images.rglob("*.glb")):
    raise SystemExit("Upstream PNG/GLB files remain in staged game/images")
PY

# Lint and WebAssembly build are local/CI validation only; never promote to public/.
xvfb-run -a "$SDK/renpy.sh" "$PROJECT" lint --error-code
mkdir -p "$STAGING"
xvfb-run -a "$SDK/renpy.sh" "$SDK/launcher" web_build "$PROJECT" --destination "$STAGING"
INDEX="$(find "$STAGING" -type f -name index.html -print -quit)"
if [[ -z "$INDEX" ]]; then
  echo "Ren'Py web_build completed without index.html under $STAGING" >&2
  exit 3
fi
WEB_DIR="$(dirname "$INDEX")"
for required in index.html game.zip renpy.js renpy.wasm; do
  if [[ ! -s "$WEB_DIR/$required" ]]; then
    echo "Ren'Py candidate is missing required web artifact: $WEB_DIR/$required" >&2
    exit 4
  fi
done

python3 "$PROJECT/tools/validate_web_candidate.py" "$WEB_DIR" --project "$PROJECT"

mkdir -p "$OUTPUT"
cp -a "$WEB_DIR"/. "$OUTPUT"/
CANDIDATE_HASH="$(sha256sum "$WEB_DIR/game.zip" | cut -d' ' -f1)"
OUTPUT_HASH="$(sha256sum "$OUTPUT/game.zip" | cut -d' ' -f1)"
if [[ "$CANDIDATE_HASH" != "$OUTPUT_HASH" ]]; then
  echo "Copied game.zip hash does not match validated candidate." >&2
  exit 5
fi

python3 "$PROJECT/tools/smoke_web_build.py" "$OUTPUT" --report "$BUILD_ROOT/smoke-report.json"
python3 - "$BUILD_ROOT" "$PROJECT" "$OUTPUT" "$SDK_VERSION" "$PILLOW_VERSION" "$PLAYWRIGHT_VERSION" <<'PY'
from pathlib import Path
import hashlib, json, sys
build_root = Path(sys.argv[1])
project = Path(sys.argv[2])
output = Path(sys.argv[3])
sdk, pillow, playwright = sys.argv[4:7]
images = project / "game/images"
asset_manifest = json.loads((images / "optimized/manifest.json").read_text(encoding="utf-8"))
smoke = json.loads((build_root / "smoke-report.json").read_text(encoding="utf-8"))
zip_path = output / "game.zip"
digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
output_bytes = sum(path.stat().st_size for path in output.rglob("*") if path.is_file())
report = {
    "status": "PASS",
    "buildId": build_root.name,
    "engine": sdk,
    "python": "3.12",
    "pillow": pillow,
    "playwright": playwright,
    "buildRoot": str(build_root),
    "webOutput": str(output),
    "indexHtml": str(output / "index.html"),
    "gameZip": str(zip_path),
    "gameZipBytes": zip_path.stat().st_size,
    "gameZipSha256": digest,
    "webOutputBytes": output_bytes,
    "existingJpegBytes": asset_manifest["baselineExistingJpegBytes"],
    "originalPngBytes": asset_manifest["sourcePngBytes"],
    "optimizedImageBytes": asset_manifest["optimizedBytes"],
    "optimizedImageSavingsPercentVsExistingJpegs": round((1 - asset_manifest["optimizedBytes"] / asset_manifest["baselineExistingJpegBytes"]) * 100, 2),
    "optimizedImageSavingsPercentVsOriginalPngs": round((1 - asset_manifest["optimizedBytes"] / asset_manifest["sourcePngBytes"]) * 100, 2),
    "optimizedImageCount": asset_manifest["count"],
    "fidelityPsnrMinDb": min(asset["psnrDb"] for asset in asset_manifest["assets"]),
    "fidelityPsnrMeanDb": round(sum(asset["psnrDb"] for asset in asset_manifest["assets"]) / len(asset_manifest["assets"]), 4),
    "upstreamRenderAssetsPackaged": 0,
    "upstreamRenderAssetsExcludedByLicensePolicy": 54,
    "rawSourceCapturePngsInPackage": False,
    "upstreamSpriteGallery": "license notice only; no image assets",
    "visualComparisonDirectory": str(build_root / "visual-review"),
    "smokeTest": smoke,
}
report_path = build_root / "build-report.json"
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Build report: {report_path}")
print(f"Local output: {output}")
print(f"game.zip: {zip_path.stat().st_size:,} bytes; SHA-256 {digest}")
print("Upstream render assets packaged: 0 (54 excluded due to license conflict)")
print(f"Visual comparison sheets: {build_root / 'visual-review'}")
PY
