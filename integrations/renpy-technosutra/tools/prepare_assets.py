#!/usr/bin/env python3
"""Prepare selected original/generated backgrounds as lightweight Ren'Py JPEGs."""
from __future__ import annotations

from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "game" / "images"
SOURCES: dict[str, Path] = {
    "bg_intro_scene.jpg": IMAGES / "bg_intro_generic.png",
}
for chapter in range(1, 57):
    styled = IMAGES / f"bg_ch{chapter:02d}_cyberpunk.png"
    SOURCES[f"bg_ch{chapter:02d}.jpg"] = styled

missing = [str(source) for source in SOURCES.values() if not source.exists()]
if missing:
    raise SystemExit("Missing original/generated artwork:\n" + "\n".join(missing))

records = []
for target_name, source in SOURCES.items():
    target = IMAGES / target_name
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        image = Image.open(target)
        records.append({
            "file": target_name,
            "source": source.name,
            "width": image.width,
            "height": image.height,
            "sizeBytes": target.stat().st_size,
        })
        continue

    image = Image.open(source).convert("RGB")
    source_width, source_height = image.size
    if abs(source_width / source_height - 16 / 9) > 0.01:
        raise SystemExit(f"Unexpected aspect ratio for {source}: {source_width}x{source_height}")
    if image.size != (1920, 1080):
        image = image.resize((1920, 1080), Image.Resampling.LANCZOS)
    image.save(target, "JPEG", quality=90, optimize=True, progressive=True, subsampling=0)
    records.append({
        "file": target_name,
        "source": source.name,
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "width": image.width,
        "height": image.height,
        "sizeBytes": target.stat().st_size,
    })

manifest = {
    "title": "The Stem Array — original anime cyberpunk background pack",
    "count": len(records),
    "openingBackground": "bg_intro_scene.jpg",
    "chapterBackgrounds": 56,
    "notes": "The opening is a wholly original environment and does not use the supplied JPEG while its origin is unconfirmed. All 56 chapter backgrounds are original illustrations with their cyberpunk/ASCII variants selected for the game. Unspecified source settings are shown abstractly and non-canonically. No Street View imagery or derivatives are included.",
    "assets": records,
}
(IMAGES / "assets-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} JPEG images (1920x1080) in {IMAGES}")
print(f"Total image bytes: {sum(row['sizeBytes'] for row in records):,}")
print("PNG originals retained; source images are not deleted by asset preparation.")
