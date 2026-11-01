#!/usr/bin/env python3
"""CyberManju OS — post-deploy smoke navigation regressions."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "post_deploy_smoke_navigation",
    ROOT / "integrations/renpy-technosutra/tools/post_deploy_smoke.py",
)
assert SPEC is not None and SPEC.loader is not None
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


class FakeLocator:
    def __init__(self, *, visible=True, click_error=None, attribute=None):
        self.visible = visible
        self.click_error = click_error
        self.attribute = attribute
        self.click_count = 0
        self.fill_values = []
        self.waits = []

    @property
    def first(self):
        return self

    def is_visible(self, **_kwargs):
        return self.visible

    def click(self, **_kwargs):
        self.click_count += 1
        if self.click_error:
            raise self.click_error

    def wait_for(self, **kwargs):
        self.waits.append(kwargs)

    def fill(self, value):
        self.fill_values.append(value)

    def filter(self, **_kwargs):
        return self

    def get_attribute(self, _name):
        return self.attribute


class FakeKeyboard:
    def __init__(self):
        self.presses = []

    def press(self, key):
        self.presses.append(key)


class FakePage:
    def __init__(self, *, shortcut_visible=True, click_error=None):
        self.keyboard = FakeKeyboard()
        self.shortcut = FakeLocator(visible=shortcut_visible, click_error=click_error)
        self.iframe = FakeLocator(attribute="https://example.test/technosutra-vn/index.html")
        self.frame = FakeLocator()
        self.window = FakeLocator()
        self.palette = FakeLocator()
        self.search = FakeLocator()
        self.result = FakeLocator()
        self.frames = [SimpleNamespace(url="https://example.test/technosutra-vn/index.html")]

    def locator(self, selector):
        return {
            "button[data-home-item='app:technosutra-novel']": self.shortcut,
            "iframe.ts-game-frame": self.iframe,
            ".app-window:has(iframe.ts-game-frame)": self.window,
            ".cp-item": self.result,
        }[selector]

    def get_by_role(self, role, *, name):
        return {
            ("dialog", "Command palette"): self.palette,
            ("textbox", "Search commands"): self.search,
        }[(role, name)]


class PostDeploySmokeNavigationTests(unittest.TestCase):
    def test_intercepted_shortcut_click_falls_back_to_command_palette(self):
        page = FakePage(click_error=TimeoutError("file-manager overlay intercepts pointer events"))
        report = {"checks": {}}

        SMOKE.open_stem_array(page, report)

        self.assertEqual(page.keyboard.presses, ["Control+k"])
        self.assertEqual(page.search.fill_values, ["Play The Stem Array"])
        self.assertEqual(page.result.click_count, 1)
        self.assertEqual(report["navigation"]["method"], "command palette")
        self.assertIn("overlay intercepts pointer events", report["navigationFallbackReason"])
        self.assertTrue(report["checks"]["gameWindowOpened"])
        self.assertTrue(report["checks"]["iframeLoaded"])

    def test_successful_shortcut_click_does_not_open_palette(self):
        page = FakePage()
        report = {"checks": {}}

        SMOKE.open_stem_array(page, report)

        self.assertEqual(page.shortcut.click_count, 1)
        self.assertEqual(page.keyboard.presses, [])
        self.assertEqual(report["navigation"]["method"], "desktop launcher app shortcut")
        self.assertNotIn("navigationFallbackReason", report)
        self.assertTrue(report["checks"]["gameWindowOpened"])

    def test_missing_shortcut_uses_command_palette(self):
        page = FakePage(shortcut_visible=False)
        report = {"checks": {}}

        SMOKE.open_stem_array(page, report)

        self.assertEqual(page.keyboard.presses, ["Control+k"])
        self.assertEqual(report["navigation"]["method"], "command palette")
        self.assertTrue(report["checks"]["iframeLoaded"])


if __name__ == "__main__":
    unittest.main()
