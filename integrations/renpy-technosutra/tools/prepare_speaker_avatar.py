#!/usr/bin/env python3
"""Prepare the anonymous speaker silhouette for compact Ren'Py runtime use."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-source" / "generic_speaker_shadow_master.png"
OUT_DIR = ROOT / "game" / "images" / "speakers"
OUTPUT = OUT_DIR / "generic_speaker_shadow.png"
PROVENANCE = OUT_DIR / "provenance.json"
SIZE = (512, 512)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Generated master silhouette is missing: {SOURCE}")

    source = Image.open(SOURCE).convert("RGBA")
    if source.width != source.height:
        raise SystemExit(f"Expected a square master silhouette; found {source.size}")

    alpha = source.getchannel("A")
    alpha_min, alpha_max = alpha.getextrema()
    if alpha_min != 0 or alpha_max < 240:
        raise SystemExit("Master silhouette must have native transparent background and opaque figure pixels")
    visible = sum(1 for value in alpha.getdata() if value > 32)
    coverage = visible / (source.width * source.height)
    if not 0.10 <= coverage <= 0.75:
        raise SystemExit(f"Unexpected silhouette coverage: {coverage:.1%}")

    # Keep only the generated silhouette's alpha, normalize the figure to black,
    # and downsample without cropping or changing its aspect ratio.
    normalized = Image.new("RGBA", source.size, (0, 0, 0, 255))
    normalized.putalpha(alpha)
    runtime = normalized.resize(SIZE, Image.Resampling.LANCZOS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    runtime.save(OUTPUT, format="PNG", optimize=True)

    check = Image.open(OUTPUT).convert("RGBA")
    if check.size != SIZE or check.getchannel("A").getextrema()[0] != 0:
        raise SystemExit("Runtime silhouette failed size or transparency verification")
    if any(r or g or b for r, g, b, _a in check.getdata()):
        raise SystemExit("Runtime silhouette contains non-black visible pixels")

    provenance = {
        "schemaVersion": 1,
        "status": "owner-requested_original_speaker_fallback",
        "asset": str(OUTPUT.relative_to(ROOT)),
        "dimensions": list(SIZE),
        "format": "PNG",
        "alphaChannel": True,
        "sourceMaster": str(SOURCE.relative_to(ROOT)),
        "sourceSha256": sha256(SOURCE),
        "runtimeSha256": sha256(OUTPUT),
        "runtimeBytes": OUTPUT.stat().st_size,
        "creation": "Original AI-generated, generic featureless human bust silhouette; the user-provided image informed only the broad shadow-figure concept, with no source pixels or identifying details copied.",
        "generator": "gpt-image-2.5, medium quality",
        "runtimeTransform": "Preserved the generated alpha mask, normalized all visible RGB pixels to pure black, and downsampled the square master with Lanczos; no crop or external imagery.",
        "usage": "Fallback portrait only for non-Orbe speakers without an explicit entry in stem_speaker_portraits; does not replace scene illustrations or the Orbe narrator orb.",
    }
    PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {OUTPUT} ({SIZE[0]}x{SIZE[1]}, {OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
