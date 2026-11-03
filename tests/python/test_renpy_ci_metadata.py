#!/usr/bin/env python3
"""CyberManju OS — same-run Ren'Py artifact metadata regressions."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("ci_runtime_metadata", ROOT / "integrations/renpy-technosutra/tools/ci_runtime_metadata.py")
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SMOKE_SPEC = importlib.util.spec_from_file_location("post_deploy_smoke", ROOT / "integrations/renpy-technosutra/tools/post_deploy_smoke.py")
assert SMOKE_SPEC is not None and SMOKE_SPEC.loader is not None
SMOKE = importlib.util.module_from_spec(SMOKE_SPEC)
SMOKE_SPEC.loader.exec_module(SMOKE)
SHA = "1234567890abcdef1234567890abcdef12345678"
RUN_ID = "12345"
RUN_ATTEMPT = "2"
ZIP_BYTES = b"published game.zip bytes"
ZIP_SHA = hashlib.sha256(ZIP_BYTES).hexdigest()
SERVICE_WORKER_BYTES = b"published service worker bytes"
SERVICE_WORKER_SHA = hashlib.sha256(SERVICE_WORKER_BYTES).hexdigest()


class RuntimeMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.runtime = self.root / "runtime"
        self.runtime.mkdir()
        for filename in MODULE.RUNTIME_FILES:
            (self.runtime / filename).write_bytes(b"validated runtime bytes")
        payload = (self.runtime / "game.zip").read_bytes()
        self.report = {
            "status": "PASS", "smokeTest": {"status": "PASS"},
            "authorizedSpritesIncluded": True, "runtimeSpriteSha256Verified": True,
            "spriteManifestPreserved": True, "captureManifestPreserved": True,
            "rawSourceCapturePngsInPackage": False, "runtimeSpriteCount": 54,
            "optimizedImageCount": 56, "gameZipBytes": len(payload),
            "gameZipSha256": hashlib.sha256(payload).hexdigest(),
            "engine": "Ren'Py 8.5.3.26051504", "buildId": f"ci-{RUN_ID}-{RUN_ATTEMPT}", "webOutputBytes": 96,
        }
        self.report_path = self.root / "report.json"
        self.write_report()

    def write_report(self):
        self.report_path.write_text(json.dumps(self.report), encoding="utf-8")

    def export(self):
        return MODULE.export_metadata(self.report_path, self.runtime, SHA, RUN_ID, RUN_ATTEMPT)

    def stage(self, expected_sha=SHA, run_id=RUN_ID, run_attempt=RUN_ATTEMPT):
        return MODULE.stage_typescript(self.runtime, self.root / "technosutra-vn.ts", expected_sha, run_id, run_attempt)

    def test_validated_same_commit_and_run_runtime_generates_typescript(self):
        metadata = self.export()
        staged = self.stage()
        output = (self.root / "technosutra-vn.ts").read_text()
        self.assertEqual(staged, metadata)
        self.assertEqual(metadata["renpyVersion"], "8.5.3.26051504")
        self.assertEqual(metadata["runId"], RUN_ID)
        self.assertEqual(metadata["runAttempt"], RUN_ATTEMPT)
        self.assertIn('"validationCommit": "1234567"', output)
        self.assertIn('"runId": "12345"', output)
        self.assertIn("as const", output)

    def test_unapproved_report_is_not_exported(self):
        self.report["smokeTest"]["status"] = "FAIL"
        self.write_report()
        with self.assertRaisesRegex(ValueError, "passing build"):
            self.export()
        self.assertFalse((self.runtime / MODULE.METADATA_NAME).exists())

    def test_raw_captures_and_unapproved_sprites_are_rejected(self):
        self.report["rawSourceCapturePngsInPackage"] = True
        self.write_report()
        with self.assertRaisesRegex(ValueError, "Raw source"):
            self.export()
        self.report["rawSourceCapturePngsInPackage"] = False
        self.report["authorizedSpritesIncluded"] = False
        self.write_report()
        with self.assertRaisesRegex(ValueError, "authorizedSpritesIncluded"):
            self.export()

    def test_modified_archive_is_rejected_before_export_and_stage(self):
        self.export()
        (self.runtime / "game.zip").write_bytes(b"modified runtime")
        with self.assertRaisesRegex(ValueError, "differs"):
            self.export()
        with self.assertRaisesRegex(ValueError, "differs"):
            self.stage()

    def test_modified_service_worker_is_rejected_after_export(self):
        metadata = self.export()
        self.assertEqual(metadata["serviceWorkerSha256"], hashlib.sha256((self.runtime / "service-worker.js").read_bytes()).hexdigest())
        (self.runtime / "service-worker.js").write_bytes(b"modified service worker")
        with self.assertRaisesRegex(ValueError, "service-worker.js differs"):
            self.stage()

    def test_stale_commit_and_missing_runtime_are_rejected(self):
        self.export()
        with self.assertRaisesRegex(ValueError, "this OS source commit"):
            self.stage(expected_sha="a" * 40)
        (self.runtime / "renpy.wasm").unlink()
        with self.assertRaisesRegex(ValueError, "Missing required"):
            self.stage()

    def test_stale_workflow_run_or_attempt_is_rejected(self):
        self.export()
        with self.assertRaisesRegex(ValueError, "different workflow run or attempt"):
            self.stage(run_id="54321")
        with self.assertRaisesRegex(ValueError, "different workflow run or attempt"):
            self.stage(run_attempt="3")

    def test_build_report_must_belong_to_expected_run_attempt(self):
        self.report["buildId"] = "ci-12345-3"
        self.write_report()
        with self.assertRaisesRegex(ValueError, "build ID does not match"):
            self.export()
        self.assertFalse((self.runtime / MODULE.METADATA_NAME).exists())

    def test_invalid_run_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "positive GitHub run ID"):
            MODULE.export_metadata(self.report_path, self.runtime, SHA, "not-a-run", RUN_ATTEMPT)
        with self.assertRaisesRegex(ValueError, "positive GitHub run attempt"):
            MODULE.export_metadata(self.report_path, self.runtime, SHA, RUN_ID, "0")


class PostDeployProvenanceTests(unittest.TestCase):
    def verify(
        self,
        *,
        deployment_attempt=RUN_ATTEMPT,
        runtime_attempt=RUN_ATTEMPT,
        published_sha=ZIP_SHA,
        published_service_worker_sha=SERVICE_WORKER_SHA,
        timeout=1.0,
    ):
        deployment = {"sha": SHA, "runId": RUN_ID, "runAttempt": deployment_attempt, "ref": "refs/heads/main"}
        runtime = {
            "sourceSha": SHA,
            "runId": RUN_ID,
            "runAttempt": runtime_attempt,
            "buildId": f"ci-{RUN_ID}-{runtime_attempt}",
            "gameZipBytes": len(ZIP_BYTES),
            "gameZipSha256": ZIP_SHA,
            "serviceWorkerSha256": SERVICE_WORKER_SHA,
        }

        def fake_fetch_json(url, _timeout):
            if url.endswith("deployment-info.json"):
                return 200, deployment, None
            return 200, runtime, None

        def fake_fetch_sha256(url, _timeout):
            if url.endswith("game.zip"):
                return 200, len(ZIP_BYTES), published_sha, None
            return 200, len(SERVICE_WORKER_BYTES), published_service_worker_sha, None

        with patch.object(SMOKE, "fetch_json", side_effect=fake_fetch_json), patch.object(
            SMOKE, "fetch_sha256", side_effect=fake_fetch_sha256
        ):
            return SMOKE.verify_deployment("https://example.test/", SHA, RUN_ID, RUN_ATTEMPT, timeout, 0.001)

    def test_exact_run_and_public_zip_digest_are_required(self):
        result = self.verify()
        self.assertTrue(result["verified"], result["error"])
        self.assertTrue(result["runtimeZipMatchesMetadata"])
        self.assertTrue(result["runtimeServiceWorkerMatchesMetadata"])
        self.assertEqual(result["runtimeMetadata"]["runAttempt"], RUN_ATTEMPT)

    def test_other_deployment_attempt_is_rejected(self):
        result = self.verify(deployment_attempt="3", timeout=0.002)
        self.assertFalse(result["verified"])
        self.assertIn("runId/runAttempt", result["error"])

    def test_other_runtime_attempt_is_rejected(self):
        result = self.verify(runtime_attempt="3", timeout=0.002)
        self.assertFalse(result["verified"])
        self.assertIn("runId/runAttempt/buildId", result["error"])

    def test_stale_or_corrupt_published_zip_is_rejected(self):
        result = self.verify(published_sha="0" * 64, timeout=0.002)
        self.assertFalse(result["verified"])
        self.assertFalse(result["runtimeZipMatchesMetadata"])
        self.assertIn("SHA-256", result["error"])

    def test_mismatched_published_service_worker_is_rejected(self):
        result = self.verify(published_service_worker_sha="0" * 64, timeout=0.002)
        self.assertFalse(result["verified"])
        self.assertFalse(result["runtimeServiceWorkerMatchesMetadata"])
        self.assertIn("service-worker.js SHA-256", result["error"])


class RenpyWorkflowContractTests(unittest.TestCase):
    def test_service_worker_precaches_the_engine_and_invalidates_by_content_stamp(self):
        root = ROOT / "integrations/renpy-technosutra"
        worker_source = (root / "web/service-worker.js").read_bytes()
        self.assertEqual(worker_source, (ROOT / "public/technosutra-vn/service-worker.js").read_bytes())
        worker_text = worker_source.decode("utf-8")
        # The engine and start-up payload are precached, and the placeholder is
        # replaced at build time by a hash of every shipped byte, so returning
        # visitors keep the engine but never keep it past a deploy.
        self.assertIn("var CACHE_VERSION = '__STEM_CACHE_VERSION__';", worker_text)
        for required in ("renpy.wasm", "renpy.data", "game.zip", "web-presplash.jpg", "PRECACHE"):
            self.assertIn(required, worker_text)
        self.assertIn("cacheFirst", worker_text)
        self.assertIn("networkFirst", worker_text)
        self.assertIn("if (request.headers.has('range')) return;", worker_text)
        self.assertNotIn("addToCache", worker_text)

        build_script = (root / "build_web.sh").read_text(encoding="utf-8")
        validator = (root / "tools/validate_web_candidate.py").read_text(encoding="utf-8")
        smoke = (root / "tools/smoke_web_build.py").read_text(encoding="utf-8")
        stamper = (root / "tools/stamp_service_worker.py").read_text(encoding="utf-8")
        self.assertIn('cp "$ROOT/web/service-worker.js" "$PROJECT/web/service-worker.js"', build_script)
        self.assertIn('cp "$PROJECT/web/service-worker.js" "$WEB_DIR/service-worker.js"', build_script)
        self.assertIn('python3 "$PROJECT/tools/stamp_service_worker.py" "$WEB_DIR"', build_script)
        self.assertIn("__STEM_CACHE_VERSION__", validator)
        self.assertIn("__STEM_CACHE_VERSION__", smoke)
        self.assertIn("CACHE_VERSION", stamper)

    def test_only_checksum_pinned_official_downloads_and_playwright_browsers_are_cached(self):
        workflow = (ROOT / ".github/workflows/renpy-ci.yml").read_text(encoding="utf-8")
        installer = (ROOT / "integrations/renpy-technosutra/tools/install_renpy_sdk.sh").read_text(encoding="utf-8")
        download_cache = workflow.index("id: renpy-download-cache")
        browser_cache = workflow.index("id: playwright-browser-cache")
        install = workflow.index("- name: Install official Ren'Py 8.5.3 SDK and Web support")
        build = workflow.index("- name: Build and smoke-test Ren'Py Web candidate")
        self.assertLess(browser_cache, download_cache)
        self.assertLess(download_cache, install)
        self.assertLess(install, build)
        self.assertIn("uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0", workflow)
        self.assertIn(
            "key: renpy-downloads-${{ runner.os }}-8.5.3-sdk-eb0a9be7f0fb13632fe25ceade9a8bed5a1b4d6b6e83bd19eeeb29e1a1bb4a45-web-954db897e65f51ea63cb2fb7b203d02be0447f4e22069514020bbe6c6691fdfc",
            workflow,
        )
        self.assertIn("path: ${{ runner.temp }}/renpy-downloads", workflow)
        self.assertIn("RENPY_DOWNLOAD_CACHE: ${{ runner.temp }}/renpy-downloads", workflow)
        self.assertIn("key: playwright-${{ runner.os }}-chromium-1.62.0", workflow)
        self.assertIn("path: ~/.cache/ms-playwright", workflow)
        self.assertIn('if [[ -f "$cached" ]]; then', installer)
        self.assertIn('verify_sha256 "$expected" "$cached"', installer)
        self.assertIn('verify_sha256 "$expected" "$destination"', installer)
        self.assertIn('tar -xjf "$TEMP/renpy-sdk.tar.bz2" -C "$TEMP/extract"', installer)
        self.assertIn('unzip -q "$TEMP/renpy-web.zip" -d "$TEMP/web-extract"', installer)
        self.assertNotIn("path: ${{ runner.temp }}/renpy-8.5.3-sdk", workflow)
        self.assertIn("RENPY_SDK: ${{ runner.temp }}/renpy-8.5.3-sdk", workflow)

    def test_complete_engine_runtime_is_smoke_tested_and_exported_to_the_app_bundle(self):
        expected = {"index.html", "game.zip", "renpy-pre.js", "renpy.js", "renpy.wasm", "renpy.data", "service-worker.js"}
        self.assertTrue(expected.issubset(set(MODULE.RUNTIME_FILES)))

        build_script = (ROOT / "integrations/renpy-technosutra/build_web.sh").read_text(encoding="utf-8")
        smoke_script = (ROOT / "integrations/renpy-technosutra/tools/smoke_web_build.py").read_text(encoding="utf-8")
        ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/renpy-ci.yml").read_text(encoding="utf-8")

        self.assertIn("for required in index.html game.zip renpy-pre.js renpy.js renpy.wasm renpy.data service-worker.js; do", build_script)
        self.assertIn('cp -a "$WEB_DIR"/. "$OUTPUT"/', build_script)
        self.assertIn("progressive_assets", smoke_script)
        self.assertIn("name: renpy-web-runtime", workflow)
        self.assertIn("path: integrations/renpy-technosutra/build/local/${{ env.BUILD_ID }}/output/", workflow)
        self.assertIn("name: renpy-web-runtime", ci)
        self.assertIn("path: public/technosutra-vn/", ci)
        self.assertIn("run: npm run build:wasm:frontend", ci)


class LoadingOverlayContractTests(unittest.TestCase):
    root = ROOT / "integrations/renpy-technosutra"

    def test_overlay_uses_the_converted_webp_art_and_keeps_the_blur_up(self):
        loading = self.root / "web/loading"
        css = (loading / "loading.css").read_text(encoding="utf-8")
        script = (loading / "loading.js").read_text(encoding="utf-8")
        art = json.loads((loading / "art.json").read_text(encoding="utf-8"))
        provenance = json.loads((loading / "provenance.json").read_text(encoding="utf-8"))
        self.assertEqual(art["art"], "02.webp")
        self.assertEqual(art["artSmall"], "02-small.webp")
        self.assertEqual(provenance["source"]["commit"], "b0f08869b385faf9934548f8bc978573dc3fc7b3")
        # The conversion is the whole point: the PNG must shrink by >95%.
        self.assertLess(provenance["art"]["bytes"] / provenance["source"]["pngBytes"], 0.05)
        self.assertLess(provenance["artSmall"]["bytes"], 20_000)
        self.assertIn("stem-loader-zoom", css)
        self.assertIn("prefers-reduced-motion", css)
        for phrase in ("Os Bodhisattvas estão se reunindo", "Os budas já chegaram"):
            self.assertIn(phrase, script)
        # A loader that can never dismiss itself is worse than no loader.
        self.assertIn("MAXIMUM_WAIT", script)

    def test_build_injects_the_overlay_before_stamping_the_cache(self):
        build = (self.root / "build_web.sh").read_text(encoding="utf-8")
        inject = build.index('tools/inject_loading_overlay.py" "$WEB_DIR"')
        stamp = build.index('tools/stamp_service_worker.py" "$WEB_DIR"')
        self.assertLess(inject, stamp)
        self.assertIn('cp "$ROOT/web/loading/02.jpg" "$PROJECT/game/images/title/bg_title.jpg"', build)
        worker = (self.root / "web/service-worker.js").read_text(encoding="utf-8")
        for precached in ("loading/loading.css", "loading/loading.js", "loading/02.webp"):
            self.assertIn(precached, worker)

    def test_pixel_ui_frames_are_committed_and_used_by_the_title_screen(self):
        manifest = json.loads((self.root / "game/images/pixel/manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["count"], 24)
        for asset in manifest["assets"]:
            path = self.root / "game/images/pixel" / asset["file"]
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), asset["sha256"])
        screens = (self.root / "game/screens.rpy").read_text(encoding="utf-8")
        for frame in ("pixel_panel", "pixel_button", "pixel_button_hover", "pixel_start", "pixel_start_hover"):
            self.assertIn(f"images/pixel/{frame}.png", screens)
        self.assertIn('action Start() style "stem_start_button"', screens)
        self.assertIn('add "bg_stem_title"', screens)


if __name__ == "__main__":
    unittest.main()
