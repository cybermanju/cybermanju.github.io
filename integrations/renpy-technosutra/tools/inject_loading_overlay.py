#!/usr/bin/env python3
"""Inject the custom loading overlay into Ren'Py's generated Web index.html.

Ren'Py's web_build regenerates index.html from the SDK template, so the overlay
lives outside the engine and is spliced in after the build. Head assets and the
body block each carry their own markers, so re-running replaces the previous
injection byte-for-byte instead of stacking overlays. The transform fails loudly
if the generated document no longer has the anchors it depends on.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BODY_MARKER = "<!-- stem-loader:v1 -->"
HEAD_START = "<!-- stem-loader:head:v1 -->"
HEAD_END = "<!-- /stem-loader:head:v1 -->"
SCRIPT_TAG = '<script src="loading/loading.js" defer></script>'


def head_block(art: str) -> str:
    return (
        f"{HEAD_START}\n"
        # Mobile-first viewport: lock to device width, no user zoom so the
        # Ren'Py canvas (1920×1080 design grid) scales predictably on rotate.
        # viewport-fit=cover lets content edge-to-edge on notched phones.
        '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'
        '<link rel="stylesheet" href="loading/loading.css">\n'
        f'<link rel="preload" as="image" href="{art}" fetchpriority="high">\n'
        f"{HEAD_END}\n"
    )


def body_block(art: str, art_small: str | None) -> str:
    blur = ""
    if art_small:
        # The blur-up paints on the first decoded bytes; the sharp WebP fades in
        # over it, so the zoom never starts from an empty black stage.
        blur = (
            f'  <img class="stem-loader__art" src="{art_small}" alt="" aria-hidden="true"'
            ' data-stem-blur-up="1" style="filter: blur(18px) saturate(1.1);">\n'
        )
    return (
        f"\n{BODY_MARKER}\n"
        '<div id="stem-loader" role="status" aria-live="polite" aria-busy="true">\n'
        f'  <img class="stem-loader__art" src="{art}" alt="" aria-hidden="true" decoding="async" fetchpriority="high">\n'
        f"{blur}"
        '  <div class="stem-loader__shade" aria-hidden="true"></div>\n'
        '  <section class="stem-loader__card">\n'
        '    <h1 class="stem-loader__title">Loading…</h1>\n'
        '    <p class="stem-loader__phrase" data-stem-phrase>Os Bodhisattvas estão se reunindo…</p>\n'
        '    <div class="stem-loader__bar" role="progressbar" aria-label="Carregamento">\n'
        '      <span class="stem-loader__fill"></span>\n'
        "    </div>\n"
        '    <p class="stem-loader__detail" data-stem-detail></p>\n'
        '    <p class="stem-loader__hint">Primeiro acesso baixa o motor (~42 MB). Depois ele abre do cache.</p>\n'
        "  </section>\n"
        "</div>\n"
        f"{SCRIPT_TAG}\n"
    )


def strip_overlay(html: str) -> str:
    """Return index.html with any previously injected overlay removed."""
    head_start = html.find(HEAD_START)
    if head_start >= 0:
        head_end = html.find(HEAD_END, head_start)
        if head_end < 0:
            raise SystemExit("injected head block has no end marker; rebuild index.html")
        cut = head_end + len(HEAD_END)
        if html[cut:cut + 1] == "\n":
            cut += 1
        html = html[:head_start] + html[cut:]
    marker_at = html.find(BODY_MARKER)
    if marker_at >= 0:
        script_at = html.find(SCRIPT_TAG, marker_at)
        if script_at < 0:
            raise SystemExit("injected overlay is present but its script tag is missing; rebuild index.html")
        start = marker_at - 1 if marker_at > 0 and html[marker_at - 1] == "\n" else marker_at
        end = script_at + len(SCRIPT_TAG)
        if html[end:end + 1] == "\n":
            end += 1
        html = html[:start] + html[end:]
    return html


def resolve_art(web_dir: Path) -> tuple[str, str | None]:
    manifest = web_dir / "loading" / "art.json"
    art, art_small = "web-presplash.jpg", None
    if manifest.is_file():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        candidate = str(data.get("art") or "").strip()
        if candidate and (web_dir / "loading" / candidate).is_file():
            art = f"loading/{candidate}"
        elif candidate:
            print(f"loading art {candidate} is missing; falling back to {art}", file=sys.stderr)
        small = data.get("artSmall")
        if small and (web_dir / "loading" / str(small)).is_file():
            art_small = f"loading/{small}"
    if not (web_dir / art).is_file():
        raise SystemExit(f"loading art is not deliverable: {web_dir / art}")
    return art, art_small


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("web_directory", type=Path)
    args = parser.parse_args()
    web_dir = args.web_directory.resolve()
    index = web_dir / "index.html"
    if not index.is_file():
        raise SystemExit(f"missing {index}")
    html = strip_overlay(index.read_text(encoding="utf-8"))

    for anchor in ("</head>", "<body", "</body>"):
        if anchor not in html:
            raise SystemExit(f"generated index.html has no {anchor!r} anchor; the Ren'Py template changed")

    art, art_small = resolve_art(web_dir)
    html = html.replace("</head>", f"{head_block(art)}</head>", 1)
    body_start = html.index("<body")
    body_open_end = html.index(">", body_start) + 1
    html = html[:body_open_end] + body_block(art, art_small) + html[body_open_end:]

    index.write_text(html, encoding="utf-8")
    print(f"Injected loading overlay into {index} (art: {art})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
