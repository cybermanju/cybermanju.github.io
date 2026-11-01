#!/usr/bin/env python3
"""Split transparent 2x2 master sprite sheets into Ren'Py animation frames."""
from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "game" / "images" / "masters" / "sprites"
FRAME_NAMES = ("idle", "talk_open", "talk_closed", "gesture")


def split_sheet(source: Path, output: Path) -> list[Path]:
    image = Image.open(source).convert("RGBA")
    alpha_min, alpha_max = image.getchannel("A").getextrema()
    if alpha_min != 0 or alpha_max == 0:
        raise ValueError(f"Expected a visible figure on a truly transparent background: {source}")
    if image.width % 2 or image.height % 2 or image.width / image.height != 2 / 3:
        raise ValueError(f"Expected an exact 2:3 ratio divisible into a 2x2 grid: {source} ({image.size})")
    cell_w, cell_h = image.width // 2, image.height // 2
    chapter_number = source.stem.removeprefix("master_")
    output.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    for index, name in enumerate(FRAME_NAMES):
        left = (index % 2) * cell_w
        top = (index // 2) * cell_h
        target = output / f"master_{chapter_number}_{name}.png"
        image.crop((left, top, left + cell_w, top + cell_h)).save(target, format="PNG", optimize=True)
        outputs.append(target)
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheets", type=Path, help="Directory containing master_XX.png sprite sheets")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Directory for Ren'Py frames")
    args = parser.parse_args()
    sheets = sorted(args.sheets.glob("master_[0-9][0-9].png"))
    if not sheets:
        raise SystemExit(f"No master_XX.png sprite sheets found in {args.sheets}")
    for sheet in sheets:
        outputs = split_sheet(sheet, args.output)
        print(f"{sheet.name}: {', '.join(path.name for path in outputs)}")
    print(f"Split {len(sheets)} sheets into {len(sheets) * 4} transparent frames in {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
