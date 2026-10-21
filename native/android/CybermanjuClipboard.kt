// CyberManju OS — explicit Android clipboard bridge (native/android/CybermanjuClipboard.kt).
// Role: Perform foreground copy/cut/paste on the UI thread without observers or persistence.
// Exports: CybermanjuClipboard.dispatch(Activity, String, String): String via JNI.
// Contracts: Caller supplies a fresh user action; never log text or resolve clipboard URIs.
package __PACKAGE__

import android.app.Activity
import android.app.KeyguardManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import org.json.JSONObject
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

class CybermanjuClipboard {
    companion object {
        private const val MAX_BYTES = 65_536
        private const val ACTION_TTL_MS = 5_000L
        private val main = Handler(Looper.getMainLooper())

        @JvmStatic fun dispatch(activity: Activity, action: String, payload: String): String {
            if (Looper.myLooper() == Looper.getMainLooper()) return handle(activity, action, payload)
            val task = FutureTask<String> { handle(activity, action, payload) }
            if (!main.post(task)) return failure("conflict: Android UI unavailable")
            return try { task.get(2, TimeUnit.SECONDS) }
            catch (_: Exception) {
                task.cancel(false)
                // A running write may already have completed. Never automatically retry a cut.
                failure("conflict: clipboard result uncertain; preserve the selection and retry explicitly")
            }
        }

        private fun failure(message: String) = JSONObject().put("error", message).toString()

        private fun handle(a: Activity, action: String, payload: String): String = try {
            require(action in setOf("copy", "cut", "paste")) { "unsupported: unknown clipboard action" }
            require(payload.length <= 400_000) { "invalid: clipboard payload too large" }
            val p = JSONObject(payload)
            require(p.opt("userInitiated") == true) { "auth: explicit user action required" }
            val expiresAt = p.opt("expiresAt")
            val now = System.currentTimeMillis()
            require(expiresAt is Number && expiresAt.toLong() > now && expiresAt.toLong() <= now + ACTION_TTL_MS) {
                "conflict: clipboard action expired or invalid; select the action again"
            }
            val keyguard = a.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            require(a.hasWindowFocus() && !a.isFinishing && !a.isDestroyed && keyguard != null && !keyguard.isKeyguardLocked) {
                "auth: clipboard requires the unlocked app in the foreground"
            }
            val clipboard = a.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                ?: error("unsupported: Android clipboard unavailable")
            val out = JSONObject().put("ok", true).put("action", action)
            if (action == "paste") {
                // Do not coerceToText: a URI/Intent could trigger resolver IO or expose another app's data.
                val clip = clipboard.primaryClip ?: error("not_found: clipboard empty or unavailable")
                require(clip.itemCount > 0) { "not_found: clipboard empty or unavailable" }
                val item = clip.getItemAt(0)
                require(item.uri == null && item.intent == null) { "unsupported: clipboard is not plain text" }
                val text = item.text?.toString() ?: error("unsupported: clipboard is not plain text")
                require(text.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "invalid: clipboard text exceeds 64 KiB" }
                out.put("text", text)
            } else {
                val text = p.opt("text")
                require(text is String && text.isNotEmpty() && text.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) {
                    "invalid: clipboard text must contain 1 to 65536 UTF-8 bytes"
                }
                val clip = ClipData.newPlainText("", text)
                // Suppress Android 13+ preview, also for callers copying a secret explicitly.
                // Literal key is supported on older SDKs and harmless before Android 13.
                clip.description.extras = PersistableBundle().apply {
                    putBoolean("android.content.extra.IS_SENSITIVE", true)
                }
                clipboard.setPrimaryClip(clip)
                // Native layer never edits DOM fields. UI may delete ONLY after this acknowledgment.
                out.put("written", true)
            }
            out.toString()
        } catch (e: Exception) {
            val message = e.message.orEmpty()
            // Only fixed, local messages leave this boundary; platform exception messages may contain text.
            val safe = setOf(
                "unsupported: unknown clipboard action", "invalid: clipboard payload too large",
                "auth: explicit user action required", "conflict: clipboard action expired or invalid; select the action again",
                "auth: clipboard requires the unlocked app in the foreground", "unsupported: Android clipboard unavailable",
                "not_found: clipboard empty or unavailable", "unsupported: clipboard is not plain text",
                "invalid: clipboard text exceeds 64 KiB", "invalid: clipboard text must contain 1 to 65536 UTF-8 bytes"
            )
            failure(if (message in safe) message else "unavailable: Android clipboard operation failed")
        }
    }
}
