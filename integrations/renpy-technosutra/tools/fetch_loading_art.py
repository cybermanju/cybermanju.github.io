#!/usr/bin/env python3
"""Fetch the upstream 02.png loading art, convert it to WebP, and record provenance.

The loading screen zooms on a single illustration, so it must be both small and
sharp: a full-size WebP for the zoom, a tiny blur-up WebP painted immediately, and
a Ren'Py-decodable JPEG for the in-engine title background that continues the same
image after the DOM overlay fades out.

Network is only needed to *refresh* the art. Every derivative and its provenance
are committed, so CI and offline checkouts never touch GitHub.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys
import time
import urllib.request

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOADING = ROOT / "web" / "loading"
COMMIT = "b0f08869b385faf9934548f8bc978573dc3fc7b3"
UPSTREAM_PATH = "imgs/imagens/02.png"
SOURCES = (
    f"https://raw.githubusercontent.com/technosutra21/technosutra/{COMMIT}/{UPSTREAM_PATH}",
    f"https://api.github.com/repos/technosutra21/technosutra/contents/{UPSTREAM_PATH}?ref={COMMIT}",
)
FULL_WIDTH = 1920
BLUR_WIDTH = 320
WEBP_QUALITY = 84
BLUR_QUALITY = 42
RENPY_JPEG_QUALITY = 88


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download() -> bytes:
    last_error = "no attempt made"
    for attempt in range(3):
        for source in SOURCES:
            try:
                request = urllib.request.Request(
                    source,
                    headers={"User-Agent": "cybermanju-vn-build", "Accept": "application/vnd.github+json"},
                )
                with urllib.request.urlopen(request, timeout=60) as response:
                    payload = response.read()
                if source.endswith("?ref=" + COMMIT) or "api.github.com" in source:
                    payload = base64.b64decode(json.loads(payload)["content"])
                if payload[:8] != b"\x89PNG\r\n\x1a\n":
                    raise ValueError("upstream did not return a PNG")
                return payload
            except Exception as error:  # network is flaky in some sandboxes
                last_error = f"{type(error).__name__}: {error}"
        time.sleep(2)
    raise SystemExit(f"could not fetch {UPSTREAM_PATH} at {COMMIT[:12]} ({last_error})")


def convert(payload: bytes) -> dict:
    LOADING.mkdir(parents=True, exist_ok=True)
    source_png = LOADING / "02-source.png"
    source_png.write_bytes(payload)
    with Image.open(source_png) as opened:
        opened.load()
        width, height = opened.size
        rgb = opened.convert("RGB")

    scale = min(1.0, FULL_WIDTH / width)
    full_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    full = rgb.resize(full_size, Image.Resampling.LANCZOS)
    full_path = LOADING / "02.webp"
    full.save(full_path, format="WEBP", quality=WEBP_QUALITY, method=6)

    blur_size = (BLUR_WIDTH, max(1, round(height * (BLUR_WIDTH / width))))
    blur = rgb.resize(blur_size, Image.Resampling.BICUBIC)
    blur_path = LOADING / "02-small.webp"
    blur.save(blur_path, format="WEBP", quality=BLUR_QUALITY, method=6)

    title_path = LOADING / "02.jpg"
    full.save(title_path, format="JPEG", quality=RENPY_JPEG_QUALITY, subsampling=0, optimize=True, progressive=True)

    manifest = {
        "schemaVersion": 1,
        "title": "The Stem Array — loading screen art (web/loading)",
        "source": {
            "repository": "technosutra21/technosutra",
            "commit": COMMIT,
            "path": UPSTREAM_PATH,
            "url": SOURCES[0],
            "pngSha256": sha256(payload),
            "pngBytes": len(payload),
            "width": width,
            "height": height,
        },
        "art": {
            "file": full_path.name,
            "format": "WEBP",
            "width": full_size[0],
            "height": full_size[1],
            "quality": WEBP_QUALITY,
            "bytes": full_path.stat().st_size,
            "sha256": sha256(full_path.read_bytes()),
        },
        "artSmall": {
            "file": blur_path.name,
            "format": "WEBP",
            "width": blur_size[0],
            "height": blur_size[1],
            "quality": BLUR_QUALITY,
            "bytes": blur_path.stat().st_size,
            "sha256": sha256(blur_path.read_bytes()),
            "role": "instant blur-up placeholder behind the full image",
        },
        "titleBackground": {
            "file": title_path.name,
            "format": "JPEG",
            "width": full_size[0],
            "height": full_size[1],
            "quality": RENPY_JPEG_QUALITY,
            "subsampling": 0,
            "bytes": title_path.stat().st_size,
            "sha256": sha256(title_path.read_bytes()),
            "role": "in-engine main-menu background so the DOM overlay hands off to the same image",
        },
    }
    (LOADING / "provenance.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    art = {
        "schemaVersion": 1,
        "title": "The Stem Array — loading screen art",
        "art": full_path.name,
        "artSmall": blur_path.name,
        "titleBackground": title_path.name,
        "note": "Generated by tools/fetch_loading_art.py from technosutra21/technosutra imgs/imagens/02.png; see provenance.json for commit, SHA-256 and sizes.",
    }
    (LOADING / "art.json").write_text(json.dumps(art, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    source_png.unlink()
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="use an already-downloaded 02.png instead of the network")
    args = parser.parse_args()
    if args.source:
        payload = args.source.read_bytes()
        if payload[:8] != b"\x89PNG\r\n\x1a\n":
            raise SystemExit(f"{args.source} is not a PNG")
    else:
        payload = download()
    manifest = convert(payload)
    art = manifest["art"]
    print(f"02.png {manifest['source']['width']}x{manifest['source']['height']} "
          f"({manifest['source']['pngBytes']:,} B) -> {art['file']} {art['width']}x{art['height']} "
          f"({art['bytes']:,} B, {100 * (1 - art['bytes'] / manifest['source']['pngBytes']):.1f}% smaller)")
    print(f"blur-up {manifest['artSmall']['bytes']:,} B, title jpg {manifest['titleBackground']['bytes']:,} B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
