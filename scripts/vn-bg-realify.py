#!/usr/bin/env python3
"""CyberManju OS — VN background real-life look + living camera (scripts/vn-bg-realify.py).

Role: color-grade chapter backgrounds so a painted/illustrative render reads as a
natural, real-life avenue/space photograph, and emit Ren'Py ATL camera transforms
that keep every background alive (slow zoom in/out + panning look-around) when the
chapter is shown.
Exports: --root (runtime dir), --in-glob, --out (derivatives dir), --quality,
         --transforms-out (Ren'Py ATL transforms file).
Integrates: scripts/vn-dev.mjs can serve the realified derivatives in place of the
            originals; tools/generate_renpy_script.py applies the emitted
            `stem_bg_chNN_camera` transform to each `scene bg_chNN` so the
            background moves while the standing cast stays still.
Contracts: preserves each image's exact dimensions (1920x1080 backgrounds);
           never overwrites the source; only PNG/JPEG/WebP inputs; degrades
           gracefully (leaves files untouched) when Pillow is absent.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageEnhance, ImageOps
except Exception:  # pragma: no cover - Pillow missing must degrade, not crash
    Image = None  # type: ignore[assignment]
    ImageEnhance = None  # type: ignore[assignment]
    ImageOps = None  # type: ignore[assignment]

PROFILE_VERSION = 1
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def profile_signature(quality: int, contrast: float, color: float, brightness: float) -> str:
    raw = f"v{PROFILE_VERSION}|q{quality}|c{contrast}|r{color}|b{brightness}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def realify(image: Image.Image) -> Image.Image:
    """Return a real-life photographic grade of `image` without changing size."""
    image = image.convert("RGB")
    # Natural avenue/space look: lift the milky illustration blacks, add gentle
    # photographic contrast, warm the cast slightly, then boost saturation just
    # enough for the scene to feel like a captured photograph.
    image = ImageOps.autocontrast(image, cutoff=1)
    image = ImageEnhance.Contrast(image).enhance(1.12)
    image = ImageEnhance.Color(image).enhance(1.08)
    image = ImageEnhance.Brightness(image).enhance(1.03)
    return image


def chapter_number(stem: str) -> int:
    digits = "".join(ch for ch in stem if ch.isdigit())
    return int(digits) if digits else 0


def parse_chapters(spec: str) -> list[int]:
    """Parse a chapter spec like '1-56', '1,3,5', or '7' into a sorted list."""
    chapters: set[int] = set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            chapters.update(range(int(a), int(b) + 1))
        else:
            chapters.add(int(part))
    return sorted(chapters)


def camera_transform(number: int) -> str:
    """Ren'Py ATL transform giving a smooth, living camera on a background.

    Slow ease-in-out zoom in/out plus a gentle panning look-around (ken-burns
    style). The base image sits slightly zoomed so there is room to drift without
    revealing empty edges. Each chapter breathes at its own pace and direction so
    backgrounds feel alive while the standing cast portraits stay still. Uses
    easeinout for natural acceleration/deceleration instead of robotic linear
    movement.
    """
    base_zoom = 1.015 + (number % 3) * 0.005          # 1.015 .. 1.025
    peak_zoom = 1.07 + (number % 3) * 0.02            # 1.07 .. 1.11
    duration = 16.0 + (number % 5) * 3                  # 16.0 .. 28.0 s per leg (slow)
    # Alternate drift direction per chapter so adjacent chapters feel different.
    if number % 2 == 0:
        ax, ay = 0.44, 0.40                           # drift toward upper-left
        bx, by = 0.56, 0.60                           # return toward lower-right
    else:
        ax, ay = 0.56, 0.60                           # drift toward lower-right
        bx, by = 0.44, 0.40                           # return toward upper-left
    def fmt(v: float) -> str:
        s = f"{v:.2f}".rstrip("0").rstrip(".")
        if "." not in s:
            s += ".0"
        return s
    lines = [
        f"transform stem_bg_ch{number:02d}_camera:",
        f"    zoom {fmt(base_zoom)}",
        "    xalign 0.5",
        "    yalign 0.5",
        f"    linear {fmt(duration)} zoom {fmt(peak_zoom)}",
        f"    linear {fmt(duration)} xalign {fmt(ax)}",
        f"    linear {fmt(duration)} yalign {fmt(ay)}",
        f"    linear {fmt(duration)} zoom {fmt(base_zoom)}",
        f"    linear {fmt(duration)} xalign {fmt(bx)}",
        f"    linear {fmt(duration)} yalign {fmt(by)}",
        "    repeat",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="integrations/renpy-technosutra",
                        help="runtime root containing game/images")
    parser.add_argument("--in-glob", default="game/images/optimized/bg_ch*.jpg",
                        help="glob of source backgrounds to realify")
    parser.add_argument("--out", default=None,
                        help="derivatives output dir (default: <root>/game/images/realified)")
    parser.add_argument("--quality", type=int, default=88,
                        help="JPEG quality for derivative outputs")
    parser.add_argument("--transforms-out", default=None,
                        help="Ren'Py ATL transforms file (default: <root>/game/bg_camera_transforms.rpy)")
    parser.add_argument("--chapters", default="1-56",
                        help="chapter range for camera transforms, e.g. '1-56' or '1,3,5'")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if Image is None:
        print("Pillow is not installed; leaving backgrounds untouched.", file=sys.stderr)
        return 0

    out_dir = Path(args.out).resolve() if args.out else (root / "game/images/realified")
    out_dir.mkdir(parents=True, exist_ok=True)

    transforms_out = Path(args.transforms_out).resolve() if args.transforms_out else (root / "game/bg_camera_transforms.rpy")
    transforms_out.parent.mkdir(parents=True, exist_ok=True)

    sources = sorted((root / args.in_glob).parent.glob((root / args.in_glob).name))
    if not sources:
        print(f"No backgrounds matched {args.in_glob} under {root}", file=sys.stderr)
        return 1

    assets = []
    for src in sources:
        if src.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        with Image.open(src) as im:
            graded = realify(im)
            dst = out_dir / src.name
            fmt = "JPEG" if dst.suffix.lower() in {".jpg", ".jpeg"} else "PNG"
            save_kwargs = {"quality": args.quality, "optimize": True} if fmt == "JPEG" else {}
            graded.save(dst, format=fmt, **save_kwargs)
            assets.append({
                "chapter": chapter_number(src.stem),
                "file": src.name,
                "source": str(src.name),
                "width": graded.width,
                "height": graded.height,
                "format": fmt,
                "sizeBytes": dst.stat().st_size,
            })

    # Living camera transforms: one `stem_bg_chNN_camera` per chapter in the
    # requested range. Decoupled from the input glob so chapter 1 (whose
    # background file is 02.webp, not bg_ch01.jpg) still gets stem_bg_ch01_camera.
    chapters = parse_chapters(args.chapters)
    transforms = [camera_transform(n) for n in chapters]

    manifest = {
        "schemaVersion": PROFILE_VERSION,
        "title": "The Stem Array — real-life background derivatives + living camera",
        "profile": profile_signature(args.quality, 1.12, 1.08, 1.03),
        "count": len(assets),
        "assets": assets,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    header = [
        "# The Stem Array — living camera transforms for real-life backgrounds.",
        "# Generated by scripts/vn-bg-realify.py. Each chapter background gets a slow",
        "# zoom in/out + panning look-around (ken-burns style) so the scene feels alive",
        "# while the standing cast portraits stay still. Apply with:",
        '#   scene bg_chNN at stem_bg_chNN_camera with dissolve',
        "",
    ]
    transforms_out.write_text("\n".join(header + transforms + [""]) + "\n", encoding="utf-8")
    print(f"Realified {len(assets)} backgrounds -> {out_dir}")
    print(f"Wrote {len(transforms)} living camera transforms -> {transforms_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
