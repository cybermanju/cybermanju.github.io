#!/usr/bin/env python3
"""Validate the 56 quality-controlled derivatives in full or compact checkouts."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
from PIL import Image, ImageChops

QUALITY = 85
SUBSAMPLING = 0
MIN_PSNR_DB = 30.0
TARGET_SIZE = (1920, 1080)


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    project = args.project.resolve()
    images = project / "game" / "images"
    optimized = images / "optimized"
    manifest_path = optimized / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"Missing optimized asset manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assets = manifest.get("assets", [])
    if manifest.get("schemaVersion") != 1 or manifest.get("count") != 56 or len(assets) != 56:
        raise SystemExit("Optimized asset manifest must list exactly 56 chapter backgrounds")
    encoder = manifest.get("encoder", {})
    if encoder.get("format") != "JPEG" or encoder.get("quality") != QUALITY or encoder.get("subsampling") != SUBSAMPLING:
        raise SystemExit("Expected JPEG q85 with 4:4:4 subsampling")
    if encoder.get("dimensions") != list(TARGET_SIZE) or encoder.get("pillow") != Image.__version__:
        raise SystemExit("Pillow version or optimized dimensions differ from the manifest/build environment")
    fidelity = manifest.get("fidelityGate", {})
    if fidelity.get("minDb") != MIN_PSNR_DB or fidelity.get("metric") != "PSNR vs. original PNG rendered at 1920x1080":
        raise SystemExit("Unexpected recorded PSNR fidelity gate")

    chapters_path = project / "chapters.json"
    if not chapters_path.is_file():
        raise SystemExit(f"Missing chapter source data: {chapters_path}")
    chapters = json.loads(chapters_path.read_text(encoding="utf-8")).get("chapters", [])
    expected_chapters = list(range(1, 57))
    if len(chapters) != 56 or [item.get("number") for item in chapters] != expected_chapters:
        raise SystemExit("chapters.json must contain chapters 1–56 in order")
    if [item.get("background") for item in chapters] != [f"bg_ch{n:02d}.jpg" for n in expected_chapters]:
        raise SystemExit("Chapter background mapping does not match all 56 optimized derivatives")

    source_paths = [images / f"bg_ch{chapter:02d}_cyberpunk.png" for chapter in expected_chapters]
    source_presence = [path.is_file() for path in source_paths]
    if any(source_presence) and not all(source_presence):
        raise SystemExit("Partial original PNG set found; provide all 56 or omit them all")
    has_sources = all(source_presence)
    baseline_paths = [images / f"bg_ch{chapter:02d}.jpg" for chapter in expected_chapters]
    baseline_presence = [path.is_file() for path in baseline_paths]
    if any(baseline_presence) and not all(baseline_presence):
        raise SystemExit("Partial prior JPEG set found; provide all 56 or omit them all")
    has_baseline = all(baseline_presence)

    source_bytes = 0
    baseline_bytes = 0
    optimized_bytes = 0
    measured_psnr: list[float] = []
    for chapter, record in enumerate(assets, start=1):
        source = source_paths[chapter - 1]
        target = optimized / f"bg_ch{chapter:02d}.jpg"
        if record.get("chapter") != chapter or record.get("file") != target.name or record.get("source") != source.name:
            raise SystemExit(f"Unexpected source/output mapping for chapter {chapter}")
        if record.get("format") != "JPEG" or record.get("width") != TARGET_SIZE[0] or record.get("height") != TARGET_SIZE[1]:
            raise SystemExit(f"Unexpected format/dimensions in manifest for chapter {chapter}")
        if not re.fullmatch(r"[0-9a-f]{64}", str(record.get("sourceSha256", ""))):
            raise SystemExit(f"Invalid preserved source PNG hash for chapter {chapter}")
        if not target.is_file():
            raise SystemExit(f"Missing optimized derivative for chapter {chapter}: {target}")
        if sha256(target) != record.get("sha256") or target.stat().st_size != record.get("sizeBytes"):
            raise SystemExit(f"Optimized output hash/size mismatch for chapter {chapter}")
        with Image.open(target) as optimized_image:
            if optimized_image.format != "JPEG" or optimized_image.size != TARGET_SIZE:
                raise SystemExit(f"Wrong optimized format/dimensions for chapter {chapter}: {optimized_image.format}, {optimized_image.size}")
            candidate = optimized_image.convert("RGB")
        optimized_bytes += target.stat().st_size
        recorded_psnr = float(record.get("psnrDb", -1))
        if recorded_psnr < MIN_PSNR_DB:
            raise SystemExit(f"Recorded PSNR below {MIN_PSNR_DB:.1f} dB for chapter {chapter}: {recorded_psnr:.2f} dB")

        if has_sources:
            if sha256(source) != record.get("sourceSha256") or source.stat().st_size != record.get("sourceBytes"):
                raise SystemExit(f"Original PNG hash/size changed for chapter {chapter}")
            with Image.open(source) as source_image:
                if source_image.format != "PNG":
                    raise SystemExit(f"Expected original PNG for chapter {chapter}")
                reference = source_image.convert("RGB")
                if reference.size != TARGET_SIZE:
                    reference = reference.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
            measured = psnr(reference, candidate)
            if measured < MIN_PSNR_DB or abs(measured - recorded_psnr) > 0.02:
                raise SystemExit(f"Measured PSNR mismatch/gate failure for chapter {chapter}: {measured:.2f} dB")
            measured_psnr.append(measured)
            source_bytes += source.stat().st_size
        if has_baseline:
            baseline_bytes += baseline_paths[chapter - 1].stat().st_size

    if optimized_bytes != manifest.get("optimizedBytes"):
        raise SystemExit("Optimized output total differs from manifest")
    if has_sources and source_bytes != manifest.get("sourcePngBytes"):
        raise SystemExit("Original PNG total differs from manifest")
    if has_baseline and baseline_bytes != manifest.get("baselineExistingJpegBytes"):
        raise SystemExit("Prior JPEG baseline size differs from the generation manifest")

    print("PASS: 56/56 optimized JPEG files, chapter mapping, 1920x1080 dimensions, output SHA-256 and sizes")
    print(f"PASS: q{QUALITY}, 4:4:4, recorded PSNR floor {MIN_PSNR_DB:.1f} dB")
    if has_sources:
        print(f"PASS: original PNG hashes and measured PSNR; min/mean {min(measured_psnr):.2f}/{sum(measured_psnr) / len(measured_psnr):.2f} dB")
    else:
        print("PASS: PNG sources omitted from compact checkout; source hashes and generation-time PSNR remain in the manifest")
    if has_baseline:
        print(f"Sizes: existing JPEG baseline {baseline_bytes:,} bytes → optimized {optimized_bytes:,} bytes")
    else:
        print(f"Compact optimized backgrounds: {optimized_bytes:,} bytes; no ignored baseline files were required")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
