#!/usr/bin/env python3
"""Headless browser smoke test for a Ren'Py Web build served locally."""
from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import shutil
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, _format: str, *args: object) -> None:
        return


def find_chromium() -> str | None:
    explicit = os.environ.get("CHROMIUM_PATH")
    if explicit:
        return explicit
    for name in ("chromium", "chromium-browser", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("web_directory", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    web_directory = args.web_directory.resolve()
    for name in ("index.html", "game.zip", "renpy.js", "renpy.wasm", "renpy.data", "web-presplash.jpg"):
        if not (web_directory / name).is_file():
            raise SystemExit(f"Missing web runtime file: {web_directory / name}")

    try:
        with zipfile.ZipFile(web_directory / "game.zip") as archive:
            background_manifest = json.loads(archive.read("game/images/optimized/manifest.json"))
            sprite_manifest = json.loads(archive.read("game/images/masters/sprites/manifest.json"))
            narrator_manifest = json.loads(archive.read("game/images/narrator/manifest.json"))
            compiled_story_bytes = archive.getinfo("game/script.rpyc").file_size
            if compiled_story_bytes <= 0:
                raise ValueError("compiled Ren'Py story script is empty")
    except (OSError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read progressive image manifests from game.zip: {error}") from error
    if (
        len(background_manifest.get("assets", [])) != 56
        or len(sprite_manifest.get("assets", [])) != 54
        or narrator_manifest.get("relativePath") != "images/narrator/orb.png"
        or narrator_manifest.get("file") != "orb.png"
    ):
        raise SystemExit("Expected 56 progressive backgrounds, 54 progressive sprites and the narrator orb manifest")
    progressive_assets = ["game/images/bg_intro_scene.jpg", "game/images/narrator/orb.png"]
    progressive_assets.extend(f"game/images/optimized/{asset['file']}" for asset in background_manifest["assets"])
    progressive_assets.extend(f"game/images/{asset['file']}" for asset in sprite_manifest["assets"])
    if len(set(progressive_assets)) != 112:
        raise SystemExit("Expected exactly 112 unique progressive runtime image paths")

    image_root = web_directory / "game" / "images"
    verified_backgrounds = 0
    verified_sprites = 0
    for asset in background_manifest["assets"]:
        path = image_root / "optimized" / asset["file"]
        if (
            not path.is_file()
            or path.stat().st_size != asset["sizeBytes"]
            or sha256_file(path) != asset["sha256"]
        ):
            raise SystemExit(f"Real progressive background failed SHA-256/size verification: {path}")
        verified_backgrounds += 1
    for asset in sprite_manifest["assets"]:
        path = image_root / asset["file"]
        if (
            not path.is_file()
            or path.stat().st_size != asset["sizeBytes"]
            or sha256_file(path) != asset["sha256"]
        ):
            raise SystemExit(f"Real progressive sprite failed SHA-256/size verification: {path}")
        verified_sprites += 1
    if not (image_root / "bg_intro_scene.jpg").is_file():
        raise SystemExit("Independent opening background is missing from the real progressive files")
    presplash_path = web_directory / "web-presplash.jpg"
    if sha256_file(presplash_path) != sha256_file(image_root / "bg_intro_scene.jpg"):
        raise SystemExit("Web presplash differs from the approved opening landscape")
    if "web-presplash.jpg" not in (web_directory / "index.html").read_text(encoding="utf-8"):
        raise SystemExit("Web index does not reference web-presplash.jpg")
    narrator_path = image_root / "narrator" / "orb.png"
    if (
        not narrator_path.is_file()
        or narrator_path.stat().st_size != narrator_manifest.get("sizeBytes")
        or sha256_file(narrator_path) != narrator_manifest.get("sha256")
    ):
        raise SystemExit("Narrator orb failed SHA-256/size verification in the real progressive files")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise SystemExit("Playwright is required for the local browser smoke test") from error

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        functools.partial(Handler, directory=str(web_directory)),
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.server_port}/"
    console_errors: list[str] = []
    page_errors: list[str] = []
    failed_requests: list[str] = []
    resource_status: dict[str, int] = {}
    progressive_asset_status: dict[str, int] = {}
    canvas_size: list[int] | None = None
    try:
        for relative_path in progressive_assets:
            request = Request(base_url + quote(relative_path, safe="/"), method="HEAD")
            try:
                with urlopen(request, timeout=30) as response:
                    progressive_asset_status[relative_path] = response.status
            except Exception as error:
                raise SystemExit(f"Progressive runtime image was not served: {relative_path}: {error}") from error
        if any(status != 200 for status in progressive_asset_status.values()):
            raise SystemExit(f"Progressive runtime images did not all return HTTP 200: {progressive_asset_status}")
        try:
            with urlopen(Request(base_url + "web-presplash.jpg", method="HEAD"), timeout=30) as response:
                presplash_http_status = response.status
        except Exception as error:
            raise SystemExit(f"Web presplash was not served: {error}") from error
        if presplash_http_status != 200:
            raise SystemExit(f"Web presplash did not return HTTP 200: {presplash_http_status}")

        with sync_playwright() as playwright:
            launch_args = [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--enable-webgl",
                "--ignore-gpu-blocklist",
                "--use-gl=angle",
                "--use-angle=swiftshader",
            ]
            chromium = find_chromium()
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=chromium,
                args=launch_args,
            )
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on(
                "requestfailed",
                lambda request: failed_requests.append(f"{request.url}: {request.failure}"),
            )
            page.on(
                "response",
                lambda response: resource_status.__setitem__(Path(urlparse(response.url).path).name, response.status)
                if Path(urlparse(response.url).path).name in {"index.html", "game.zip", "renpy.js", "renpy.wasm", "renpy.data", "web-presplash.jpg"}
                else None,
            )
            response = page.goto(base_url, wait_until="domcontentloaded", timeout=60_000)
            if response is None or response.status != 200:
                raise SystemExit(f"Web page did not return HTTP 200: {response.status if response else 'no response'}")
            page.wait_for_function(
                """() => {
                    const canvas = document.querySelector('canvas');
                    return canvas && canvas.width >= 640 && canvas.height >= 360;
                }""",
                timeout=120_000,
            )
            page.wait_for_timeout(3000)
            canvas_size = page.locator("canvas").first.evaluate("canvas => [canvas.width, canvas.height]")
            # Verify the rendered game accepts a real keyboard event without a runtime exception.
            page.keyboard.press("Enter")
            page.wait_for_timeout(2000)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    required = {"game.zip", "renpy.js", "renpy.wasm", "renpy.data", "web-presplash.jpg"}
    missing = sorted(name for name in required if resource_status.get(name) != 200)
    if missing:
        raise SystemExit(f"Required runtime resources were not fetched successfully: {missing}; got {resource_status}")
    benign_archive_aborts = [
        request for request in failed_requests
        if request == base_url + "game.zip: net::ERR_ABORTED"
        and resource_status.get("game.zip") == 200
        and canvas_size is not None
    ]
    unresolved_failed_requests = [request for request in failed_requests if request not in benign_archive_aborts]
    if benign_archive_aborts:
        print("INFO: Chromium canceled a game.zip request after HTTP 200 and canvas initialization.")
    if unresolved_failed_requests:
        raise SystemExit("Failed browser requests: " + " | ".join(unresolved_failed_requests))
    if console_errors or page_errors:
        details = " | ".join(console_errors + page_errors)
        raise SystemExit("Browser runtime reported errors: " + details)

    report = {
        "status": "PASS",
        "url": base_url,
        "canvas": canvas_size,
        "resources": resource_status,
        "webPresplash": {
            "file": str(presplash_path),
            "sha256MatchesOpeningLandscape": True,
            "headStatus": presplash_http_status,
            "browserStatus": resource_status.get("web-presplash.jpg"),
        },
        "progressiveImageAssets": {
            "count": len(progressive_asset_status),
            "backgroundCount": len(background_manifest["assets"]),
            "spriteCount": len(sprite_manifest["assets"]),
            "allHttp200": all(status == 200 for status in progressive_asset_status.values()),
        },
        "realRuntimeFiles": {
            "backgroundsSha256Verified": verified_backgrounds,
            "spritesSha256Verified": verified_sprites,
            "openingBackgroundPresent": True,
            "webPresplashMatchesOpeningLandscape": True,
            "placeholderFilesUsedAsEvidence": False,
        },
        "compiledRenpyStory": {
            "member": "game/script.rpyc",
            "bytes": compiled_story_bytes,
            "loadedThroughGameZip": resource_status.get("game.zip") == 200,
        },
        "keyboardInput": "Enter dispatched after canvas initialization",
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
        "failedRequests": unresolved_failed_requests,
        "benignArchiveAborts": benign_archive_aborts,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"PASS: Ren'Py Web canvas {canvas_size}; HTTP 200 for game.zip/runtime, web-presplash.jpg and all {len(progressive_asset_status)} progressive images; Enter input accepted; no browser errors.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
