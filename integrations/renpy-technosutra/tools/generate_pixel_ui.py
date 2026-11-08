#!/usr/bin/env python3
"""Generate the pixel-art UI frames (9-slice textures) for the main menu.

The VN's title screen is pixel art, so the chrome is drawn here instead of being
illustrated by hand: hard-edged bevels, stepped corners and a single accent line,
in sizes that scale cleanly through Ren'Py's Frame(). Every file is deterministic,
so a rebuild is a no-op diff.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "game" / "images" / "pixel"

# name: (size, border, fill, bevel_light, bevel_dark, accent, kind)
# kind: "frame" (plain 9-slice bevel) | "vine" (vine + flower adorned border)
# Sizes doubled (2x) vs the original 96/64/48/128/160 baseline so the
# 9-slice frames stay crisp when stretched across a 1920×1080 canvas.
FRAMES = {
    "pixel_panel.png": (192, 48, "#0b1220", "#2f4a5e", "#05070c", "#55edff", "frame"),
    "pixel_button.png": (128, 32, "#12202e", "#3c6a7d", "#05070c", "#2ea9bd", "frame"),
    "pixel_button_hover.png": (128, 32, "#1a2f42", "#9df3ff", "#05070c", "#55edff", "frame"),
    "pixel_start.png": (192, 44, "#16324a", "#55edff", "#05070c", "#f2cd5f", "frame"),
    "pixel_start_hover.png": (192, 44, "#1d4360", "#d9fbff", "#05070c", "#ffd97a", "frame"),
    "pixel_choice.png": (128, 32, "#101b29", "#2f5f70", "#05070c", "#55edff", "frame"),
    "pixel_choice_hover.png": (128, 32, "#15293c", "#8ee9ff", "#05070c", "#f2cd5f", "frame"),
    "pixel_nameplate.png": (96, 24, "#0d1725", "#55edff", "#05070c", "#55edff", "frame"),
    "pixel_slot.png": (128, 32, "#0a1420", "#24404f", "#05070c", "#2ea9bd", "frame"),
    "pixel_dialogue.png": (192, 48, "#0a1420", "#24404f", "#05070c", "#2ea9bd", "frame"),
    "pixel_choice_card.png": (192, 40, "#101b29", "#2f5f70", "#05070c", "#55edff", "frame"),
    "pixel_interstitial.png": (192, 48, "#0d1725", "#2f4a5e", "#05070c", "#2ea9bd", "frame"),
    "pixel_nav.png": (192, 48, "#0a1420", "#2f4a5e", "#05070c", "#55edff", "frame"),
    "pixel_slider_track.png": (128, 16, "#12202e", "#2f4a5e", "#05070c", "#8ad9c4", "frame"),
    "pixel_slider_thumb.png": (96, 12, "#1a2f42", "#9df3ff", "#05070c", "#55edff", "frame"),
    "pixel_frame_header.png": (192, 40, "#16324a", "#55edff", "#05070c", "#f2cd5f", "frame"),
    "pixel_quote_box.png": (160, 32, "#1d4360", "#d9fbff", "#05070c", "#ffd97a", "frame"),
    "pixel_divider.png": (128, 8, "#0b1220", "#2f4a5e", "#05070c", "#55edff", "frame"),
    "pixel_menu_panel.png": (256, 64, "#0b1220", "#2f4a5e", "#05070c", "#55edff", "frame"),
    # Vine + flower adorned borders (canvas-spanning adornment frames).
    "pixel_vine_panel.png": (256, 56, "#0a1420", "#2f4a5e", "#05070c", "#55edff", "vine"),
    "pixel_vine_choice.png": (256, 48, "#101b29", "#2f5f70", "#05070c", "#f472b6", "vine"),
    "pixel_vine_menu.png": (320, 72, "#0b1220", "#2f4a5e", "#05070c", "#fbbf24", "vine"),
    "pixel_vine_divider.png": (320, 12, "#0a1420", "#2f4a5e", "#05070c", "#4ade80", "vine"),
    "pixel_flower_corner.png": (128, 32, "#0a1420", "#2f4a5e", "#05070c", "#f472b6", "vine"),
}


def draw(size: int, border: int, fill: str, light: str, dark: str, accent: str, kind: str = "frame") -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()

    def box(left: int, top: int, right: int, bottom: int, colour: tuple[int, int, int, int]) -> None:
        for y in range(max(0, top), min(size, bottom)):
            for x in range(max(0, left), min(size, right)):
                pixels[x, y] = colour

    def rgba(value: str) -> tuple[int, int, int, int]:
        value = value.lstrip("#")
        return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), 255)

    fill_c, light_c, dark_c, accent_c = rgba(fill), rgba(light), rgba(dark), rgba(accent)

    # Stepped pixel corners: 2 px notch, then the bevel runs the full frame.
    box(2, 0, size - 2, 2, light_c)
    box(0, 2, 2, size - 2, light_c)
    box(2, 0, size - 2, 2, light_c)
    box(0, 2, 2, size - 4, light_c)
    box(2, size - 2, size - 2, size, dark_c)
    box(size - 2, 4, size, size - 2, dark_c)
    box(4, size - 2, size - 2, size, dark_c)
    box(size - 2, 4, size, size - 2, dark_c)
    box(2, 2, size - 2, size - 2, fill_c)
    # Inner accent rule, inset from the bevel so it stays inside the 9-slice border.
    box(border - 3, border - 3, size - border + 3, border - 2, accent_c)
    box(border - 3, size - border + 2, size - border + 3, size - border + 3, accent_c)
    box(border - 3, border - 3, border - 2, size - border + 3, accent_c)
    box(size - border + 2, border - 3, size - border + 3, size - border + 3, accent_c)

    if kind == "vine":
        _draw_vines_and_flowers(size, border, pixels, light_c, dark_c, accent_c)

    return image


def _draw_vines_and_flowers(size: int, border: int, pixels, light_c, dark_c, accent_c) -> None:
    """Draw a winding vine with leafy tendrils and blooming flowers around the
    inner edges of an adorned frame. Vines grow from each corner toward the
    center; flowers bloom at the corner buds and along the stems."""

    # Vine palette.
    vine_stem = (0x15, 0x80, 0x3d, 255)   # deep green stem
    vine_light = (0x4a, 0xde, 0x80, 255)  # bright vine highlight
    vine_dark = (0x06, 0x5f, 0x46, 255)   # shadowed stem
    leaf_c = (0x22, 0xc5, 0x5e, 255)      # leaf
    leaf_dark = (0x15, 0x80, 0x3d, 255)   # shaded leaf
    flower_pink = (0xf4, 0x72, 0xb6, 255)  # bloom
    flower_light = (0xfb, 0xcf, 0xe8, 255)  # petal highlight
    flower_center = (0xfb, 0xbf, 0x24, 255)  # stamen
    flower_dark = (0xbe, 0x18, 0x5d, 255)   # deep petal

    def px(x: int, y: int, colour) -> None:
        if 0 <= x < size and 0 <= y < size:
            pixels[x, y] = colour

    def line(x0: int, y0: int, x1: int, y1: int, colour) -> None:
        # Bresenham-ish pixel line for crisp pixel stems.
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        x, y = x0, y0
        while True:
            px(x, y, colour)
            if x == x1 and y == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x += sx
            if e2 < dx:
                err += dx
                y += sy

    def leaf(cx: int, cy: int, dx: int, dy: int, colour) -> None:
        # Small 2-leaf cluster branching off a stem node.
        for (lx, ly) in (
            (cx + dx * 1, cy + dy * 1),
            (cx + dx * 2, cy + dy * 1),
            (cx + dy * 1, cy + dx * 1),
            (cx - dy * 1, cy - dx * 1),
        ):
            px(lx, ly, colour)

    def flower(cx: int, cy: int) -> None:
        # 5-petal bloom around a yellow stamen.
        px(cx, cy, flower_center)
        for (px_, py_) in (
            (cx, cy - 2), (cx, cy + 2), (cx - 2, cy), (cx + 2, cy),
            (cx - 1, cy - 1), (cx + 1, cy - 1), (cx - 1, cy + 1), (cx + 1, cy + 1),
        ):
            px(px_, py_, flower_pink)
        for (px_, py_) in ((cx, cy - 1), (cx, cy + 1), (cx - 1, cy), (cx + 1, cy)):
            px(px_, py_, flower_light)
        px(cx - 1, cy - 1, flower_dark)
        px(cx + 1, cy + 1, flower_dark)

    # Inner drawable area (inside the bevel border).
    inner = border
    maxx = size - inner
    maxy = size - inner

    # Four corner vine stems growing inward along each edge.
    corners = [
        (inner + 2, inner + 2, 1, 1),      # top-left, down-right
        (maxx - 3, inner + 2, -1, 1),      # top-right, down-left
        (inner + 2, maxy - 3, 1, -1),      # bottom-left, up-right
        (maxx - 3, maxy - 3, -1, -1),      # bottom-right, up-left
    ]

    for (cx, cy, sx, sy) in corners:
        # Main stem runs along the corner's dominant axis toward center.
        stem_len = max(4, min(size // 6, 14))
        for t in range(1, stem_len + 1):
            x = cx + sx * t
            y = cy + sy * t
            # Wavy stem: slight lateral sway.
            sway = 1 if (t // 2) % 2 == 0 else 0
            px(x + (sway if sx == 0 else 0), y + (sway if sy == 0 else 0), vine_stem)
            px(x, y, vine_light)
            # Shadow edge.
            px(x - sx, y - sy, vine_dark)
            # Leaves branching off the stem every few steps.
            if t % 3 == 0:
                leaf(x, y, sx, sy, leaf_c)
                leaf(x - sy, y - sx, sx, sy, leaf_dark)
            # Flowers bloom at stem tips and intervals.
            if t == stem_len or t % 5 == 0:
                flower(x, y)

    # Bloom a few extra flowers at mid-edges.
    for (ex, ey) in (
        (inner + 6, maxy // 2), (maxx - 7, maxy // 2),
        (maxx // 2, inner + 6), (maxx // 2, maxy - 7),
    ):
        flower(ex, ey)
        leaf(ex, ey, 1, 0, leaf_c)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify the committed frames match the generator")
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    drift = []
    for name, spec in FRAMES.items():
        size, border, fill, light, dark, accent, kind = spec
        target = OUTPUT / name
        image = draw(size, border, fill, light, dark, accent, kind)
        expected = f"{(size, border, fill, light, dark, accent, kind)}"
        if args.check:
            if not target.is_file():
                drift.append(f"{name} is missing")
            continue
        image.save(target, format="PNG", optimize=True)
        records.append({
            "file": name,
            "width": size,
            "height": size,
            "frameBorder": border,
            "kind": kind,
            "palette": {"fill": fill, "bevelLight": light, "bevelDark": dark, "accent": accent},
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "sizeBytes": target.stat().st_size,
            "generator": "tools/generate_pixel_ui.py",
            "expected": expected,
        })
    if args.check:
        if drift:
            raise SystemExit("pixel UI drift: " + "; ".join(drift))
        print(f"pixel UI frames present: {len(FRAMES)}")
        return 0
    manifest = {
        "schemaVersion": 1,
        "title": "The Stem Array — pixel-art UI frames",
        "provenance": "Procedurally generated by tools/generate_pixel_ui.py; no external artwork.",
        "count": len(records),
        "averageBytes": round(sum(r["sizeBytes"] for r in records) / max(1, len(records))),
        "assets": records,
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(r["sizeBytes"] for r in records)
    print(f"Wrote {len(records)} pixel UI frames to {OUTPUT} ({total:,} bytes total, avg {manifest['averageBytes']} B)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
