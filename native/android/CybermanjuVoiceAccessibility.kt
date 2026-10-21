// CyberManju OS — Android assisted fill (native/android/CybermanjuVoiceAccessibility.kt).
// Role: Fill one confirmed, focused, editable non-password field in one selected package.
// Exports: CybermanjuVoiceAccessibility service and short-lived arm/clear capability.
// Integrates: native confirmation dialog and generated accessibility metadata.
// Contracts: 30-second monotonic expiry; one attempt; no text extraction/clicks/gestures/send.
package __PACKAGE__

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast

class CybermanjuVoiceAccessibility : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val request = synchronized(lock) {
            val current = pending ?: return
            if (SystemClock.elapsedRealtime() > current.expiresAt) { pending = null; return }
            current
        }
        if (event?.packageName?.toString() != request.packageName ||
            event.eventType != AccessibilityEvent.TYPE_VIEW_FOCUSED) return
        try {
            val root = rootInActiveWindow ?: return
            try {
                if (root.packageName?.toString() != request.packageName) return
                val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return
                try {
                    if (focused.packageName?.toString() != request.packageName || !focused.isEditable ||
                        focused.isPassword || passwordInput(focused.inputType) ||
                        !focused.isEnabled || !focused.isFocused || !focused.isVisibleToUser) return
                    val selected = getSharedPreferences("cybermanju_voice", Context.MODE_PRIVATE)
                        .getStringSet("packages", emptySet()).orEmpty().contains(request.packageName)
                    if (!selected) { clear(); return }
                    // Consume before attempting the write, even when the target refuses it.
                    synchronized(lock) { if (pending !== request) return; pending = null }
                    val args = Bundle().apply {
                        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, request.text)
                    }
                    val filled = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                    Toast.makeText(this, if (filled) "Text filled. Review it before sending."
                        else "This field refused the text. Nothing was sent.", Toast.LENGTH_LONG).show()
                } finally { focused.recycle() }
            } finally { root.recycle() }
        } catch (_: Exception) {
            clear()
            Toast.makeText(this, "Text fill unavailable. Nothing was sent.", Toast.LENGTH_SHORT).show()
        }
    }
    override fun onInterrupt() { clear() }
    override fun onUnbind(intent: android.content.Intent?): Boolean { clear(); return super.onUnbind(intent) }
    override fun onDestroy() { clear(); super.onDestroy() }

    companion object {
        private data class Fill(val packageName: String, val text: String, val expiresAt: Long)
        private val lock = Any()
        private val main = Handler(Looper.getMainLooper())
        private var pending: Fill? = null
        fun arm(packageName: String, text: String) {
            val request = Fill(packageName, text, SystemClock.elapsedRealtime() + 30_000)
            synchronized(lock) { pending = request }
            main.postDelayed({ synchronized(lock) { if (pending === request) pending = null } }, 30_000)
        }
        fun clear() { synchronized(lock) { pending = null } }
        private fun passwordInput(input: Int): Boolean {
            val kind = input and InputType.TYPE_MASK_CLASS
            val variation = input and InputType.TYPE_MASK_VARIATION
            return (kind == InputType.TYPE_CLASS_TEXT && variation in setOf(
                InputType.TYPE_TEXT_VARIATION_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
            )) || (kind == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD)
        }
    }
}
