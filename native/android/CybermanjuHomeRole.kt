// CyberManju OS — explicit Android default Home role bridge (native/android/CybermanjuHomeRole.kt).
// Role: observe/request the Android HOME role only from the visible bundled UI; never assign it silently.
// Exports: dispatch, onWebViewCreated, onResume, onPause, onDestroy.
// Integrates: RoleManager API 29+, official HOME settings intents API 24–28, generated MainActivity.
// Contracts: state is re-read after return; requestId is correlation only; callbacks for widgets/plugins stay untouched.
package __PACKAGE__

import android.app.Activity
import android.app.KeyguardManager
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.WebView
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.WeakHashMap
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

private class HomeRoleFailure(val publicMessage: String) : RuntimeException(publicMessage)

class CybermanjuHomeRole private constructor() {
    companion object {
        private const val PREFS = "cybermanju.home.role.v1"
        private const val PENDING_ID = "pendingRequestId"
        private const val LEFT_FOR_SYSTEM = "leftForSystem"
        private const val REQUEST_CODE = 60_001 // outside CyberManjuWidgets' 20,001..60,000 range
        private const val MAX_PAYLOAD_BYTES = 4_096
        private const val READY_FLAG = "__CYBERMANJU_HOME_ROLE_READY__"
        private const val EVENT_NAME = "cybermanju:home-role-result"

        private val main = Handler(Looper.getMainLooper())
        private val sessions = WeakHashMap<Activity, Session>()

        private class Session(activity: Activity) {
            val activity = WeakReference(activity)
            var webView: WeakReference<WebView>? = null
            var resumed = false
            var generation = 0L
            var attempts = 0
            var inFlight = false
            val handler = Handler(Looper.getMainLooper())
            val delivery = object : Runnable {
                override fun run() { deliver(this@Session) }
            }
        }

        private fun session(activity: Activity): Session {
            val current = sessions[activity]
            if (current != null && current.activity.get() === activity) return current
            return Session(activity).also { sessions[activity] = it }
        }

        /** Called from the Rust blocking worker; all Android/UI work is marshalled to the main thread. */
        @JvmStatic fun dispatch(activity: Activity, action: String, payload: String): String {
            val task = FutureTask<String> { handle(activity, action, payload) }
            if (Looper.myLooper() == Looper.getMainLooper()) task.run()
            else if (!main.post(task)) return failure("unavailable: Android UI thread is unavailable")
            return try {
                task.get(4, TimeUnit.SECONDS)
            } catch (_: Exception) {
                task.cancel(false)
                failure("conflict: Android UI is busy; check Home status before retrying")
            }
        }

        private fun handle(activity: Activity, action: String, payload: String): String = try {
            homeRequire(action == "status" || action == "request") { "unsupported: unknown Home role action" }
            homeRequire(payload.toByteArray(Charsets.UTF_8).size <= MAX_PAYLOAD_BYTES) {
                "invalid: Home role payload is too large"
            }
            val input = JSONObject(payload)
            homeRequire(
                if (action == "status") input.length() == 0
                else input.length() == 1 && input.has("requestId")
            ) { "invalid: unexpected Home role payload fields" }
            val output = when (action) {
                "status" -> status(activity)
                "request" -> request(activity, input)
                else -> homeFail("unsupported: unknown Home role action")
            }
            output.toString()
        } catch (e: HomeRoleFailure) {
            failure(e.publicMessage)
        } catch (_: Exception) {
            failure("unavailable: Android Home role operation failed")
        }

        private fun status(activity: Activity): JSONObject {
            val out = observe(activity)
            val pendingId = prefs(activity).getString(PENDING_ID, null)
            if (pendingId != null) out.put("pendingRequestId", pendingId)
            // The UI queries status only after registering the DOM listener and setting READY_FLAG.
            // Use that handshake to resume a pending delivery without an unbounded foreground poll.
            session(activity).attempts = 0
            scheduleDelivery(session(activity))
            return out
        }

        private fun observe(activity: Activity): JSONObject {
            val api = Build.VERSION.SDK_INT
            val state = try {
                when {
                    api >= Build.VERSION_CODES.Q -> {
                        val manager = activity.getSystemService(RoleManager::class.java)
                            ?: return result("unavailable", api)
                        if (!manager.isRoleAvailable(RoleManager.ROLE_HOME)) "unavailable"
                        else if (manager.isRoleHeld(RoleManager.ROLE_HOME)) "held" else "not_held"
                    }
                    api >= Build.VERSION_CODES.N -> {
                        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        val resolved = activity.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
                            ?: return result("unavailable", api)
                        val info = resolved.activityInfo ?: return result("unavailable", api)
                        val packageName = info.packageName ?: return result("unavailable", api)
                        if (packageName == activity.packageName) "held"
                        else if (info.name?.contains("ResolverActivity", ignoreCase = true) == true &&
                            packageName !in setOf("android", "com.android.internal.app")) "unavailable"
                        else "not_held"
                    }
                    else -> "unavailable"
                }
            } catch (_: Exception) {
                "unavailable"
            }
            return result(state, api)
        }

        private fun result(state: String, api: Int) = JSONObject()
            .put("state", state)
            .put("apiLevel", api)

        private fun request(activity: Activity, input: JSONObject): JSONObject {
            requireForegroundUnlocked(activity)
            val id = input.optString("requestId", "")
            homeRequire(isCanonicalUuid(id)) { "invalid: canonical requestId required" }

            val prefs = prefs(activity)
            val existing = prefs.getString(PENDING_ID, null)
            if (existing != null) {
                homeRequire(existing == id) { "conflict: another Home role request is already pending" }
                return JSONObject().put("state", "pending").put("requestId", existing)
            }

            val current = observe(activity).getString("state")
            if (current == "held") return JSONObject().put("state", "held")
            if (current == "unavailable") return JSONObject().put("state", "unavailable")

            val api = Build.VERSION.SDK_INT
            val manager = if (api >= Build.VERSION_CODES.Q) activity.getSystemService(RoleManager::class.java) else null
            if (api >= Build.VERSION_CODES.Q && (manager == null || !manager.isRoleAvailable(RoleManager.ROLE_HOME))) {
                return JSONObject().put("state", "unavailable")
            }
            if (api < Build.VERSION_CODES.N) return JSONObject().put("state", "unavailable")

            if (!prefs.edit().putString(PENDING_ID, id).putBoolean(LEFT_FOR_SYSTEM, false).commit()) {
                return JSONObject().put("state", "failed")
            }
            try {
                if (api >= Build.VERSION_CODES.Q) {
                    val intent = manager!!.createRequestRoleIntent(RoleManager.ROLE_HOME)
                    activity.startActivityForResult(intent, REQUEST_CODE)
                } else {
                    openLegacyHomeSettings(activity)
                }
            } catch (e: HomeRoleFailure) {
                clearPending(activity, id)
                return JSONObject().put("state", if (e.publicMessage.startsWith("unavailable:")) "unavailable" else "failed")
            } catch (_: Exception) {
                clearPending(activity, id)
                return JSONObject().put("state", "failed")
            }
            return JSONObject().put("state", "pending").put("requestId", id)
        }

        private fun openLegacyHomeSettings(activity: Activity) {
            val primary = Intent(android.provider.Settings.ACTION_HOME_SETTINGS)
            val fallback = Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
            try {
                // Try the HOME-specific action even when OEM package visibility gave a false negative.
                activity.startActivity(primary)
                return
            } catch (_: Exception) {
                // Some Android/OEM Settings apps omit the HOME-specific handler.
            }
            if (!resolves(activity, fallback)) {
                homeFail("unavailable: Android Home selection settings are unavailable")
            }
            try {
                activity.startActivity(fallback)
            } catch (_: Exception) {
                homeFail("failed: Android Home selection settings could not open")
            }
        }

        private fun resolves(activity: Activity, intent: Intent): Boolean = try {
            activity.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null
        } catch (_: Exception) {
            false
        }

        private fun requireForegroundUnlocked(activity: Activity) {
            homeRequire(!activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus()) {
                "auth: Home role request requires the foreground CyberManju window"
            }
            val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            homeRequire(keyguard != null && !keyguard.isKeyguardLocked) {
                "auth: unlock the device before choosing CyberManju as Home"
            }
            val current = session(activity)
            homeRequire(current.resumed) { "auth: Home role request requires a resumed Activity" }
        }

        private fun isCanonicalUuid(value: String): Boolean = try {
            value.length == 36 && UUID.fromString(value).toString() == value.lowercase()
        } catch (_: Exception) {
            false
        }

        @JvmStatic fun onWebViewCreated(activity: Activity, webView: WebView) {
            val current = session(activity)
            current.webView = WeakReference(webView)
            current.attempts = 0
            scheduleDelivery(current)
        }

        @JvmStatic fun onResume(activity: Activity, webView: WebView?) {
            val current = session(activity)
            current.resumed = true
            current.attempts = 0
            if (webView != null) current.webView = WeakReference(webView)
            scheduleDelivery(current)
        }

        @JvmStatic fun onPause(activity: Activity) {
            val current = session(activity)
            current.resumed = false
            current.generation++
            current.inFlight = false
            current.attempts = 0
            current.handler.removeCallbacks(current.delivery)
            val prefs = prefs(activity)
            if (prefs.getString(PENDING_ID, null) != null) {
                prefs.edit().putBoolean(LEFT_FOR_SYSTEM, true).commit()
            }
        }

        @JvmStatic fun onDestroy(activity: Activity) {
            sessions.remove(activity)?.let { current ->
                current.resumed = false
                current.generation++
                current.handler.removeCallbacks(current.delivery)
            }
        }

        private fun scheduleDelivery(current: Session) {
            val activity = current.activity.get() ?: return
            if (!current.resumed || current.inFlight) return
            val prefs = prefs(activity)
            if (prefs.getString(PENDING_ID, null) == null || !prefs.getBoolean(LEFT_FOR_SYSTEM, false)) return
            current.handler.removeCallbacks(current.delivery)
            current.handler.post(current.delivery)
        }

        private fun deliver(current: Session) {
            val activity = current.activity.get() ?: return
            val id = prefs(activity).getString(PENDING_ID, null) ?: return
            if (!current.resumed || !prefs(activity).getBoolean(LEFT_FOR_SYSTEM, false) || current.inFlight) return
            val webView = current.webView?.get()
            if (webView == null) {
                retry(current)
                return
            }
            val observed = observe(activity).getString("state")
            val outcomeState = if (observed in setOf("held", "not_held", "unavailable")) observed!! else "unavailable"
            val detail = JSONObject().put("requestId", id).put("state", outcomeState)
            val encoded = Base64.encodeToString(detail.toString().toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            val expectedId = Base64.encodeToString(id.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            val generation = current.generation
            current.inFlight = true
            webView.evaluateJavascript(
                "(function(){if(window.$READY_FLAG!==true)return false;" +
                    "window.__CYBERMANJU_HOME_ROLE_ACKED__=null;" +
                    "window.dispatchEvent(new CustomEvent('$EVENT_NAME',{detail:JSON.parse(atob('$encoded'))}));" +
                    "return window.__CYBERMANJU_HOME_ROLE_ACKED__===atob('$expectedId');})()"
            ) { delivered ->
                if (generation != current.generation || !current.resumed || current.webView?.get() !== webView) return@evaluateJavascript
                current.inFlight = false
                if (delivered == "true") {
                    clearPending(activity, id)
                    current.attempts = 0
                } else {
                    retry(current)
                }
            }
        }

        private fun retry(current: Session) {
            if (!current.resumed || current.inFlight || current.attempts >= 30) return
            current.attempts = (current.attempts + 1).coerceAtMost(30)
            val delay = when {
                current.attempts < 10 -> 100L
                current.attempts < 30 -> 250L
                else -> 1000L
            }
            current.handler.removeCallbacks(current.delivery)
            current.handler.postDelayed(current.delivery, delay)
        }

        private fun clearPending(activity: Activity, id: String) {
            val prefs = prefs(activity)
            if (prefs.getString(PENDING_ID, null) == id) {
                prefs.edit().remove(PENDING_ID).remove(LEFT_FOR_SYSTEM).commit()
            }
        }

        private fun prefs(activity: Activity) = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        private fun failure(message: String) = JSONObject().put("error", message).toString()
        private fun homeRequire(condition: Boolean, message: () -> String) { if (!condition) homeFail(message()) }
        private fun homeFail(message: String): Nothing = throw HomeRoleFailure(message)
    }
}
