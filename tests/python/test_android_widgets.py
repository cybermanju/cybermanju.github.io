"""CyberManju widget installer contracts: generated sources, manifest and callbacks."""
import importlib.util
import subprocess
import tempfile
import unittest
from unittest import mock
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
INSTALL = ROOT / "scripts/android-widgets.py"
HOME = ROOT / "scripts/android-home-activity.py"
ANDROID = "{http://schemas.android.com/apk/res/android}"


class WidgetInstallerTests(unittest.TestCase):
    def fixture(self, base, source=None):
        main = base / "app/src/main"
        java = main / "java/example/home"
        java.mkdir(parents=True)
        activity = java / "MainActivity.kt"
        activity.write_text(source or "package example.home\nclass MainActivity : TauriActivity() {}\n")
        (main / "AndroidManifest.xml").write_text(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
            '<!-- CyberManju OS (scripts/android-configure.sh) -->'
            '<queries><package android:name="keep.this" /></queries>'
            '<application><activity android:name=".Other" android:exported="false" /></application></manifest>')
        (base / "app/build.gradle.kts").write_text('android { buildTypes { release { isMinifyEnabled = true } } }\n')
        return activity

    def run_install(self, base):
        return subprocess.run(["python3", str(INSTALL), str(base)], text=True, capture_output=True)

    def test_sources_r8_queries_comments_idempotence_and_no_exported_surface(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            activity = self.fixture(base)
            result = self.run_install(base)
            self.assertEqual(result.returncode, 0, result.stderr)
            native = activity.with_name("CybermanjuWidgets.kt").read_text()
            self.assertIn("package example.home", native)
            self.assertNotIn("__PACKAGE__", native)
            manifest = base / "app/src/main/AndroidManifest.xml"
            self.assertIn("CyberManju OS (scripts/android-configure.sh)", manifest.read_text())
            root = ET.parse(manifest).getroot()
            self.assertEqual(len(root.findall("queries")), 1)
            self.assertEqual(root.find("queries/package").get(ANDROID + "name"), "keep.this")
            self.assertEqual([p.get(ANDROID + "name") for p in root.findall("uses-permission")], ["android.permission.BIND_APPWIDGET"])
            self.assertEqual(root.find("queries/intent/action").get(ANDROID + "name"), "android.appwidget.action.APPWIDGET_UPDATE")
            self.assertEqual(len(root.findall("application/activity")), 1)
            self.assertIn('proguardFiles("cybermanju-widgets.pro")', (base / "app/build.gradle.kts").read_text())
            self.assertIn("public static java.lang.String dispatch", (base / "app/cybermanju-widgets.pro").read_text())
            snapshot = {p: p.read_bytes() for p in base.rglob("*") if p.is_file()}
            self.assertEqual(self.run_install(base).returncode, 0)
            self.assertEqual(snapshot, {p: p.read_bytes() for p in base.rglob("*") if p.is_file()})

    def test_home_lifecycle_and_tauri_result_forwarding_survive_both_install_orders(self):
        for widgets_first in (True, False):
            with self.subTest(widgets_first=widgets_first), tempfile.TemporaryDirectory() as temp:
                base = Path(temp)
                activity = self.fixture(base)
                for kind in (("widgets", "home") if widgets_first else ("home", "widgets")):
                    result = self.run_install(base) if kind == "widgets" else subprocess.run(
                        ["python3", str(HOME), str(activity)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                source = activity.read_text()
                self.assertEqual(source.count("override fun onActivityResult"), 1)
                self.assertIn("super.onActivityResult(requestCode, resultCode, data)", source)
                self.assertIn("CybermanjuWidgets.onActivityResult(this, requestCode, resultCode, data)", source)
                self.assertIn("override fun onNewIntent", source)
                self.assertIn("super.onWebViewCreate(webView)", source)

    def test_custom_results_and_partial_markers_fail_without_modification(self):
        for body in ("override fun onActivityResult(a: Int, b: Int, c: android.content.Intent?) {}", "// BEGIN CyberManju widget results"):
            with self.subTest(body=body), tempfile.TemporaryDirectory() as temp:
                base = Path(temp)
                self.fixture(base, "package example.home\nclass MainActivity : TauriActivity() {\n    " + body + "\n}\n")
                before = {p: p.read_bytes() for p in base.rglob("*") if p.is_file()}
                result = self.run_install(base)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("android-widgets:", result.stderr)
                self.assertEqual(before, {p: p.read_bytes() for p in base.rglob("*") if p.is_file()})


class KotlinCompilerDiscoveryTests(unittest.TestCase):
    """Filesystem-only discovery regressions; never invoke a native compiler."""

    def setUp(self):
        spec = importlib.util.spec_from_file_location(
            "widget_runtime_discovery", Path(__file__).with_name("test_android_widgets_runtime.py"))
        self.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runtime)
        temporary = tempfile.TemporaryDirectory(prefix="widget-compiler-discovery-")
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        for patcher in (
            mock.patch.dict(self.runtime.os.environ, {}, clear=True),
            mock.patch.object(self.runtime.Path, "home", return_value=self.home),
            mock.patch.object(self.runtime.subprocess, "run", side_effect=AssertionError("No compiler execution allowed")),
            mock.patch.object(self.runtime.urllib.request, "urlretrieve", side_effect=AssertionError("No downloads allowed")),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def library(self, distribution="bin", compiler=True):
        lib = self.home / f".gradle/wrapper/dists/gradle-9.0-{distribution}/fixture/gradle-9.0/lib"
        lib.mkdir(parents=True, exist_ok=True)
        (lib / "kotlin-stdlib-2.0.0.jar").touch()
        if compiler:
            (lib / "kotlin-compiler-embeddable-2.0.0.jar").touch()
        return lib

    def test_finds_gradle_bin_compiler(self):
        self.assertEqual(self.runtime.find_kotlin_lib(), None)
        lib = self.library("bin")
        self.assertEqual(self.runtime.find_kotlin_lib(), lib)

    def test_preserves_gradle_all_support(self):
        lib = self.library("all")
        self.assertEqual(self.runtime.find_kotlin_lib(), lib)

    def test_explicit_library_takes_precedence(self):
        self.library("all")
        explicit = self.home / "explicit"
        explicit.mkdir()
        (explicit / "kotlin-compiler-embeddable-2.0.0.jar").touch()
        self.runtime.os.environ["KOTLIN_LIB"] = str(explicit)
        self.assertEqual(self.runtime.find_kotlin_lib(), explicit)

    def test_invalid_override_falls_back_to_gradle_bin(self):
        self.runtime.os.environ["KOTLIN_LIB"] = str(self.home / "missing")
        lib = self.library("bin")
        self.assertEqual(self.runtime.find_kotlin_lib(), lib)

    def test_rejects_library_without_compiler_jar(self):
        self.library("all", compiler=False)
        self.assertIsNone(self.runtime.find_kotlin_lib())

    def test_absent_compiler_remains_unavailable(self):
        self.assertIsNone(self.runtime.find_kotlin_lib())


if __name__ == "__main__":
    unittest.main()
