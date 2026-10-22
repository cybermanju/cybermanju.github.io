#!/usr/bin/env python3
# CyberManju OS — executable HOME lifecycle regressions.
# Role: Run the generated MainActivity on JVM with deterministic Android stubs.
# Integrates: android-home-activity.py, cached Gradle Kotlin compiler or KOTLIN_COMPILER_CLASSPATH.
# Contracts: Tests callback ordering, not real Android rendering or device behavior.
import glob
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def compiler_classpath():
    explicit = os.environ.get('KOTLIN_COMPILER_CLASSPATH')
    if explicit:
        return explicit
    for home in (Path.home() / '.gradle/wrapper/dists',):
        for compiler in sorted(home.glob('**/lib/kotlin-compiler-embeddable-*.jar'), reverse=True):
            return os.pathsep.join(glob.glob(str(compiler.parent / '*.jar')))
    return None


SOURCES = {
    'Intent.kt': '''package android.content
class Intent(val action: String? = null, private val home: Boolean = false) {
    fun hasCategory(category: String) = home && category == CATEGORY_HOME
    companion object { const val ACTION_MAIN = "main"; const val CATEGORY_HOME = "home" }
}
''',
    'Handler.kt': '''package android.os
class Looper { companion object { fun getMainLooper() = Looper() } }
class Handler(looper: Looper) {
    companion object {
        val queue = mutableListOf<Pair<Runnable, Long>>()
        fun step() { check(queue.isNotEmpty()) { "no scheduled delivery" }; queue.removeAt(0).first.run() }
    }
    fun removeCallbacks(runnable: Runnable) { queue.removeAll { it.first === runnable } }
    fun post(runnable: Runnable): Boolean { queue.add(runnable to 0L); return true }
    fun postDelayed(runnable: Runnable, delay: Long): Boolean { queue.add(runnable to delay); return true }
}
''',
    'WebView.kt': '''package android.webkit
class WebView {
    val callbacks = mutableListOf<(String) -> Unit>()
    var evaluations = 0
    fun requestLayout() {}
    fun invalidate() {}
    fun evaluateJavascript(script: String, callback: (String) -> Unit) { evaluations++; callbacks.add(callback) }
    fun reply(result: String) { check(callbacks.isNotEmpty()); callbacks.removeAt(0)(result) }
}
''',
    'CybermanjuHomeRole.kt': '''package com.cybermanju.os
object CybermanjuHomeRole {
    val events = mutableListOf<String>()
    @JvmStatic fun onWebViewCreated(activity: Any, webView: android.webkit.WebView) { events.add("webview") }
    @JvmStatic fun onResume(activity: Any, webView: android.webkit.WebView?) { events.add("resume") }
    @JvmStatic fun onPause(activity: Any) { events.add("pause") }
    @JvmStatic fun onDestroy(activity: Any) { events.add("destroy") }
}
''',
    'TauriActivity.kt': '''package app.tauri
open class TauriActivity {
    private var currentIntent = android.content.Intent()
    val intent get() = currentIntent
    var isFinishing = false
    var isDestroyed = false
    fun setIntent(value: android.content.Intent) { currentIntent = value }
    open fun onWebViewCreate(view: android.webkit.WebView) {}
    open fun onNewIntent(value: android.content.Intent) {}
    open fun onResume() {}
    open fun onPause() {}
    open fun onDestroy() { isDestroyed = true }
    open fun onWindowFocusChanged(focus: Boolean) {}
}
''',
    'Regressions.kt': '''package regression
import android.content.Intent
import android.os.Handler
import android.webkit.WebView
import com.cybermanju.os.MainActivity
import com.cybermanju.os.CybermanjuHomeRole

fun home() = Intent(Intent.ACTION_MAIN, true)
fun setup(): Pair<MainActivity, WebView> {
    Handler.queue.clear()
    val activity = MainActivity()
    val view = WebView()
    activity.onWebViewCreate(view)
    activity.onResume()
    activity.onNewIntent(home())
    Handler.step()
    return activity to view
}
fun main(args: Array<String>) {
    when (args.single()) {
        "stale-ack" -> {
            val (activity, view) = setup()
            activity.onNewIntent(home())
            view.reply("true") // acknowledgement belongs to the previous HOME
            Handler.step()
            check(view.evaluations == 2) { "old acknowledgement consumed the new HOME" }
        }
        "stale-retry" -> {
            val (activity, view) = setup()
            activity.onPause()
            activity.onResume()
            Handler.step()
            view.reply("false") // callback from the previous resumed session
            check(Handler.queue.isEmpty()) { "stale callback scheduled a parallel retry" }
            view.reply("true")
            check(Handler.queue.isEmpty())
        }
        "single-flight" -> {
            val (activity, view) = setup()
            repeat(5) { activity.onWindowFocusChanged(true) }
            check(Handler.queue.isEmpty()) { "focus started a second JS evaluation before acknowledgement" }
            view.reply("false")
            check(Handler.queue.size == 1)
        }
        "slow-bootstrap" -> {
            val (_, view) = setup()
            repeat(130) { view.reply("false"); Handler.step() }
            view.reply("false")
            check(Handler.queue.single().second == 1000L) { "slow startup must back off to 1Hz" }
            Handler.step()
            view.reply("true")
            check(Handler.queue.isEmpty())
        }
        "pause-destroy" -> {
            val (activity, view) = setup()
            activity.onPause()
            view.reply("false")
            check(Handler.queue.isEmpty())
            activity.onResume()
            Handler.step()
            activity.onDestroy()
            view.reply("false")
            check(Handler.queue.isEmpty())
        }
        "ordinary-intent" -> {
            Handler.queue.clear()
            val activity = MainActivity()
            val view = WebView()
            activity.onWebViewCreate(view)
            activity.onResume()
            activity.onNewIntent(Intent("view"))
            activity.onWindowFocusChanged(true)
            check(Handler.queue.isEmpty())
            check(view.evaluations == 0) { "ordinary OAuth/file intent triggered HOME" }
        }
        "cold-home" -> {
            Handler.queue.clear()
            val activity = MainActivity()
            activity.setIntent(home())
            val view = WebView()
            activity.onWebViewCreate(view)
            check(Handler.queue.isEmpty()) { "cold HOME ran before resume" }
            activity.onResume()
            Handler.step()
            view.reply("true")
            activity.onWindowFocusChanged(true)
            check(Handler.queue.isEmpty()) { "acknowledged HOME must not repeat on focus" }
        }
        "replacement-view" -> {
            val (activity, oldView) = setup()
            val newView = WebView()
            activity.onWebViewCreate(newView)
            oldView.reply("true")
            Handler.step()
            check(newView.evaluations == 1) { "old WebView consumed replacement delivery" }
        }
        "native-role-hooks" -> {
            Handler.queue.clear()
            CybermanjuHomeRole.events.clear()
            val activity = MainActivity()
            activity.onWebViewCreate(WebView())
            activity.onResume()
            activity.onPause()
            activity.onResume()
            activity.onDestroy()
            check(CybermanjuHomeRole.events == listOf("webview", "resume", "pause", "resume", "destroy")) {
                "HOME-role lifecycle hooks must run once in Activity order: ${CybermanjuHomeRole.events}"
            }
        }
        else -> error("unknown case")
    }
    println("PASS " + args.single())
}
''',
}


class HomeLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.compiler = compiler_classpath()
        if not cls.compiler:
            if os.environ.get('REQUIRE_KOTLIN_COMPILER') == '1':
                raise RuntimeError('Kotlin compiler required but absent; set KOTLIN_COMPILER_CLASSPATH')
            raise unittest.SkipTest('cached Kotlin compiler absent; set KOTLIN_COMPILER_CLASSPATH')
        cls.temp = tempfile.TemporaryDirectory(prefix='cybermanju-home-jvm-')
        cls.directory = Path(cls.temp.name)
        cls.addClassCleanup(cls.temp.cleanup)
        for name, content in SOURCES.items():
            (cls.directory / name).write_text(content)
        main = cls.directory / 'MainActivity.kt'
        main.write_text('package com.cybermanju.os\nimport app.tauri.TauriActivity\nclass MainActivity : TauriActivity() {\n}\n')
        subprocess.run(['python3', str(ROOT / 'scripts/android-home-activity.py'), str(main)], check=True, capture_output=True)
        first_generated = main.read_bytes()
        subprocess.run(['python3', str(ROOT / 'scripts/android-home-activity.py'), str(main)], check=True, capture_output=True)
        if main.read_bytes() != first_generated:
            raise AssertionError('android-home-activity.py must be byte-stable on repeated configuration')
        generated = main.read_text()
        for hook in (
            'CybermanjuHomeRole.onWebViewCreated(this, webView)',
            'CybermanjuHomeRole.onResume(this, homeWebView)',
            'CybermanjuHomeRole.onPause(this)',
            'CybermanjuHomeRole.onDestroy(this)',
        ):
            if generated.count(hook) != 1:
                raise AssertionError(f'expected exactly one generated hook: {hook}')
        cls.classes = cls.directory / 'classes'
        result = subprocess.run([
            'java', '-cp', cls.compiler, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
            '-no-stdlib', '-no-reflect', '-classpath', cls.compiler, '-d', str(cls.classes),
            *map(str, cls.directory.glob('*.kt')),
        ], capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)

    def run_case(self, name):
        result = subprocess.run(['java', '-cp', str(self.classes) + os.pathsep + self.compiler,
                                 'regression.RegressionsKt', name], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS ' + name, result.stdout)

    def test_stale_ack_does_not_consume_new_home(self):
        self.run_case('stale-ack')

    def test_stale_retry_does_not_cross_resume(self):
        self.run_case('stale-retry')

    def test_focus_does_not_duplicate_inflight_delivery(self):
        self.run_case('single-flight')

    def test_slow_bootstrap_keeps_pending_home(self):
        self.run_case('slow-bootstrap')

    def test_pause_destroy_cancel_delivery(self):
        self.run_case('pause-destroy')

    def test_ordinary_intent_is_not_home(self):
        self.run_case('ordinary-intent')

    def test_cold_home_waits_for_resume_and_stops_after_ack(self):
        self.run_case('cold-home')

    def test_replaced_webview_rejects_old_ack(self):
        self.run_case('replacement-view')

    def test_native_home_role_hooks_follow_activity_lifecycle_once(self):
        self.run_case('native-role-hooks')


if __name__ == '__main__':
    unittest.main(verbosity=2)
