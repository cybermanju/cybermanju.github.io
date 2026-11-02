#!/usr/bin/env python3
"""Capture the actual Ren'Py Web HUD at desktop and mobile-landscape sizes."""
from __future__ import annotations

import argparse
import functools
import json
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright
from smoke_web_build import Handler, find_chromium

ROOT = Path(__file__).resolve().parents[1]


def enter(page, delay: int = 220) -> None:
    page.keyboard.press("Enter")
    page.wait_for_timeout(delay)


def finish_and_advance_text(page) -> None:
    """Reveal the current slow line, then advance once to the next beat."""
    enter(page, 120)
    enter(page, 260)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("web_directory", type=Path, help="Validated Ren'Py Web output directory")
    parser.add_argument("output_directory", type=Path, help="Persistent directory for PNG captures")
    args = parser.parse_args()
    web_directory = args.web_directory.resolve()
    output_directory = args.output_directory.resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    if not (web_directory / "index.html").is_file():
        raise SystemExit(f"Missing Web candidate: {web_directory}")

    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(web_directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"
    records: list[dict[str, object]] = []
    page_errors: list[str] = []
    console_errors: list[str] = []

    def save(page, filename: str, width: int, height: int, note: str) -> None:
        path = output_directory / filename
        page.screenshot(path=str(path), full_page=False, animations="disabled", timeout=60_000)
        records.append({"file": str(path), "viewport": [width, height], "note": note})
        print(f"Captured {path} at {width}x{height}")

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=find_chromium(),
                args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"],
            )
            page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            response = page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            if response is None or response.status != 200:
                raise SystemExit("Could not load the built Ren'Py Web candidate")
            page.wait_for_function("() => { const c = document.querySelector('canvas'); return c && c.width >= 640 && c.height >= 360; }", timeout=120_000)
            page.wait_for_timeout(4000)

            # Start menu -> chapter index -> chapter group 31–40 -> chapter 40.
            enter(page)
            for _ in range(3):
                finish_and_advance_text(page)
            page.wait_for_timeout(500)
            for _ in range(2):
                page.keyboard.press("ArrowDown")
                page.wait_for_timeout(100)
            enter(page, 450)
            for _ in range(3):
                page.keyboard.press("ArrowDown")
                page.wait_for_timeout(100)
            enter(page, 450)
            for _ in range(9):
                page.keyboard.press("ArrowDown")
                page.wait_for_timeout(80)
            enter(page, 900)

            # Dismiss the chapter and first-scene title cards.
            enter(page, 500)
            enter(page, 500)

            # Chapter 40, scene 1 has two narration pages and two dialogue lines.
            for _ in range(4):
                finish_and_advance_text(page)
            enter(page, 450)  # scene 2 title

            # Scene 2 has three narration pages and two dialogue lines.
            for _ in range(5):
                finish_and_advance_text(page)
            enter(page, 450)  # scene 3 title

            # The first scene-3 narration page ends with the continuation ellipsis.
            page.set_viewport_size({"width": 854, "height": 393})
            page.wait_for_timeout(8_500)
            save(page, "mobile-landscape-narration-continuation-854x393.png", 854, 393, "Chapter 40, scene 3 narration page 1; compact mobile landscape with continuation ellipsis.")
            page.set_viewport_size({"width": 1920, "height": 1080})
            page.wait_for_timeout(600)

            # Three narration pages and the first dialogue lead to the 44-character king label.
            for _ in range(3):
                finish_and_advance_text(page)
            finish_and_advance_text(page)
            page.wait_for_timeout(4_500)
            save(page, "desktop-speaker-nameplate-1920x1080.png", 1920, 1080, "Chapter 40, scene 3: longest authored speaker label shown in the final velvet/pixel HUD.")
            page.set_viewport_size({"width": 854, "height": 393})
            page.wait_for_timeout(2_000)
            save(page, "mobile-landscape-speaker-nameplate-854x393.png", 854, 393, "Same 44-character speaker label at 854x393 mobile landscape.")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if page_errors or console_errors:
        raise SystemExit(f"Browser errors during capture: page={page_errors}, console={console_errors}")
    report = {
        "status": "PASS",
        "candidate": str(web_directory),
        "targetChapter": 40,
        "targetScene": 3,
        "targetSpeaker": "Rei Sarvadharmanirnādacchatramaṇḍalanirghoṣa",
        "pageErrors": page_errors,
        "consoleErrors": console_errors,
        "captures": records,
    }
    report_path = output_directory / "capture-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Capture report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
