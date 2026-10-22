#!/usr/bin/env python3
# CyberManju OS — Android Home-role installer regressions (tests/python/test_android_home_role_installer.py).
# Role: verify generated Kotlin/manifest/Gradle integration is safe and idempotent.
# Exports: unittest suite for scripts/android-home-role.py.
# Integrates: android-home-activity.py, generated Tauri Android project layout.
# Contracts: preserve existing HOME intent filter and callbacks; add only narrow HOME visibility.
import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
INSTALL = ROOT / "scripts/android-home-role.py"
HOME_ACTIVITY = ROOT / "scripts/android-home-activity.py"
ANDROID = "{http://schemas.android.com/apk/res/android}"

spec = importlib.util.spec_from_file_location("android_home_role_installer", INSTALL)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class HomeRoleInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cybermanju-home-role-installer-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / "gen/android"
        self.main = self.base / "app/src/main"
        self.activity = self.main / "java/com/cybermanju/os/MainActivity.kt"
        self.activity.parent.mkdir(parents=True)
        self.activity.write_text(
            "package com.cybermanju.os\nimport app.tauri.TauriActivity\n"
            "class MainActivity : TauriActivity() {\n}\n",
            encoding="utf-8",
        )
        self.manifest = self.main / "AndroidManifest.xml"
        self.manifest.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.cybermanju.os">'
            '<queries><intent><action android:name="android.intent.action.MAIN" />'
            '<category android:name="android.intent.category.LAUNCHER" /></intent></queries>'
            '<application><activity android:name=".MainActivity" android:exported="true">'
            '<intent-filter><action android:name="android.intent.action.MAIN" />'
            '<category android:name="android.intent.category.LAUNCHER" /></intent-filter>'
            '<intent-filter><action android:name="android.intent.action.MAIN" />'
            '<category android:name="android.intent.category.HOME" />'
            '<category android:name="android.intent.category.DEFAULT" /></intent-filter>'
            '</activity></application></manifest>',
            encoding="utf-8",
        )
        (self.base / "app").mkdir(parents=True, exist_ok=True)
        (self.base / "app/build.gradle.kts").write_text(
            'android { buildTypes { getByName("release") { isMinifyEnabled = true } } }\n',
            encoding="utf-8",
        )
        import subprocess
        subprocess.run(["python3", str(HOME_ACTIVITY), str(self.activity)], check=True, capture_output=True)

    def snapshot(self):
        return {path.relative_to(self.base).as_posix(): path.read_bytes()
                for path in self.base.rglob("*") if path.is_file()}

    def test_installer_is_idempotent_and_only_adds_home_query(self):
        installer.install(self.base)
        first = self.snapshot()
        installer.install(self.base)
        self.assertEqual(first, self.snapshot())

        tree = ET.parse(self.manifest)
        root = tree.getroot()
        queries = root.find("queries")
        home_queries = [intent for intent in queries.findall("intent")
                        if any(a.get(ANDROID + "name") == "android.intent.action.MAIN" for a in intent.findall("action"))
                        and any(c.get(ANDROID + "name") == "android.intent.category.HOME" for c in intent.findall("category"))]
        self.assertEqual(len(home_queries), 1)
        query_actions = [a.get(ANDROID + "name") for intent in queries.findall("intent") for a in intent.findall("action")]
        self.assertEqual(query_actions.count("android.settings.HOME_SETTINGS"), 1)
        self.assertEqual(query_actions.count("android.settings.MANAGE_DEFAULT_APPS_SETTINGS"), 1)
        self.assertFalse(any(p.get(ANDROID + "name") == "android.permission.QUERY_ALL_PACKAGES"
                             for p in root.findall("uses-permission")))
        activity = root.find("application/activity")
        filters = activity.findall("intent-filter")
        self.assertEqual(len(filters), 2)
        self.assertTrue(any(any(c.get(ANDROID + "name") == "android.intent.category.HOME"
                                for c in f.findall("category")) for f in filters))

        kotlin = (self.activity.parent / "CybermanjuHomeRole.kt").read_text(encoding="utf-8")
        self.assertIn("package com.cybermanju.os", kotlin)
        self.assertNotIn("__PACKAGE__", kotlin)
        gradle = (self.base / "app/build.gradle.kts").read_text(encoding="utf-8")
        self.assertEqual(gradle.count('proguardFiles("cybermanju-home-role.pro")'), 1)
        rules = (self.base / "app/cybermanju-home-role.pro").read_text(encoding="utf-8")
        self.assertEqual(rules.count(".CybermanjuHomeRole"), 1)

    def test_refuses_activity_without_exact_lifecycle_hooks_before_writing(self):
        self.activity.write_text("package com.cybermanju.os\nclass MainActivity\n", encoding="utf-8")
        before = self.snapshot()
        with self.assertRaises(SystemExit):
            installer.install(self.base)
        self.assertEqual(before, self.snapshot())


if __name__ == "__main__":
    unittest.main(verbosity=2)
