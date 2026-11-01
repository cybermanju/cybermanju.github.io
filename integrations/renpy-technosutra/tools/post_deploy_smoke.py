#!/usr/bin/env python3
"""Post-deploy UI/gameplay smoke for CyberManju OS and The Stem Array.

This test uses a fresh browser context and only visible UI / real mouse and
keyboard input. It never injects credentials, cookies, localStorage, or game
state. PASS requires a real Ren'Py dialogue segment, chapter background and
portrait currently shown by Ren'Py, plus a changed dialogue after user input.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

SCHEMA_VERSION = "1.0"
RUNTIME_METADATA_PATH = "technosutra-vn/build-metadata.json"
RUNTIME_GAME_ZIP_PATH = "technosutra-vn/game.zip"
EXPECTED_SPRITE_TAG = "master_ch01_provisional"
EXPECTED_BACKGROUND_TAG = "bg_ch01"
OPENING_NARRATION_MARKER = "Esta abertura usa um cenário original independente."
CHAPTER_ONE_DIALOGUE_MARKER = "Em Śrāvastī, o Bhagavat está em Jetavana acompanhado por Samantabhadra"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_base_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("--base-url must be an absolute http(s) URL")
    return value.rstrip("/") + "/"


def fetch_json(url: str, timeout: float) -> tuple[int | None, dict[str, Any] | None, str | None]:
    request = Request(url, headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    try:
        with urlopen(request, timeout=timeout) as response:
            status = response.status
            body = response.read()
        parsed = json.loads(body.decode("utf-8"))
        if not isinstance(parsed, dict):
            return status, None, "JSON document is not an object"
        return status, parsed, None
    except HTTPError as error:
        return error.code, None, f"HTTP {error.code}: {error.reason}"
    except (URLError, TimeoutError, OSError) as error:
        return None, None, f"{type(error).__name__}: {error}"
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        return 200, None, f"invalid JSON: {error}"


def fetch_sha256(url: str, timeout: float) -> tuple[int | None, int | None, str | None, str | None]:
    request = Request(url, headers={"Accept": "application/zip", "Cache-Control": "no-cache"})
    try:
        with urlopen(request, timeout=timeout) as response:
            status = response.status
            digest = hashlib.sha256()
            size = 0
            while block := response.read(1024 * 1024):
                size += len(block)
                digest.update(block)
        return status, size, digest.hexdigest(), None
    except HTTPError as error:
        return error.code, None, None, f"HTTP {error.code}: {error.reason}"
    except (URLError, TimeoutError, OSError) as error:
        return None, None, None, f"{type(error).__name__}: {error}"


def verify_deployment(
    base_url: str,
    expected_sha: str,
    expected_run_id: str,
    expected_run_attempt: str,
    timeout: float,
    poll_interval: float,
) -> dict[str, Any]:
    """Require exact source SHA, workflow run/attempt, and the published ZIP bytes."""
    deploy_url = urljoin(base_url, "deployment-info.json")
    runtime_url = urljoin(base_url, RUNTIME_METADATA_PATH)
    zip_url = urljoin(base_url, RUNTIME_GAME_ZIP_PATH)
    deadline = time.monotonic() + timeout
    attempts = 0
    last_deployment: dict[str, Any] | None = None
    last_runtime: dict[str, Any] | None = None
    last_errors: list[str] = []
    expected = expected_sha.strip().lower()
    expected_run_id = expected_run_id.strip()
    expected_run_attempt = expected_run_attempt.strip()
    expected_build_id = f"ci-{expected_run_id}-{expected_run_attempt}"
    zip_retry_delay = 1.0
    last_zip: dict[str, Any] | None = None

    while True:
        attempts += 1
        deploy_status, deployment, deploy_error = fetch_json(deploy_url, min(10.0, max(timeout, 1.0)))
        runtime_status, runtime, runtime_error = fetch_json(runtime_url, min(10.0, max(timeout, 1.0)))
        if deployment is not None:
            last_deployment = deployment
        if runtime is not None:
            last_runtime = runtime

        deploy_sha = str((deployment or {}).get("sha", "")).strip().lower()
        runtime_sha = str((runtime or {}).get("sourceSha", "")).strip().lower()
        deployment_ok = (
            deploy_status == 200
            and deployment is not None
            and deploy_sha == expected
            and str(deployment.get("runId", "")).strip() == expected_run_id
            and str(deployment.get("runAttempt", "")).strip() == expected_run_attempt
            and bool(str(deployment.get("ref", "")).strip())
        )
        runtime_ok = (
            runtime_status == 200
            and runtime is not None
            and runtime_sha == expected
            and str(runtime.get("runId", "")).strip() == expected_run_id
            and str(runtime.get("runAttempt", "")).strip() == expected_run_attempt
            and str(runtime.get("buildId", "")).strip() == expected_build_id
        )
        if deployment_ok and runtime_ok:
            zip_status, zip_size, zip_digest, zip_error = fetch_sha256(zip_url, min(30.0, max(timeout, 1.0)))
            expected_zip_size = runtime.get("gameZipBytes")
            expected_zip_digest = str(runtime.get("gameZipSha256", "")).strip().lower()
            zip_matches = (
                zip_status == 200
                and isinstance(expected_zip_size, int)
                and zip_size == expected_zip_size
                and bool(expected_zip_digest)
                and zip_digest == expected_zip_digest
            )
            last_zip = {
                "url": zip_url,
                "httpStatus": zip_status,
                "bytes": zip_size,
                "sha256": zip_digest,
                "expectedBytes": expected_zip_size,
                "expectedSha256": expected_zip_digest,
                "matchesMetadata": zip_matches,
            }
            if zip_matches:
                return {
                    "verified": True,
                    "attempts": attempts,
                    "deploymentInfoUrl": deploy_url,
                    "deploymentInfoHttpStatus": deploy_status,
                    "deploymentInfo": deployment,
                    "runtimeMetadataUrl": runtime_url,
                    "runtimeMetadataHttpStatus": runtime_status,
                    "runtimeMetadata": runtime,
                    "runtimeZip": last_zip,
                    "sourceShaMatchesExpected": True,
                    "runIdMatchesExpected": True,
                    "runAttemptMatchesExpected": True,
                    "runtimeZipMatchesMetadata": True,
                    "error": None,
                }
            if zip_error:
                last_errors = [f"published game.zip: {zip_error}"]
            elif zip_status != 200:
                last_errors = [f"published game.zip returned HTTP {zip_status}"]
            elif zip_size != expected_zip_size:
                last_errors = [f"published game.zip is {zip_size} bytes, expected {expected_zip_size}"]
            else:
                last_errors = [f"published game.zip SHA-256 is {zip_digest!r}, expected {expected_zip_digest!r}"]
            if time.monotonic() >= deadline:
                break
            time.sleep(min(zip_retry_delay, max(0.0, deadline - time.monotonic())))
            zip_retry_delay = min(zip_retry_delay * 2, 30.0)
            continue

        last_errors = []
        if not deployment_ok:
            if deploy_error:
                last_errors.append(f"deployment-info.json: {deploy_error}")
            elif deployment is not None and deploy_sha != expected:
                last_errors.append(f"deployment SHA is {deployment.get('sha')!r}, expected {expected_sha!r}")
            elif deployment is not None and (
                str(deployment.get("runId", "")).strip() != expected_run_id
                or str(deployment.get("runAttempt", "")).strip() != expected_run_attempt
            ):
                last_errors.append(
                    "deployment runId/runAttempt are "
                    f"{deployment.get('runId')!r}/{deployment.get('runAttempt')!r}, "
                    f"expected {expected_run_id!r}/{expected_run_attempt!r}"
                )
            else:
                last_errors.append("deployment-info.json must contain matching sha, runId, runAttempt, and ref")
        if not runtime_ok:
            if runtime_error:
                last_errors.append(f"build-metadata.json: {runtime_error}")
            elif runtime is not None and runtime_sha != expected:
                last_errors.append(f"VN sourceSha is {runtime.get('sourceSha')!r}, expected {expected_sha!r}")
            elif runtime is not None and (
                str(runtime.get("runId", "")).strip() != expected_run_id
                or str(runtime.get("runAttempt", "")).strip() != expected_run_attempt
                or str(runtime.get("buildId", "")).strip() != expected_build_id
            ):
                last_errors.append(
                    "VN runId/runAttempt/buildId do not match expected workflow "
                    f"{expected_run_id!r}/{expected_run_attempt!r}/{expected_build_id!r}"
                )
            else:
                last_errors.append("VN build-metadata.json must contain matching source SHA and workflow run metadata")

        if time.monotonic() >= deadline:
            break
        time.sleep(min(poll_interval, max(0.0, deadline - time.monotonic())))

    return {
        "verified": False,
        "attempts": attempts,
        "deploymentInfoUrl": deploy_url,
        "deploymentInfoHttpStatus": deploy_status,
        "deploymentInfo": last_deployment,
        "runtimeMetadataUrl": runtime_url,
        "runtimeMetadataHttpStatus": runtime_status,
        "runtimeMetadata": last_runtime,
        "runtimeZip": last_zip,
        "sourceShaMatchesExpected": bool(last_runtime and str(last_runtime.get("sourceSha", "")).strip().lower() == expected),
        "runIdMatchesExpected": bool(last_runtime and str(last_runtime.get("runId", "")).strip() == expected_run_id),
        "runAttemptMatchesExpected": bool(last_runtime and str(last_runtime.get("runAttempt", "")).strip() == expected_run_attempt),
        "runtimeZipMatchesMetadata": bool(last_zip and last_zip.get("matchesMetadata")),
        "error": "; ".join(last_errors) or "deployment metadata did not become available before timeout",
    }


def find_chromium() -> str | None:
    explicit = os.environ.get("CHROMIUM_PATH")
    if explicit:
        return explicit
    for name in ("chromium", "chromium-browser", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def write_outputs(output_dir: Path, report: dict[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    report["finishedAt"] = utc_now()
    started = report.get("startedMonotonic")
    if started is not None:
        report["durationSeconds"] = round(time.monotonic() - started, 3)
    report.pop("startedMonotonic", None)
    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    artifacts = report.get("artifacts", {})
    checks = report.get("checks", {})
    lines = [
        "## CyberManju OS / The Stem Array post-deploy smoke",
        "",
        f"- **Status:** `{report.get('status', 'FAIL')}`",
        f"- **Expected SHA:** `{report.get('expectedSha', '')}`",
        f"- **Expected workflow run:** `{report.get('expectedRunId', '')}` attempt `{report.get('expectedRunAttempt', '')}`",
        f"- **Base URL:** {report.get('baseUrl', '')}",
        f"- **Deployment metadata:** {'verified' if report.get('deployment', {}).get('verified') else 'not verified'}",
        f"- **Published game.zip SHA-256:** {'matches runtime metadata' if checks.get('publishedGameZipMatchesMetadata') else 'not verified'}",
        f"- **Gameplay evidence:** dialogue={checks.get('dialogueObserved', False)}, scene={checks.get('chapterBackgroundVisible', False)}, sprite={checks.get('characterSpriteVisible', False)}, changed after real input={checks.get('dialogueChangedAfterInput', False)}",
    ]
    if report.get("blocker"):
        lines.extend([f"- **Blocker:** {report['blocker']}"])
    if report.get("failure"):
        lines.extend([f"- **Failure:** {report['failure']}"])
    lines.extend(["", "Evidence files:"])
    for name, path in artifacts.items():
        if path:
            lines.append(f"- `{name}`: `{path}`")
    lines.append(f"- `report.json`: `{report_path}`")
    (output_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def screenshot(page: Any, path: Path, report: dict[str, Any], key: str) -> None:
    try:
        page.screenshot(path=str(path), full_page=True, animations="disabled", timeout=20_000)
        if path.is_file() and path.stat().st_size > 0:
            report.setdefault("artifacts", {})[key] = str(path)
    except Exception as error:  # A screenshot failure must be visible in the report.
        report.setdefault("screenshotErrors", []).append(f"{key}: {type(error).__name__}: {error}")


def auth_blocked(page: Any) -> bool:
    try:
        return page.locator("#auth-gate-title").is_visible(timeout=200)
    except Exception:
        return False


def dismiss_setup_and_tour(page: Any, report: dict[str, Any]) -> None:
    # Use the wizard's own skip/finish/close controls; never touch its storage.
    for _ in range(10):
        wizard = page.locator("[data-testid='setup-wizard-body']")
        if not wizard.is_visible():
            break
        skip_all = page.locator("[data-testid='setup-skip-all']")
        finish = page.locator("[data-testid='setup-finish']")
        skip = wizard.locator("button").filter(has_text=re.compile(r"^\s*Skip\s*$", re.I))
        if skip_all.is_visible():
            skip_all.click(timeout=5_000)
            report["checks"]["setupWizardDismissed"] = True
        elif finish.is_visible():
            finish.click(timeout=5_000)
            report["checks"]["setupWizardDismissed"] = True
        elif skip.count() > 0 and skip.first.is_visible():
            skip.first.click(timeout=5_000)
            report["checks"]["setupWizardDismissed"] = True
        else:
            close = page.get_by_role("button", name="Close setup wizard")
            if close.is_visible():
                close.click(timeout=5_000)
                report["checks"]["setupWizardDismissed"] = True
            else:
                raise RuntimeError("Setup wizard is visible but has no usable real UI dismissal control")
        page.wait_for_timeout(200)
    else:
        raise RuntimeError("Setup wizard did not dismiss after using its visible controls")

    # The coach has a real next/done button on each step; walk those controls.
    for _ in range(14):
        coach = page.locator("[data-testid='first-run-coach']")
        if not coach.is_visible():
            break
        next_button = coach.locator("button[data-testid^='coach-next-']")
        if next_button.count() and next_button.first.is_visible():
            next_button.first.click(timeout=5_000)
            report["checks"]["firstRunTourDismissed"] = True
        else:
            page.keyboard.press("Escape")
            report["checks"]["firstRunTourDismissed"] = True
        page.wait_for_timeout(180)
    else:
        raise RuntimeError("First-run tour did not dismiss after using its visible controls")


def open_stem_array(page: Any, report: dict[str, Any]) -> None:
    # Prefer the actual app shortcut in the desktop launcher/home grid.
    shortcut = page.locator("button[data-home-item='app:technosutra-novel']")
    if shortcut.is_visible(timeout=1_000):
        shortcut.click(timeout=10_000)
        report["navigation"] = {"method": "desktop launcher app shortcut", "control": "The Stem Array"}
    else:
        # Command palette fallback: open by its documented Ctrl+K shortcut,
        # filter by user typing, then click the matching real result.
        page.keyboard.press("Control+k")
        palette = page.get_by_role("dialog", name="Command palette")
        palette.wait_for(state="visible", timeout=5_000)
        search = page.get_by_role("textbox", name="Search commands")
        search.fill("Play The Stem Array")
        result = page.locator(".cp-item").filter(has_text=re.compile(r"Play The Stem Array", re.I))
        result.first.wait_for(state="visible", timeout=5_000)
        result.first.click(timeout=5_000)
        report["navigation"] = {"method": "command palette", "control": "Play The Stem Array — Ren'Py visual novel"}

    frame_locator = page.locator("iframe.ts-game-frame")
    frame_locator.wait_for(state="visible", timeout=20_000)
    page.locator(".app-window:has(iframe.ts-game-frame)").wait_for(state="visible", timeout=10_000)
    report["checks"]["gameWindowOpened"] = True
    frame = next((candidate for candidate in page.frames if candidate.url and "technosutra-vn/" in candidate.url), None)
    if frame is None:
        raise RuntimeError("The Stem Array iframe did not expose a browser frame")
    report["gameFrameUrl"] = frame.url
    if urlparse(frame.url).path.rstrip("/").endswith("technosutra-vn"):
        raise RuntimeError("The VN iframe URL points to a directory instead of its deployed runtime index")
    report["checks"]["iframeLoaded"] = True


def read_telemetry(frame: Any) -> dict[str, Any] | None:
    try:
        value = frame.evaluate("() => window.stemArrayCI || null")
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def wait_for_new_telemetry(frame: Any, previous: dict[str, Any] | None, timeout_seconds: float) -> dict[str, Any] | None:
    try:
        previous_sequence = int((previous or {}).get("sequence", 0))
    except (TypeError, ValueError):
        previous_sequence = 0
    deadline = time.monotonic() + timeout_seconds
    latest: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        latest = read_telemetry(frame)
        try:
            sequence = int((latest or {}).get("sequence", 0))
        except (TypeError, ValueError):
            sequence = 0
        if latest and sequence > previous_sequence:
            return latest
        frame.wait_for_timeout(100)
    return latest


def click_canvas(page: Any, canvas: Any, x_fraction: float, y_fraction: float) -> None:
    # Playwright returns the iframe canvas box relative to the top-level page;
    # use the page mouse so input still works after Ren'Py removes #overlayDiv.
    box = canvas.bounding_box()
    if not box:
        raise RuntimeError("Ren'Py canvas has no visible browser bounding box")
    page.mouse.click(box["x"] + box["width"] * x_fraction, box["y"] + box["height"] * y_fraction)


def drive_game_to_chapter_one(page: Any, frame: Any, report: dict[str, Any], timeout_seconds: int) -> dict[str, Any]:
    canvas = frame.locator("canvas").first
    canvas.wait_for(state="visible", timeout=timeout_seconds * 1_000)
    frame.wait_for_function("() => { const c = document.querySelector('canvas'); return !!c && c.width > 300 && c.height > 180; }", timeout=timeout_seconds * 1_000)
    dimensions = canvas.evaluate("e => ({width: e.clientWidth, height: e.clientHeight, pixelWidth: e.width, pixelHeight: e.height})")
    if dimensions["width"] < 300 or dimensions["height"] < 180 or dimensions["pixelWidth"] <= 300 or dimensions["pixelHeight"] <= 180:
        raise RuntimeError(f"Ren'Py canvas is unexpectedly small: {dimensions}")
    report["checks"]["canvasInitialized"] = True
    report["canvas"] = dimensions

    initial_deadline = time.monotonic() + timeout_seconds
    state: dict[str, Any] | None = None
    for _ in range(10):
        state = read_telemetry(frame)
        if state and OPENING_NARRATION_MARKER in str(state.get("dialogue", "")):
            break
        click_canvas(page, canvas, 0.52, 0.50)
        frame.wait_for_timeout(900)
        state = read_telemetry(frame)
        if state and OPENING_NARRATION_MARKER in str(state.get("dialogue", "")):
            break
        if time.monotonic() >= initial_deadline:
            break
    if not state or OPENING_NARRATION_MARKER not in str(state.get("dialogue", "")):
        raise RuntimeError("Ren'Py canvas started but the known opening narrator line was not observed via show_done telemetry")

    # A real click advances through the second opening narration and to the
    # story's menu. Click the visible second option to enter chapter 1.
    second_opening: dict[str, Any] | None = None
    for _ in range(3):
        if state and "As cenas recontam os capítulos" in str(state.get("dialogue", "")):
            second_opening = state
            break
        click_canvas(page, canvas, 0.52, 0.88)
        frame.wait_for_timeout(900)
        second_opening = read_telemetry(frame)
        if second_opening and "As cenas recontam os capítulos" in str(second_opening.get("dialogue", "")):
            break
    if not second_opening or "As cenas recontam os capítulos" not in str(second_opening.get("dialogue", "")):
        raise RuntimeError("The second authored opening narration was not observed; refusing to guess the game's menu position")
    # Advance from the second introductory narration to the visible menu.
    click_canvas(page, canvas, 0.52, 0.88)
    frame.wait_for_timeout(500)

    # Click the visible second menu choice. Its first centered title is shown
    # immediately, but the callback publishes it only after the next input.
    click_canvas(page, canvas, 0.08, 0.83)
    frame.wait_for_timeout(500)
    target = read_telemetry(frame)

    deadline = time.monotonic() + timeout_seconds
    for _ in range(4):
        tags = set(target.get("showingTags", [])) if target else set()
        if target and CHAPTER_ONE_DIALOGUE_MARKER in str(target.get("dialogue", "")) and EXPECTED_SPRITE_TAG in tags and EXPECTED_BACKGROUND_TAG in tags:
            break
        if time.monotonic() >= deadline:
            break
        previous = target
        click_canvas(page, canvas, 0.52, 0.88)
        target = wait_for_new_telemetry(frame, previous, min(10, max(1, deadline - time.monotonic())))

    tags = set(target.get("showingTags", [])) if target else set()
    report["gameStateBeforeInput"] = target
    report["checks"]["dialogueObserved"] = bool(target and CHAPTER_ONE_DIALOGUE_MARKER in str(target.get("dialogue", "")))
    report["checks"]["characterSpriteVisible"] = EXPECTED_SPRITE_TAG in tags
    report["checks"]["chapterBackgroundVisible"] = EXPECTED_BACKGROUND_TAG in tags
    if not (report["checks"]["dialogueObserved"] and report["checks"]["characterSpriteVisible"] and report["checks"]["chapterBackgroundVisible"]):
        raise RuntimeError("Did not reach the visible Chapter 1 dialogue with both bg_ch01 and master_ch01_provisional shown by Ren'Py")
    return target


def advance_dialogue(page: Any, frame: Any, before: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    canvas = frame.locator("canvas").first
    last_state: dict[str, Any] | None = None
    # Real clicks in the visible dialogue box. A first click can finish slow
    # text; retry until the actual displayed dialogue changes or time out.
    for attempt in range(1, 5):
        click_canvas(page, canvas, 0.52, 0.88)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            last_state = read_telemetry(frame)
            if last_state and int(last_state.get("sequence", 0)) > int(before.get("sequence", 0)) and last_state.get("dialogue") != before.get("dialogue"):
                report["input"] = {"kind": "mouse click", "target": "Ren'Py dialogue area", "attempts": attempt}
                report["gameStateAfterInput"] = last_state
                report["checks"]["dialogueChangedAfterInput"] = True
                tags = set(last_state.get("showingTags", []))
                report["checks"]["characterSpriteVisibleAfterInput"] = EXPECTED_SPRITE_TAG in tags
                report["checks"]["chapterBackgroundVisibleAfterInput"] = EXPECTED_BACKGROUND_TAG in tags
                return last_state
            frame.wait_for_timeout(200)
    report["input"] = {"kind": "mouse click", "target": "Ren'Py dialogue area", "attempts": 4}
    report["gameStateAfterInput"] = last_state
    report["checks"]["dialogueChangedAfterInput"] = False
    raise RuntimeError("Real click input did not advance to a different observed Ren'Py dialogue segment")


def run_browser(base_url: str, output_dir: Path, report: dict[str, Any], timeout_seconds: int) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Playwright is missing; install integrations/renpy-technosutra/requirements-renpy-build.txt") from error

    launch_args = [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-gl=angle",
        "--use-angle=swiftshader",
    ]
    chromium = find_chromium()
    with sync_playwright() as playwright:
        options: dict[str, Any] = {"headless": True, "args": launch_args}
        if chromium:
            options["executable_path"] = chromium
        browser = playwright.chromium.launch(**options)
        try:
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
            response = page.goto(base_url, wait_until="domcontentloaded", timeout=60_000)
            report["httpStatus"] = response.status if response else None
            report["finalUrl"] = page.url
            if auth_blocked(page):
                screenshot(page, output_dir / "blocker.png", report, "blockerScreenshot")
                raise PermissionError("CyberManju OS presents its real sign-in/registration gate; no credentials were supplied and authentication was not bypassed")
            if response is None or response.status >= 400:
                screenshot(page, output_dir / "blocker.png", report, "blockerScreenshot")
                raise PermissionError(f"Hosting returned HTTP {response.status if response else 'no response'} for the OS page")

            # The landing page performs its normal boot sequence; wait for its
            # real entry button or an already-open desktop shell.
            try:
                page.get_by_role("button", name="Enter CyberManju", exact=True).wait_for(state="visible", timeout=90_000)
                dismiss_setup_and_tour(page, report)
                page.get_by_role("button", name="Enter CyberManju", exact=True).click(timeout=15_000)
                report["checks"]["shellLoaded"] = True
            except Exception:
                if page.locator(".desktop-shell").is_visible():
                    dismiss_setup_and_tour(page, report)
                    report["checks"]["shellLoaded"] = True
                else:
                    if auth_blocked(page):
                        screenshot(page, output_dir / "blocker.png", report, "blockerScreenshot")
                        raise PermissionError("Authentication gate appeared while CyberManju OS was starting")
                    screenshot(page, output_dir / "blocker.png", report, "blockerScreenshot")
                    raise RuntimeError("CyberManju OS did not expose its real landing entry button or desktop shell")

            # A tour is armed by finishing/skipping first-run setup and starts
            # on first shell entry; drain it again using its real buttons.
            dismiss_setup_and_tour(page, report)
            if auth_blocked(page):
                screenshot(page, output_dir / "blocker.png", report, "blockerScreenshot")
                raise PermissionError("Authentication gate blocks the desktop shell")

            open_stem_array(page, report)
            report["checks"]["paletteOrLauncherUsed"] = True
            frame = next((candidate for candidate in page.frames if candidate.url and "technosutra-vn/" in candidate.url), None)
            if frame is None:
                raise RuntimeError("The Stem Array iframe did not expose a browser frame")
            # Confirm the actual iframe document is the same-origin VN package.
            iframe_src = page.locator("iframe.ts-game-frame").get_attribute("src") or ""
            report["gameIframeSrc"] = iframe_src
            if "technosutra-vn/" not in iframe_src:
                raise RuntimeError(f"Unexpected The Stem Array iframe URL: {iframe_src}")

            before = drive_game_to_chapter_one(page, frame, report, timeout_seconds)
            screenshot(page, output_dir / "vn-before.png", report, "vnBeforeInputScreenshot")
            after = advance_dialogue(page, frame, before, report)
            screenshot(page, output_dir / "vn-after.png", report, "vnAfterInputScreenshot")

            report["browserErrors"] = errors
            report["checks"]["shellLoaded"] = True
            report["checks"]["gameWindowOpened"] = True
            report["checks"]["iframeLoaded"] = True
            required = (
                report["checks"].get("dialogueObserved")
                and report["checks"].get("chapterBackgroundVisible")
                and report["checks"].get("characterSpriteVisible")
                and report["checks"].get("dialogueChangedAfterInput")
                and report["checks"].get("chapterBackgroundVisibleAfterInput")
                and report["checks"].get("characterSpriteVisibleAfterInput")
                and report.get("artifacts", {}).get("vnBeforeInputScreenshot")
                and report.get("artifacts", {}).get("vnAfterInputScreenshot")
            )
            if not required:
                raise RuntimeError("Gameplay evidence criteria did not all pass; a canvas-only startup is not success")
            report["status"] = "PASS"
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="Deployed CyberManju OS base URL (root or /develop/)")
    parser.add_argument("--expected-sha", required=True, help="Expected deployed Git commit SHA")
    parser.add_argument("--expected-run-id", required=True, help="Expected GitHub Actions run ID")
    parser.add_argument("--expected-run-attempt", required=True, help="Expected GitHub Actions run attempt")
    parser.add_argument("--output-dir", required=True, type=Path, help="Directory for screenshots, report.json, and summary.md")
    parser.add_argument("--deployment-timeout", type=int, default=180, help="Seconds to wait for matching deployment/build metadata (default: 180)")
    parser.add_argument("--poll-interval", type=float, default=3.0, help="Metadata polling interval in seconds")
    parser.add_argument("--game-timeout", type=int, default=90, help="Seconds to reach Chapter 1 dialogue and visible assets (default: 90)")
    args = parser.parse_args()

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    report: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "status": "FAIL",
        "baseUrl": "",
        "expectedSha": args.expected_sha.strip(),
        "expectedRunId": args.expected_run_id.strip(),
        "expectedRunAttempt": args.expected_run_attempt.strip(),
        "startedAt": utc_now(),
        "startedMonotonic": started,
        "deployment": {},
        "checks": {
            "deploymentVerified": False,
            "publishedGameZipMatchesMetadata": False,
            "shellLoaded": False,
            "setupWizardDismissed": False,
            "firstRunTourDismissed": False,
            "paletteOrLauncherUsed": False,
            "gameWindowOpened": False,
            "iframeLoaded": False,
            "canvasInitialized": False,
            "dialogueObserved": False,
            "chapterBackgroundVisible": False,
            "characterSpriteVisible": False,
            "dialogueChangedAfterInput": False,
        },
        "artifacts": {},
        "browserErrors": [],
    }
    try:
        base_url = normalize_base_url(args.base_url)
        report["baseUrl"] = base_url
        if args.deployment_timeout <= 0 or args.game_timeout <= 0 or args.poll_interval <= 0:
            raise ValueError("timeouts and poll interval must be positive")
        deployment = verify_deployment(
            base_url,
            report["expectedSha"],
            report["expectedRunId"],
            report["expectedRunAttempt"],
            args.deployment_timeout,
            args.poll_interval,
        )
        report["deployment"] = deployment
        report["checks"]["deploymentVerified"] = deployment["verified"]
        report["checks"]["publishedGameZipMatchesMetadata"] = deployment.get("runtimeZipMatchesMetadata", False)
        if not deployment["verified"]:
            report["status"] = "BLOCKED"
            report["blocker"] = "Deployment/runtime metadata or public game.zip did not match the expected SHA and workflow run before the bounded wait expired: " + str(deployment.get("error"))
            # Keep a screenshot of the hosting response for a clear diagnosis,
            # but do not run the application/game against an unverified build.
            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as playwright:
                    launch_options: dict[str, Any] = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
                    chromium = find_chromium()
                    if chromium:
                        launch_options["executable_path"] = chromium
                    browser = playwright.chromium.launch(**launch_options)
                    page = browser.new_page(viewport={"width": 1440, "height": 1000})
                    page.goto(base_url, wait_until="domcontentloaded", timeout=20_000)
                    screenshot(page, output_dir / "blocker.png", report, "blockerScreenshot")
                    browser.close()
            except Exception as error:
                report.setdefault("screenshotErrors", []).append(f"blockerScreenshot: {type(error).__name__}: {error}")
        else:
            run_browser(base_url, output_dir, report, args.game_timeout)
    except PermissionError as error:
        report["status"] = "BLOCKED"
        report["blocker"] = str(error)
    except Exception as error:
        report["status"] = "FAIL"
        report["failure"] = f"{type(error).__name__}: {error}"
        if not report.get("artifacts", {}).get("blockerScreenshot"):
            # Capture a diagnostic screenshot if no earlier blocker page was saved.
            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as playwright:
                    launch_options: dict[str, Any] = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
                    chromium = find_chromium()
                    if chromium:
                        launch_options["executable_path"] = chromium
                    browser = playwright.chromium.launch(**launch_options)
                    page = browser.new_page(viewport={"width": 1440, "height": 1000})
                    if report.get("baseUrl"):
                        page.goto(report["baseUrl"], wait_until="domcontentloaded", timeout=15_000)
                    screenshot(page, output_dir / "blocker.png", report, "blockerScreenshot")
                    browser.close()
            except Exception as screenshot_error:
                report.setdefault("screenshotErrors", []).append(f"diagnosticScreenshot: {type(screenshot_error).__name__}: {screenshot_error}")
    finally:
        write_outputs(output_dir, report)

    print(f"{report['status']}: {report.get('blocker') or report.get('failure') or 'dialogue, visible chapter scene/portrait, and real-input advancement verified'}")
    print(f"Report: {output_dir / 'report.json'}")
    print(f"Summary: {output_dir / 'summary.md'}")
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
