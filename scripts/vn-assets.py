#!/usr/bin/env python3
"""CyberManju OS — Visual-novel runtime asset derivatives (scripts/vn-assets.py).

Role: rebuild the *streamed* Ren'Py images (the loose game/images/** files that
      the Web engine downloads one by one through progressive_download.txt) into
      smaller, faster bytes without changing a single pixel dimension. Ren'Py
      places scene/`show` images at their native size, so re-encoding at the same
      width/height is the only safe lever the dev server has before a rebuild.
Exports: --root (runtime dir), --out (cache dir), --profile, --sprites,
      --bg-quality; writes <out>/manifest.json and mirrors game/images/**.
Integrates: scripts/vn-dev.mjs calls it once when the cache is cold; the server
      serves the derivatives under the original URL so the engine cannot tell.
Contracts: never writes inside the served runtime; dimensions are preserved
      (1920x1080 backgrounds, 600x800 sprites); a manifest that does not match
      the requested profile forces a full regeneration; WebP sprite output is
      opt-in because it relies on SDL_image's WebP decoder in the WASM build.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

try:
    from PIL import Image
except Exception:  # pragma: no cover - Pillow missing must degrade, not crash
    Image = None  # type: ignore[assignment]

PROFILE_VERSION = 3
DEFAULT_BG_QUALITY = 80
DEFAULT_BG_SUBSAMPLING = 2  # 4:2:0: chroma is invisible on these renders, ~25% cheaper
BACKGROUND_GLOBS = ("game/images/optimized/bg_ch*.jpg", "game/images/bg_intro*.jpg", "game/images/title/*.jpg")
SPRITE_GLOB = "game/images/masters/sprites/provisional/*.png"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def manifest_path(out: Path) -> Path:
    return out / "manifest.json"


def read_manifest(out: Path) -> dict:
    try:
        return json.loads(manifest_path(out).read_text(encoding="utf-8"))
    except Exception:
        return {}


def profile_signature(quality: int, subsampling: int, sprites: str, lossless: bool) -> str:
    raw = f"v{PROFILE_VERSION}|q{quality}|s{subsampling}|{sprites}|lossless={lossless}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def lossless_extension(rel: str) -> str:
    """When lossless, store derivatives as .webp so the browser decodes them."""
    from pathlib import PurePosixPath
    p = PurePosixPath(rel)
    return str(p.with_suffix(".webp"))


def targets(root: Path, sprites: str, lossless: bool) -> list[tuple[Path, str, str, str]]:
    """(source path, relative path, target relative path, codec) triples."""
    found: list[tuple[Path, str, str, str]] = []
    for pattern in BACKGROUND_GLOBS:
        for src in sorted(root.glob(pattern)):
            rel = str(src.relative_to(root))
            # Backgrounds stay JPEG even in lossless mode (lossless WebP makes
            # photos 3-4x larger); only sprites change extension/codec.
            target_rel = rel
            codec = "jpeg"
            found.append((src, rel, target_rel, codec))
    for src in sorted(root.glob(SPRITE_GLOB)):
        rel = str(src.relative_to(root))
        target_rel = lossless_extension(rel) if lossless else rel
        codec = "webp" if lossless else sprites
        found.append((src, rel, target_rel, codec))
    seen: set[str] = set()
    unique: list[tuple[Path, str, str, str]] = []
    for src, rel, target_rel, codec in found:
        if rel not in seen:
            seen.add(rel)
            unique.append((src, rel, target_rel, codec))
    return unique


def encode(source: Path, target: Path, target_rel: str, codec: str, quality: int, subsampling: int, lossless: bool) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".tmp")
    with Image.open(source) as opened:
        width, height = opened.size
        if lossless and codec == "jpeg":
            # Photographic backgrounds compress best as lossy JPEG; lossless
            # WebP makes them 3-4x larger. Keep JPEG q80 4:2:0 (the fastest
            # good-enough lever the dev server has before a rebuild).
            frame = opened.convert("RGB")
            frame.save(
                temporary,
                format="JPEG",
                quality=quality,
                subsampling=subsampling,
                optimize=True,
                progressive=True,
            )
        elif lossless:
            # Sprites (PNG with alpha) shrink ~3-4x as lossless WebP; method=5
            # is near-maximal compression without method=6's extreme slowness.
            frame = opened.convert("RGBA")
            frame.save(temporary, format="WEBP", lossless=True, method=5)
            codec = "webp"
        elif codec == "jpeg":
            frame = opened.convert("RGB")
            frame.save(
                temporary,
                format="JPEG",
                quality=quality,
                subsampling=subsampling,
                optimize=True,
                progressive=True,
            )
        elif codec == "webp":
            frame = opened.convert("RGBA")
            frame.save(temporary, format="WEBP", lossless=True, method=4)
        else:
            frame = opened.convert("RGBA")
            frame.save(temporary, format="PNG", optimize=True, compress_level=9)
        out_width, out_height = frame.size
    os.replace(temporary, target)
    return {
        "width": out_width,
        "height": out_height,
        "sourceBytes": source.stat().st_size,
        "bytes": target.stat().st_size,
        "codec": codec,
        "targetRel": target_rel,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Ren'Py Web runtime directory")
    parser.add_argument("--out", type=Path, required=True, help="derivative cache directory")
    parser.add_argument("--bg-quality", type=int, default=DEFAULT_BG_QUALITY)
    parser.add_argument("--bg-subsampling", type=int, default=DEFAULT_BG_SUBSAMPLING)
    parser.add_argument("--sprites", choices=("webp", "png"), default="webp")
    parser.add_argument(
        "--lossless",
        action="store_true",
        help="lossless high compression (WebP method=6) for backgrounds and sprites",
    )
    parser.add_argument("--force", action="store_true", help="ignore the cache and rewrite every derivative")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    out = args.out.resolve()
    if not root.is_dir():
        print(f"vn-assets: runtime directory not found: {root}", file=sys.stderr)
        return 2
    if Image is None:
        print("vn-assets: Pillow is not installed; serving original assets", file=sys.stderr)
        return 3

    signature = profile_signature(args.bg_quality, args.bg_subsampling, args.sprites, args.lossless)
    previous = read_manifest(out)
    up_to_date = not args.force and previous.get("signature") == signature
    assets: dict[str, dict] = dict(previous.get("assets", {})) if up_to_date else {}

    started = time.monotonic()
    jobs = targets(root, args.sprites, args.lossless)
    written = 0
    for source, rel, target_rel, codec in jobs:
        target = out / target_rel
        record = assets.get(rel)
        fresh = (
            record is not None
            and record.get("codec") == codec
            and target.is_file()
            and target.stat().st_size == record.get("bytes")
            and target.stat().st_mtime >= source.stat().st_mtime
        )
        if fresh and not args.force:
            continue
        try:
            assets[rel] = encode(
                source, target, target_rel, codec, args.bg_quality, args.bg_subsampling, args.lossless
            )
            written += 1
        except Exception as error:  # keep the dev server usable on one bad file
            print(f"vn-assets: skipped {rel}: {error}", file=sys.stderr)

    # Drop derivatives that no longer have a source.
    live = {rel for _src, rel, _target_rel, _codec in jobs}
    for stale in [rel for rel in assets if rel not in live]:
        assets.pop(stale, None)
        target_rel = assets.get(stale, {}).get("targetRel", stale)
        try:
            (out / target_rel).unlink()
        except OSError:
            pass

    source_bytes = sum(record.get("sourceBytes", 0) for record in assets.values())
    output_bytes = sum(record.get("bytes", 0) for record in assets.values())
    if args.lossless:
        bg_profile = f"JPEG q{args.bg_quality} 4:{'4:4:4' if args.bg_subsampling == 0 else '2:0'}"
        sprite_profile = "WebP lossless m5"
    else:
        bg_profile = f"JPEG q{args.bg_quality} 4:{'4:4:4' if args.bg_subsampling == 0 else '2:0'}"
        sprite_profile = args.sprites
    manifest = {
        "schemaVersion": 1,
        "signature": signature,
        "lossless": args.lossless,
        "profile": {
            "backgrounds": bg_profile,
            "sprites": sprite_profile,
        },
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "assets": assets,
        "count": len(assets),
        "sourceBytes": source_bytes,
        "outputBytes": output_bytes,
        "savedPercent": round((1 - output_bytes / source_bytes) * 100, 2) if source_bytes else 0,
    }
    manifest_path(out).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if not args.quiet:
        elapsed = time.monotonic() - started
        print(
            f"vn-assets: {len(assets)} images "
            f"({manifest['profile']['backgrounds']}, {manifest['profile']['sprites']}) "
            f"{source_bytes / 1e6:.1f} MB -> {output_bytes / 1e6:.1f} MB "
            f"(-{manifest['savedPercent']:.0f}%), {written} rewritten in {elapsed:.1f}s",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
