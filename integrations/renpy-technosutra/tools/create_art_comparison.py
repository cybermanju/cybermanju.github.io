#!/usr/bin/env python3
"""Create optional local contact sheets for the original and optimized art."""
from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image, ImageDraw

THUMB = (480, 270)
CELL_W = THUMB[0] * 2
CELL_H = THUMB[1] + 48
SHEET_SIZE = (CELL_W * 2, CELL_H * 2)


def resized(path: Path) -> Image.Image:
    with Image.open(path) as opened:
        return opened.convert("RGB").resize(THUMB, Image.Resampling.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    images = args.project / "game" / "images"
    args.output.mkdir(parents=True, exist_ok=True)

    png_sources = [images / f"bg_ch{chapter:02d}_cyberpunk.png" for chapter in range(1, 57)]
    jpeg_sources = [images / f"bg_ch{chapter:02d}.jpg" for chapter in range(1, 57)]
    if all(path.is_file() for path in png_sources):
        sources, source_label = png_sources, "PNG original"
    elif all(path.is_file() for path in jpeg_sources):
        sources, source_label = jpeg_sources, "JPEG-base anterior"
    else:
        note = (
            "Visual comparison skipped for this compact checkout: original PNGs and prior JPEG baselines "
            "are local-only inputs and are not required by CI.\n"
            "The optimized-asset manifest preserves source/output SHA-256 values and generation-time PSNR; "
            "the CI validator checks every optimized file and chapter mapping.\n"
            "Run locally with the complete original PNG set or complete prior-JPEG set to generate 14 side-by-side sheets.\n"
        )
        status_path = args.output / "VISUAL-REVIEW-SKIPPED.txt"
        status_path.write_text(note, encoding="utf-8")
        print(f"Optional visual comparison skipped; wrote {status_path}")
        return 0

    for page in range(14):
        sheet = Image.new("RGB", SHEET_SIZE, "#111827")
        draw = ImageDraw.Draw(sheet)
        for slot in range(4):
            chapter = page * 4 + slot + 1
            col, row = slot % 2, slot // 2
            x, y = col * CELL_W, row * CELL_H
            draw.rectangle((x, y, x + CELL_W - 1, y + 29), fill="#26354b")
            draw.text((x + 10, y + 7), f"Capítulo {chapter:02d} — antes / derivado otimizado", fill="white")
            derivative = images / "optimized" / f"bg_ch{chapter:02d}.jpg"
            if not derivative.is_file():
                raise SystemExit(f"Missing optimized comparison image for chapter {chapter}: {derivative}")
            draw.text((x + 6, y + 32), source_label, fill="#cbd5e1")
            draw.text((x + THUMB[0] + 6, y + 32), "JPEG otimizado (q85, 4:4:4)", fill="#cbd5e1")
            sheet.paste(resized(sources[chapter - 1]), (x, y + 48))
            sheet.paste(resized(derivative), (x + THUMB[0], y + 48))
        output_path = args.output / f"visual-review-{page + 1:02d}.jpg"
        sheet.save(output_path, "JPEG", quality=90, optimize=True, progressive=True)
        print(output_path)
    print(f"Created 14 comparison sheets covering all 56 {source_label}/optimized pairs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
