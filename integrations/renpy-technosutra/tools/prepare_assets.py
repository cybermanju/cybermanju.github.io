#!/usr/bin/env python3
"""Generate or verify compact JPEG derivatives for the 56 chapter scenes.

When all original chapter PNGs are present locally, the script regenerates q85,
4:4:4 JPEGs under game/images/optimized/ and measures PSNR against those PNGs.
A clean CI checkout contains the optimized derivatives and their manifest only;
it validates them without relying on ignored source files or rewriting outputs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

import PIL
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "game" / "images"
OUTPUT = IMAGES / "optimized"
WIDTH, HEIGHT = 1920, 1080
QUALITY = 85
SUBSAMPLING = 0
PSNR_MIN_DB = 30.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def psnr(reference: Image.Image, candidate: Image.Image) -> float:
    histogram = ImageChops.difference(reference, candidate).histogram()
    squared_error = sum(count * (index % 256) ** 2 for index, count in enumerate(histogram))
    samples = reference.width * reference.height * len(reference.getbands())
    mse = squared_error / samples
    return float("inf") if mse == 0 else 10 * math.log10((255 * 255) / mse)


def verify() -> int:
    validator = ROOT / "tools" / "validate_optimized_assets.py"
    if not validator.is_file():
        raise SystemExit(f"Missing optimized-asset validator: {validator}")
    return subprocess.run([sys.executable, str(validator), "--project", str(ROOT)], check=False).returncode


def generate() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    baseline_paths = [IMAGES / f"bg_ch{chapter:02d}.jpg" for chapter in range(1, 57)]
    baseline_presence = [path.is_file() for path in baseline_paths]
    if any(baseline_presence) and not all(baseline_presence):
        raise SystemExit("Partial prior JPEG baseline found; provide all 56 or omit them all")
    if all(baseline_presence):
        baseline_bytes = sum(path.stat().st_size for path in baseline_paths)
    else:
        old_manifest = OUTPUT / "manifest.json"
        baseline_bytes = json.loads(old_manifest.read_text(encoding="utf-8")).get("baselineExistingJpegBytes", 0) if old_manifest.is_file() else 0

    records = []
    for chapter in range(1, 57):
        source = IMAGES / f"bg_ch{chapter:02d}_cyberpunk.png"
        target = OUTPUT / f"bg_ch{chapter:02d}.jpg"
        if not source.is_file():
            raise SystemExit(f"Missing original chapter artwork: {source}")
        with Image.open(source) as opened:
            source_width, source_height = opened.size
            if abs(source_width / source_height - 16 / 9) > 0.01:
                raise SystemExit(f"Unexpected aspect ratio for {source}: {source_width}x{source_height}")
            reference = opened.convert("RGB")
            if reference.size != (WIDTH, HEIGHT):
                reference = reference.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)

        temporary = target.with_name(target.name + ".tmp")
        reference.save(
            temporary,
            format="JPEG",
            quality=QUALITY,
            subsampling=SUBSAMPLING,
            optimize=True,
            progressive=True,
        )
        os.replace(temporary, target)
        with Image.open(target) as saved:
            candidate = saved.convert("RGB")
            if saved.format != "JPEG" or candidate.size != (WIDTH, HEIGHT):
                raise SystemExit(f"Wrong optimized format/dimensions for {target}: {saved.format}, {candidate.size}")
            fidelity_psnr = psnr(reference, candidate)
        if fidelity_psnr < PSNR_MIN_DB:
            raise SystemExit(f"Fidelity gate failed for chapter {chapter}: {fidelity_psnr:.2f} dB < {PSNR_MIN_DB:.1f} dB")
        records.append({
            "chapter": chapter,
            "file": target.name,
            "source": source.name,
            "sourceWidth": source_width,
            "sourceHeight": source_height,
            "width": WIDTH,
            "height": HEIGHT,
            "format": "JPEG",
            "sourceBytes": source.stat().st_size,
            "sourceSha256": sha256(source),
            "sizeBytes": target.stat().st_size,
            "sha256": sha256(target),
            "psnrDb": round(fidelity_psnr, 4),
        })

    manifest = {
        "schemaVersion": 1,
        "title": "The Stem Array — optimized chapter-background derivatives",
        "count": len(records),
        "encoder": {
            "pillow": PIL.__version__,
            "format": "JPEG",
            "quality": QUALITY,
            "subsampling": SUBSAMPLING,
            "optimize": True,
            "progressive": True,
            "dimensions": [WIDTH, HEIGHT],
        },
        "fidelityGate": {"metric": "PSNR vs. original PNG rendered at 1920x1080", "minDb": PSNR_MIN_DB},
        "baselineExistingJpegBytes": baseline_bytes,
        "sourcePngBytes": sum(record["sourceBytes"] for record in records),
        "optimizedBytes": sum(record["sizeBytes"] for record in records),
        "assets": records,
    }
    manifest_path = OUTPUT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Created {len(records)} optimized chapter JPEGs: {OUTPUT}")
    if baseline_bytes:
        print(f"Existing 56-JPEG baseline: {baseline_bytes:,} bytes")
    print(f"Original 56-PNG sources: {manifest['sourcePngBytes']:,} bytes (unchanged)")
    print(f"Optimized derivatives: {manifest['optimizedBytes']:,} bytes")
    if baseline_bytes:
        print(f"Reduction vs existing JPEGs: {(1 - manifest['optimizedBytes'] / baseline_bytes) * 100:.2f}%")
    print(f"PSNR range: {min(r['psnrDb'] for r in records):.2f}–{max(r['psnrDb'] for r in records):.2f} dB")
    print(f"Manifest: {manifest_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--verify", action="store_true", help="verify existing compact derivatives without writing files")
    mode.add_argument("--generate", action="store_true", help="regenerate derivatives from all 56 original chapter PNGs")
    args = parser.parse_args()
    sources = [IMAGES / f"bg_ch{chapter:02d}_cyberpunk.png" for chapter in range(1, 57)]
    available = [source.is_file() for source in sources]
    if args.verify:
        return verify()
    if args.generate:
        if not all(available):
            raise SystemExit("Cannot regenerate derivatives: all 56 original chapter PNGs are required")
        return generate()
    if all(available):
        return generate()
    if any(available):
        raise SystemExit("Partial original PNG set found; provide a complete set or omit all for compact validation")
    print("Original PNGs omitted from compact checkout; validating pre-generated derivatives only.")
    return verify()


if __name__ == "__main__":
    raise SystemExit(main())
