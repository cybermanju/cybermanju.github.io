#!/usr/bin/env python3
# CyberManju OS — Ren'Py velvet UI textures (integrations/renpy-technosutra/tools/generate_velvet_textures.py).
# Role: creates original, repeatable velvet-inspired interface tiles; Exports: PNG textures and provenance manifest.
# Integrates: Pillow and Ren'Py game/images/ui; Contracts: no external images, fonts, or upstream art are inputs.
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "game" / "images" / "ui"
SIZE = 256

# Each UI surface has its own mathematical motif and restrained, high-contrast palette.
SURFACES: dict[str, tuple[str, str, str]] = {
    "dialogue": ("#21131f", "#7c4965", "#ead0dc"),       # flowing velvet nap
    "panel": ("#171b2a", "#526487", "#c7d2ec"),          # interlocking diamonds
    "choice": ("#211833", "#8063a5", "#e4d6f5"),         # nested lozenges
    "question": ("#172724", "#54877b", "#cce8d7"),      # rosette / radial petals
    "button": ("#30203a", "#9a719b", "#f1d9eb"),        # herringbone weave
    "tabs": ("#20243a", "#7184b3", "#d6def9"),           # concentric orbit arcs
    "slots": ("#242033", "#8c739f", "#dfcfea"),          # square lattice + stars
    "controls": ("#1b292e", "#5d8c8c", "#d0ebe5"),      # dotted wave field
    "menu": ("#281825", "#8b526c", "#f0d2dc"),          # repeating floral geometry
    "interstitial": ("#1b202e", "#6c789d", "#e0e6fb"),  # layered arc field
    "nameplate": ("#0d1926", "#20dbd0", "#f252d0"),    # neon pixel-grid HUD
}


def as_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def rgba(value: str, alpha: int) -> tuple[int, int, int, int]:
    return (*as_rgb(value), alpha)


def draw_motif(draw: ImageDraw.ImageDraw, name: str, size: int, scale: int, accent: tuple[int, int, int, int], glint: tuple[int, int, int, int]) -> None:
    s = scale
    def xy(value: float) -> int:
        return round(value * s)

    if name in {"panel", "choice"}:
        step = 64
        inset = 22 if name == "panel" else 27
        for cy in range(-step, size + step, step):
            for cx in range(-step, size + step, step):
                points = [(xy(cx), xy(cy - inset)), (xy(cx + inset), xy(cy)), (xy(cx), xy(cy + inset)), (xy(cx - inset), xy(cy))]
                draw.line(points + [points[0]], fill=accent, width=xy(1.2), joint="curve")
                if name == "choice":
                    inner = inset * 0.42
                    small = [(xy(cx), xy(cy - inner)), (xy(cx + inner), xy(cy)), (xy(cx), xy(cy + inner)), (xy(cx - inner), xy(cy))]
                    draw.line(small + [small[0]], fill=glint, width=xy(1.0), joint="curve")
                draw.ellipse((xy(cx - 2), xy(cy - 2), xy(cx + 2), xy(cy + 2)), fill=glint)
    elif name == "question":
        step = 96
        radius = 29
        for cy in range(-step, size + step, step):
            for cx in range(-step, size + step, step):
                for ring in (1.0, 0.62):
                    r = radius * ring
                    draw.ellipse((xy(cx-r), xy(cy-r), xy(cx+r), xy(cy+r)), outline=accent if ring == 1 else glint, width=xy(1.1))
                for petal in range(8):
                    angle = math.tau * petal / 8
                    px, py = cx + 17 * math.cos(angle), cy + 17 * math.sin(angle)
                    draw.ellipse((xy(px-6), xy(py-4), xy(px+6), xy(py+4)), outline=glint, width=xy(1.0))
                draw.ellipse((xy(cx-2), xy(cy-2), xy(cx+2), xy(cy+2)), fill=accent)
    elif name == "button":
        step = 36
        for y in range(-step, size + step, step):
            for x in range(-step, size + step, step):
                offset = step // 2 if (y // step) % 2 else 0
                x += offset
                draw.line([(xy(x-step/2), xy(y)), (xy(x), xy(y-step/2)), (xy(x+step/2), xy(y)), (xy(x), xy(y+step/2)), (xy(x-step/2), xy(y))], fill=accent, width=xy(1.0), joint="curve")
                draw.line([(xy(x-step/3), xy(y)), (xy(x), xy(y-step/3)), (xy(x+step/3), xy(y))], fill=glint, width=xy(0.8), joint="curve")
    elif name == "tabs":
        step = 128
        for cy in range(0, size + step, step):
            for cx in range(0, size + step, step):
                for radius in (20, 34, 48, 62):
                    box = (xy(cx-radius), xy(cy-radius), xy(cx+radius), xy(cy+radius))
                    draw.arc(box, start=25, end=325, fill=accent if radius % 2 else glint, width=xy(1.2))
                draw.ellipse((xy(cx-3), xy(cy-3), xy(cx+3), xy(cy+3)), fill=glint)
    elif name == "slots":
        step = 48
        for cy in range(-step, size + step, step):
            for cx in range(-step, size + step, step):
                draw.rectangle((xy(cx-16), xy(cy-16), xy(cx+16), xy(cy+16)), outline=accent, width=xy(1.0))
                draw.line([(xy(cx-8), xy(cy)), (xy(cx), xy(cy-8)), (xy(cx+8), xy(cy)), (xy(cx), xy(cy+8)), (xy(cx-8), xy(cy))], fill=glint, width=xy(1.0))
    elif name == "controls":
        step = 32
        for y in range(-step, size + step, step):
            points = []
            for x in range(-step, size + step + 1, 4):
                yy = y + 7 * math.sin(math.tau * x / 96)
                points.append((xy(x), xy(yy)))
            draw.line(points, fill=accent, width=xy(1.0))
            for x in range((y // step % 2) * 16, size + step, step):
                yy = y + 7 * math.sin(math.tau * x / 96)
                draw.ellipse((xy(x-1.7), xy(yy-1.7), xy(x+1.7), xy(yy+1.7)), fill=glint)
    elif name == "menu":
        step = 64
        for cy in range(-step, size + step, step):
            for cx in range(-step, size + step, step):
                for ring in (12, 22, 30):
                    draw.ellipse((xy(cx-ring), xy(cy-ring), xy(cx+ring), xy(cy+ring)), outline=accent if ring != 22 else glint, width=xy(1.0))
                for petal in range(4):
                    angle = math.tau * petal / 4
                    px, py = cx + 18 * math.cos(angle), cy + 18 * math.sin(angle)
                    draw.ellipse((xy(px-5), xy(py-9), xy(px+5), xy(py+9)), outline=glint, width=xy(1.0))
    elif name == "interstitial":
        step = 96
        for cy in range(-step, size + step, step):
            for cx in range(-step, size + step, step):
                for radius in (16, 30, 44):
                    draw.arc((xy(cx-radius), xy(cy-radius), xy(cx+radius), xy(cy+radius)), 0, 310, fill=accent, width=xy(1.2))
                draw.line([(xy(cx-8), xy(cy)), (xy(cx), xy(cy-8)), (xy(cx+8), xy(cy)), (xy(cx), xy(cy+8)), (xy(cx-8), xy(cy))], fill=glint, width=xy(1.0))
    elif name == "nameplate":
        # Staggered square clusters evoke pixel circuitry without a noisy field.
        step = 32
        for cy in range(-step, size + step, step):
            for cx in range(-step, size + step, step):
                phase = (cx // step + cy // step) % 3
                if phase == 0:
                    draw.rectangle((xy(cx), xy(cy), xy(cx+5), xy(cy+5)), fill=accent)
                    draw.rectangle((xy(cx+8), xy(cy), xy(cx+13), xy(cy+5)), fill=glint)
                elif phase == 1:
                    draw.rectangle((xy(cx), xy(cy), xy(cx+5), xy(cy+5)), fill=glint)
                    draw.rectangle((xy(cx+8), xy(cy+8), xy(cx+13), xy(cy+13)), fill=accent)
                    draw.rectangle((xy(cx+16), xy(cy+8), xy(cx+21), xy(cy+13)), fill=glint)
    elif name == "dialogue":
        # Periodic, curved nap-lines create a soft velvet sheen without busy detail.
        for band in range(-3, 12):
            points = []
            for x in range(-scale, (size + 2) * scale, max(1, scale)):
                ux = x / scale
                uy = band * 24 + 9 * math.sin(math.tau * (ux / size + band * 0.07)) + 3 * math.sin(math.tau * ux / 64)
                points.append((x, round(uy * scale)))
            draw.line(points, fill=accent if band % 3 else glint, width=scale)


def make_tile(name: str, colors: tuple[str, str, str], glass: bool) -> Image.Image:
    base, accent_color, glint_color = colors
    alpha = 218 if glass else 255
    hi = 2
    canvas = Image.new("RGBA", (SIZE * hi, SIZE * hi), rgba(base, alpha))
    px = canvas.load()
    r0, g0, b0 = as_rgb(base)
    # Periodic, low-amplitude luminosity bands imitate a brushed velvet nap and
    # wrap cleanly at the tile edges; no noisy photographic texture is imported.
    for y in range(SIZE * hi):
        for x in range(SIZE * hi):
            ux, uy = x / hi, y / hi
            nap = 5.0 * math.sin(math.tau * (ux + uy * 0.31) / SIZE) + 2.3 * math.cos(math.tau * uy / SIZE)
            fiber = 1.2 * math.sin(math.tau * (ux * 7 + uy * 0.6) / SIZE)
            shade = int(round(nap + fiber))
            px[x, y] = (max(0, min(255, r0 + shade)), max(0, min(255, g0 + shade)), max(0, min(255, b0 + shade)), alpha)
    draw = ImageDraw.Draw(canvas, "RGBA")
    pattern_alpha = 45 if glass else 58
    glint_alpha = 25 if glass else 33
    draw_motif(draw, name, SIZE, hi, rgba(accent_color, pattern_alpha), rgba(glint_color, glint_alpha))
    return canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    assets = []
    for name, palette in SURFACES.items():
        for mode in ("flat", "glass"):
            path = OUT / f"velvet_{name}_{mode}.png"
            make_tile(name, palette, mode == "glass").save(path, optimize=True)
            data = path.read_bytes()
            assets.append({"file": str(path.relative_to(ROOT)), "width": SIZE, "height": SIZE, "mode": mode, "surface": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    manifest = {
        "status": "original_procedural_ui_textures",
        "generator": "tools/generate_velvet_textures.py",
        "method": "Mathematical line, curve, lattice, and rosette patterns rendered with Pillow; no reference images, external art, or upstream assets used.",
        "tileSize": [SIZE, SIZE],
        "surfaces": list(SURFACES),
        "variants": ["flat", "glass"],
        "assets": assets,
    }
    (OUT / "provenance.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(assets)} original velvet tiles and provenance at {OUT}")


if __name__ == "__main__":
    main()
