#!/usr/bin/env python3
# CyberManju OS — Android HOME activity lifecycle (scripts/android-home-activity.py).
# Role: Extend generated MainActivity without replacing Tauri's initialization.
# Integrates: android-configure.sh, Wry onWebViewCreate, App.vue HOME listener.
# Contracts: Preserve plugin/deep-link callbacks; never reload or clear app data.
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
src = path.read_text()
begin = '    // BEGIN CyberManju HOME lifecycle'
end = '    // END CyberManju HOME lifecycle'
block = '''    // BEGIN CyberManju HOME lifecycle
    private var homeWebView: android.webkit.WebView? = null
    private var homePending = false
    private var homeAttempts = 0
    private var homeResumed = false
    private val homeHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val homeDelivery = Runnable { deliverHome() }

    private fun isHomeIntent(value: android.content.Intent?): Boolean =
        value?.action == android.content.Intent.ACTION_MAIN &&
            value.hasCategory(android.content.Intent.CATEGORY_HOME)

    override fun onWebViewCreate(webView: android.webkit.WebView) {
        super.onWebViewCreate(webView)
        homeWebView = webView
        homePending = homePending || isHomeIntent(intent)
        recoverHomeSurface()
    }

    override fun onNewIntent(intent: android.content.Intent) {
        // The framework forwards intents to Rust/plugins but does not update
        // Activity.getIntent(). Keep OAuth/file intents intact for that chain.
        setIntent(intent)
        super.onNewIntent(intent)
        if (isHomeIntent(intent)) {
            homePending = true
            homeAttempts = 0
            recoverHomeSurface()
        }
    }

    override fun onResume() {
        super.onResume()
        homeResumed = true
        homeAttempts = 0
        recoverHomeSurface()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) recoverHomeSurface()
    }

    private fun recoverHomeSurface() {
        homeWebView?.let { view ->
            view.requestLayout()
            view.invalidate()
        }
        homeHandler.removeCallbacks(homeDelivery)
        if (homePending) homeHandler.post(homeDelivery)
    }

    private fun deliverHome() {
        val view = homeWebView ?: return
        if (!homePending || !homeResumed || isFinishing || isDestroyed) return
        // Wait for Vue's listener, not an arbitrary page-load delay. Cold
        // HOME may arrive before navigation/JS starts; delivery is acknowledged.
        view.evaluateJavascript(
            "(function(){if(window.__CYBERMANJU_HOME_READY__!==true)return false;" +
                "window.dispatchEvent(new Event('cybermanju:android-home'));return true;})()"
        ) { delivered ->
            if (delivered == "true") {
                homePending = false
            } else if (homePending && homeResumed && homeAttempts++ < 100) {
                homeHandler.postDelayed(homeDelivery, 100L)
            }
        }
    }

    override fun onPause() {
        homeResumed = false
        homeHandler.removeCallbacks(homeDelivery)
        super.onPause()
    }

    override fun onDestroy() {
        homeResumed = false
        homeHandler.removeCallbacks(homeDelivery)
        homeWebView = null
        super.onDestroy()
    }
    // END CyberManju HOME lifecycle'''
if begin in src or end in src:
    if src.count(begin) != 1 or src.count(end) != 1 or src.index(begin) > src.index(end):
        sys.exit(f'{path}: incomplete HOME lifecycle marker; refusing to patch')
    src = re.sub(re.escape(begin) + r'.*?' + re.escape(end), lambda _: block, src, count=1, flags=re.S)
else:
    # An application-owned override needs a deliberate merge, not duplicate
    # methods or silently replaced custom behavior in a generated build.
    methods = ('onWebViewCreate', 'onNewIntent', 'onResume', 'onWindowFocusChanged', 'onPause', 'onDestroy')
    if any(re.search(r'override\s+fun\s+' + method + r'\s*\(', src) for method in methods):
        sys.exit(f'{path}: custom lifecycle override requires manual HOME merge')
    if not re.search(r'class\s+MainActivity\s*:\s*TauriActivity\s*\(\s*\)', src):
        sys.exit(f'{path}: unexpected MainActivity base; refusing to patch')
    closing = src.rfind('}')
    if closing < 0:
        sys.exit(f'{path}: MainActivity closing brace not found')
    src = src[:closing] + block + '\n' + src[closing:]
if src != path.read_text():
    path.write_text(src)
print(f'Android HOME lifecycle configured: {path}')
