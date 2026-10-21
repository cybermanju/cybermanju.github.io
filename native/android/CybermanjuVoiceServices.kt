// CyberManju OS — Android voice bridge (native/android/CybermanjuVoiceServices.kt).
// Role: Device-local voice, selected notifications and explicitly confirmed external actions.
// Exports: CybermanjuVoiceServices.dispatch(Activity, String, String): String.
// Integrates: Android SpeechRecognizer, TextToSpeech, RemoteInput and assisted accessibility fill.
// Contracts: No message-body persistence/network; foreground audio; native confirmation; bounded queues.
package __PACKAGE__

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.app.KeyguardManager
import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

private const val PREFS = "cybermanju_voice"
private const val PACKAGES = "packages"
private fun selectedPackages(c: Context): Set<String> =
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(PACKAGES, emptySet()).orEmpty().toSet()

internal data class Item(
    val key: String,
    val packageName: String,
    val appLabel: String,
    val title: String,
    val text: String,
    val timestamp: Long,
    val canReply: Boolean,
    val replyIntent: PendingIntent?,
)

class CybermanjuVoiceNotificationListener : NotificationListenerService() {
    override fun onListenerConnected() {
        super.onListenerConnected()
        live = this
        refresh()
    }
    override fun onListenerDisconnected() {
        live = null
        synchronized(items) { items.clear() }
        super.onListenerDisconnected()
    }
    override fun onDestroy() {
        if (live === this) live = null
        synchronized(items) { items.clear() }
        super.onDestroy()
    }
    override fun onNotificationPosted(sbn: StatusBarNotification) { capture(sbn) }
    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        synchronized(items) { items.remove(sbn.key) }
    }
    /** Refresh only on explicit local request or connection; never upload to an agent. */
    internal fun refresh() {
        if (!enabled(this)) { synchronized(items) { items.clear() }; return }
        val active = activeNotifications.orEmpty()
        val keys = active.map { it.key }.toSet()
        synchronized(items) { items.entries.removeAll { it.key !in keys } }
        active.sortedBy { it.postTime }.forEach { capture(it) }
    }
    private fun capture(s: StatusBarNotification) {
        if (!enabled(this) || s.packageName !in selectedPackages(this)) return
        val extras = s.notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().take(500)
        val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty().take(2000)
        val label = try {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(s.packageName, 0)).toString()
        } catch (_: Exception) { s.packageName }
        val reply = freeformAction(s.notification, s.packageName)?.actionIntent
        synchronized(items) {
            items[s.key] = Item(s.key, s.packageName, label.take(150), title, body, s.postTime, reply != null, reply)
            while (items.size > 100) items.remove(items.keys.first())
        }
    }
    companion object {
        @Volatile internal var live: CybermanjuVoiceNotificationListener? = null
        internal val items = LinkedHashMap<String, Item>()
        internal fun enabled(c: Context): Boolean {
            val raw = Settings.Secure.getString(c.contentResolver, "enabled_notification_listeners").orEmpty()
            return raw.split(':').mapNotNull { ComponentName.unflattenFromString(it) }
                .contains(ComponentName(c, CybermanjuVoiceNotificationListener::class.java))
        }
    }
}

private fun freeformAction(n: Notification, pkg: String): Notification.Action? =
    n.actions.orEmpty().firstOrNull { action ->
        action.actionIntent?.creatorPackage == pkg &&
            action.remoteInputs?.any { it.allowFreeFormInput } == true
    }

class CybermanjuVoiceServices {
    companion object {
        // Native dispatch and all mutable audio state are confined to the main thread.
        private val main = Handler(Looper.getMainLooper())
        private val events = ArrayDeque<JSONObject>()
        private var recognizer: SpeechRecognizer? = null
        private var tts: TextToSpeech? = null
        private var ttsReady = false
        private var audioFocusManager: AudioManager? = null
        private var audioFocusRequest: AudioFocusRequest? = null
        private var legacyFocusListener: AudioManager.OnAudioFocusChangeListener? = null
        private var focusGeneration = -1
        private var focusSpeechId: String? = null
        private var activeActivity: Activity? = null
        private var currentListen: String? = null
        private var currentSpeech: String? = null
        private var generation = 0
        private var dialog: AlertDialog? = null
        private var lifecycleRegistered = false
        private var activityForeground = false
        private val lifecycle = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityPaused(a: Activity) {
                if (a !== activeActivity) return
                activityForeground = false
                dialog?.dismiss()
                stopAudio(lifecycleEnd = true)
            }
            override fun onActivityDestroyed(a: Activity) {
                if (a !== activeActivity) return
                dialog?.dismiss()
                stopAudio(lifecycleEnd = true)
                activeActivity = null
                CybermanjuVoiceAccessibility.clear()
            }
            override fun onActivityResumed(a: Activity) {
                if (a === activeActivity) activityForeground = true
            }
            override fun onActivityCreated(a: Activity, b: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityStopped(a: Activity) {}
        }

        /** Called from a Rust blocking worker, not a JavaScript interface or REST route. */
        @JvmStatic fun dispatch(activity: Activity, action: String, payload: String): String {
            if (Looper.myLooper() == Looper.getMainLooper()) return handle(activity, action, payload)
            val task = FutureTask<String> { handle(activity, action, payload) }
            main.post(task)
            return try { task.get(4, TimeUnit.SECONDS) }
            catch (_: Exception) {
                task.cancel(false)
                JSONObject().put("error", "conflict: Android UI busy; check the current state before retrying").toString()
            }
        }

        private fun handle(a: Activity, action: String, payload: String): String = try {
            ensureLifecycle(a)
            val p = JSONObject(payload)
            val out = when (action) {
                "status" -> status(a)
                "configure" -> configure(a, p)
                "notifications" -> notificationItems(a)
                "reply" -> {
                    requireForeground(a)
                    val text = exactText(p, 2000)
                    confirmReply(a, p.getString("key"), text)
                    JSONObject().put("pendingConfirmation", true)
                }
                "fill" -> {
                    requireForeground(a)
                    val pkg = p.getString("packageName")
                    require(pkg in selectedPackages(a)) { "auth: package is not selected" }
                    require(accessibilityEnabled(a)) { "auth: enable the VozPonte accessibility service first" }
                    confirmFill(a, pkg, exactText(p, 4000))
                    JSONObject().put("pendingConfirmation", true)
                }
                "notificationSettings" -> openSettings(a, Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                "accessibilitySettings" -> openSettings(a, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                "microphoneSettings" -> openSettings(a, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.parse("package:${a.packageName}")))
                "listen" -> {
                    require(p.optLong("expiresAt", 0L) > System.currentTimeMillis()) { "conflict: audio request expired; start again" }
                    listen(a, audioId(p), p.optString("lang", "pt-BR")); ok()
                }
                "speak" -> {
                    require(p.optLong("expiresAt", 0L) > System.currentTimeMillis()) { "conflict: audio request expired; start again" }
                    speak(a, audioId(p), p.optString("lang", "pt-BR"), exactText(p, 6000)); ok()
                }
                "stopListening" -> { stopListening(); ok() }
                "stopSpeaking" -> { stopSpeech(); ok() }
                "stop" -> { stopAudio(); ok() }
                "poll" -> {
                    val batch = JSONArray()
                    while (events.isNotEmpty()) batch.put(events.removeFirst())
                    JSONObject().put("events", batch)
                }
                else -> error("unsupported: unknown native voice action")
            }
            out.toString()
        } catch (e: Exception) {
            val detail = e.message.orEmpty()
            val prefixed = listOf("auth:", "invalid:", "unsupported:", "conflict:", "not_found:").any { detail.startsWith(it) }
            JSONObject().put("error", if (prefixed) detail else "unsupported: Android voice operation unavailable").toString()
        }

        private fun ok() = JSONObject().put("ok", true)
        private fun exactText(p: JSONObject, max: Int): String {
            val text = p.getString("text")
            require(text.isNotBlank() && text.length <= max) { "invalid: text must contain 1–$max characters" }
            return text
        }
        private fun audioId(p: JSONObject): String {
            val id = p.getString("id")
            require(id.matches(Regex("[A-Za-z0-9_-]{1,80}"))) { "invalid: audio turn ID" }
            return id
        }
        private fun ensureLifecycle(a: Activity) {
            if (activeActivity !== a) {
                stopAudio(lifecycleEnd = true)
                dialog?.dismiss()
                activeActivity = a
                // First IPC can occur after onResume but before window focus.
                // requireForeground independently checks focus; future pause/resume
                // callbacks then maintain the strict lifecycle gate.
                activityForeground = true
            }
            if (!lifecycleRegistered) {
                a.application.registerActivityLifecycleCallbacks(lifecycle)
                lifecycleRegistered = true
            }
        }
        private fun requireForeground(a: Activity) {
            require(a === activeActivity && activityForeground && a.hasWindowFocus() && !a.isFinishing && !a.isDestroyed) {
                "auth: keep the CyberManju app in the foreground"
            }
        }
        private fun configure(a: Activity, p: JSONObject): JSONObject {
            val aPackages = p.getJSONArray("packages")
            // Keep the schema local, explicit and bounded.
            require(aPackages.length() <= 50) { "invalid: select at most 50 packages" }
            val set = linkedSetOf<String>()
            for (i in 0 until aPackages.length()) {
                val name = aPackages.getString(i)
                require(name.length <= 255 && name.matches(Regex("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+"))) {
                    "invalid: app package name"
                }
                set.add(name)
            }
            a.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(PACKAGES, set).apply()
            synchronized(CybermanjuVoiceNotificationListener.items) {
                CybermanjuVoiceNotificationListener.items.entries.removeAll { it.value.packageName !in set }
            }
            CybermanjuVoiceAccessibility.clear()
            dialog?.dismiss()
            return ok()
        }
        private fun accessibilityEnabled(a: Activity): Boolean =
            Settings.Secure.getString(a.contentResolver, "enabled_accessibility_services").orEmpty().split(':')
                .mapNotNull { ComponentName.unflattenFromString(it) }
                .contains(ComponentName(a, CybermanjuVoiceAccessibility::class.java))
        private fun status(a: Activity): JSONObject {
            val notifications = CybermanjuVoiceNotificationListener.enabled(a)
            if (!notifications) synchronized(CybermanjuVoiceNotificationListener.items) {
                CybermanjuVoiceNotificationListener.items.clear()
            }
            return JSONObject().put("android", true)
                .put("recognitionAvailable", SpeechRecognizer.isRecognitionAvailable(a))
                .put("microphoneGranted", a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                .put("notificationAccess", notifications)
                .put("accessibilityEnabled", accessibilityEnabled(a))
                .put("selectedPackages", JSONArray(selectedPackages(a).toList()))
        }
        private fun notificationItems(a: Activity): JSONObject {
            if (!CybermanjuVoiceNotificationListener.enabled(a)) {
                synchronized(CybermanjuVoiceNotificationListener.items) { CybermanjuVoiceNotificationListener.items.clear() }
                error("auth: notification access disabled")
            }
            val service = CybermanjuVoiceNotificationListener.live ?: error("conflict: notification service is reconnecting")
            service.refresh()
            val out = JSONArray()
            synchronized(CybermanjuVoiceNotificationListener.items) {
                CybermanjuVoiceNotificationListener.items.values.filter { it.packageName in selectedPackages(a) }
                    .sortedByDescending { it.timestamp }.forEach { item ->
                        out.put(JSONObject().put("key", item.key).put("packageName", item.packageName)
                            .put("appLabel", item.appLabel).put("title", item.title).put("text", item.text)
                            .put("timestamp", item.timestamp).put("canReply", item.canReply))
                    }
            }
            return JSONObject().put("items", out)
        }
        private fun showConfirmation(a: Activity, title: String, text: String, confirm: () -> Unit) {
            check(dialog == null) { "conflict: finish the current Android confirmation first" }
            stopAudio(lifecycleEnd = true)
            val next = AlertDialog.Builder(a).setTitle(title).setMessage(text)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Confirm") { _, _ ->
                    try { confirm() }
                    catch (_: Exception) { Toast.makeText(a, "Action unavailable. Review permissions and refresh first.", Toast.LENGTH_LONG).show() }
                }.create()
            next.setOnDismissListener { if (dialog === next) dialog = null }
            dialog = next
            try { next.show() } catch (e: Exception) { dialog = null; throw e }
        }
        private fun confirmReply(a: Activity, key: String, text: String) {
            require(CybermanjuVoiceNotificationListener.enabled(a)) { "auth: notification access disabled" }
            val item = synchronized(CybermanjuVoiceNotificationListener.items) { CybermanjuVoiceNotificationListener.items[key] }
                ?: error("not_found: notification is no longer available; refresh first")
            require(item.canReply && item.packageName in selectedPackages(a)) { "auth: notification reply is not available" }
            showConfirmation(a, "Reply to ${item.appLabel}", "${item.title}\n${item.packageName}\n\n$text") {
                sendReply(a, item, text)
            }
        }
        private fun sendReply(a: Activity, expected: Item, text: String) {
            check(CybermanjuVoiceNotificationListener.enabled(a) && expected.packageName in selectedPackages(a))
            val unlocked = !(a.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceLocked
            check(unlocked)
            val sbn = CybermanjuVoiceNotificationListener.live?.activeNotifications?.firstOrNull { it.key == expected.key }
                ?: error("notification removed")
            val extras = sbn.notification.extras
            // Same key alone is insufficient: some apps reuse keys for a different conversation.
            check(sbn.packageName == expected.packageName && sbn.postTime == expected.timestamp)
            check(extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().take(500) == expected.title)
            check(extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty().take(2000) == expected.text)
            val action = freeformAction(sbn.notification, expected.packageName) ?: error("reply action removed")
            check(expected.replyIntent != null && action.actionIntent == expected.replyIntent)
            val inputs = action.remoteInputs ?: error("reply unavailable")
            val intent = Intent()
            val results = Bundle()
            inputs.filter { it.allowFreeFormInput }.forEach { results.putCharSequence(it.resultKey, text) }
            RemoteInput.addResultsToIntent(inputs, intent, results)
            action.actionIntent.send(a, 0, intent)
            Toast.makeText(a, "Reply handed to ${expected.appLabel}", Toast.LENGTH_SHORT).show()
        }
        private fun confirmFill(a: Activity, pkg: String, text: String) {
            showConfirmation(a, "Fill text in $pkg", "$text\n\nFocus the target field within 30 seconds. This does not send the text.") {
                check(pkg in selectedPackages(a) && accessibilityEnabled(a))
                val target = a.packageManager.getLaunchIntentForPackage(pkg) ?: error("target app unavailable")
                CybermanjuVoiceAccessibility.arm(pkg, text)
                try { a.startActivity(target) }
                catch (e: Exception) { CybermanjuVoiceAccessibility.clear(); throw e }
            }
        }
        private fun openSettings(a: Activity, intent: Intent): JSONObject {
            requireForeground(a)
            a.startActivity(intent)
            return ok()
        }
        private fun emit(id: String, type: String, text: String? = null, error: String? = null) {
            // Only call on the main thread, including TTS worker callbacks marshalled below.
            if (events.size >= 100) events.removeFirst()
            val event = JSONObject().put("id", id).put("type", type)
            if (text != null) event.put("text", text)
            if (error != null) event.put("error", error)
            events.addLast(event)
        }
        private fun listen(a: Activity, id: String, lang: String) {
            requireForeground(a)
            stopListening()
            stopSpeech()
            require(a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                "auth: microphone permission required; grant it in Android app settings"
            }
            require(SpeechRecognizer.isRecognitionAvailable(a)) { "unsupported: install an Android speech recognition provider" }
            val gen = ++generation
            currentListen = id
            try {
                val r = SpeechRecognizer.createSpeechRecognizer(a)
                recognizer = r
                r.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(p: Bundle?) {}
                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(v: Float) {}
                    override fun onBufferReceived(b: ByteArray?) {}
                    override fun onEndOfSpeech() { /* onResults follows; this is NOT a final event. */ }
                    override fun onError(code: Int) {
                        if (gen != generation || currentListen != id) return
                        val detail = when (code) {
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission denied. Allow microphone access in Android app settings."
                            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech detected. Start the call again when ready."
                            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network unavailable. Check your connection and speech provider."
                            SpeechRecognizer.ERROR_AUDIO -> "Microphone unavailable. Check whether another app or phone call is using it."
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech provider busy. Wait a moment, then start the call again."
                            else -> "Android recognition error $code. Check permission/provider and start again."
                        }
                        emit(id, "error", error = detail)
                        stopListening()
                    }
                    override fun onResults(b: Bundle?) {
                        if (gen != generation || currentListen != id) return
                        val text = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().take(6000)
                        if (text.isBlank()) emit(id, "end") else emit(id, "final", text = text)
                        stopListening()
                    }
                    override fun onPartialResults(b: Bundle?) {}
                    override fun onEvent(t: Int, b: Bundle?) {}
                })
                r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang).putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false))
            } catch (_: Exception) {
                stopListening()
                error("unsupported: Android recognition could not start")
            }
        }
        private fun stopListening() {
            generation++
            currentListen = null
            val old = recognizer
            recognizer = null
            try { old?.cancel() } catch (_: Exception) {}
            try { old?.destroy() } catch (_: Exception) {}
        }
        private fun speak(a: Activity, id: String, lang: String, text: String) {
            requireForeground(a)
            stopListening()
            stopSpeech()
            val gen = generation
            currentSpeech = id
            val locale = Locale.forLanguageTag(lang)
            val engine = tts
            if (engine != null && ttsReady) { say(engine, id, gen, text, locale); return }
            // Recreate an engine whose previous initialization was cancelled or failed.
            try { engine?.shutdown() } catch (_: Exception) {}
            ttsReady = false
            try {
                tts = TextToSpeech(a.applicationContext) { result -> main.post {
                    if (gen != generation || currentSpeech != id) return@post
                    val ready = tts ?: return@post
                    if (result != TextToSpeech.SUCCESS) {
                        emit(id, "error", error = "unsupported: Android TTS initialization failed")
                        stopSpeech()
                    } else {
                        ttsReady = true
                        say(ready, id, gen, text, locale)
                    }
                } }
            } catch (_: Exception) {
                stopSpeech()
                error("unsupported: Android TTS could not start")
            }
        }
        private fun say(t: TextToSpeech, id: String, gen: Int, text: String, locale: Locale) {
            try {
                val speechAttributes = AudioAttributes.Builder()
                    .setUsage(if (Build.VERSION.SDK_INT >= 26) AudioAttributes.USAGE_ASSISTANT else AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
                t.setAudioAttributes(speechAttributes)
                val language = t.setLanguage(locale)
                if (language == TextToSpeech.LANG_NOT_SUPPORTED || language == TextToSpeech.LANG_MISSING_DATA) {
                    emit(id, "error", error = "unsupported: install a TTS voice for this language")
                    stopSpeech()
                    return
                }
                if (!requestSpeechFocus(id, gen, speechAttributes)) {
                    emit(id, "error", error = "Audio focus denied; speech was not started")
                    stopSpeech()
                    return
                }
                // Android limits one utterance; split the bounded answer rather than dropping it.
                val chunks = text.chunked(minOf(3500, TextToSpeech.getMaxSpeechInputLength()))
                val prefix = "cm-$id-$gen-"
                val last = "$prefix${chunks.lastIndex}"
                t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(s: String?) {}
                    override fun onDone(s: String?) { main.post {
                        if (s == last && gen == generation && currentSpeech == id) {
                            emit(id, "spoken")
                            currentSpeech = null
                            abandonSpeechFocus()
                        }
                    } }
                    @Deprecated("Android legacy callback")
                    override fun onError(s: String?) { failed(s) }
                    override fun onError(s: String?, code: Int) { failed(s) }
                    private fun failed(s: String?) { main.post {
                        if (s?.startsWith(prefix) == true && gen == generation && currentSpeech == id) {
                            emit(id, "error", error = "unsupported: Android speech output failed; answer remains in chat")
                            stopSpeech()
                        }
                    } }
                })
                chunks.forEachIndexed { index, chunk ->
                    val mode = if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
                    check(t.speak(chunk, mode, null, "$prefix$index") != TextToSpeech.ERROR)
                }
            } catch (_: Exception) {
                emit(id, "error", error = "unsupported: Android speech output failed; answer remains in chat")
                stopSpeech()
            }
        }
        private fun requestSpeechFocus(id: String, gen: Int, attributes: AudioAttributes): Boolean {
            val context = activeActivity?.applicationContext ?: return false
            val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
            abandonSpeechFocus()
            val listener = AudioManager.OnAudioFocusChangeListener { change -> main.post {
                if (gen != generation || currentSpeech != id || focusGeneration != gen || focusSpeechId != id) return@post
                if (change <= 0) {
                    emit(id, "error", error = "Audio focus lost; speech stopped and will not resume automatically")
                    stopSpeech()
                }
            } }
            audioFocusManager = manager
            focusGeneration = gen
            focusSpeechId = id
            val result = if (Build.VERSION.SDK_INT >= 26) {
                val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(attributes)
                    .setWillPauseWhenDucked(true)
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener(listener, main)
                    .build()
                audioFocusRequest = request
                manager.requestAudioFocus(request)
            } else {
                legacyFocusListener = listener
                @Suppress("DEPRECATION")
                manager.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            }
            if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                abandonSpeechFocus()
                return false
            }
            return true
        }
        private fun abandonSpeechFocus() {
            val manager = audioFocusManager
            val request = audioFocusRequest
            val listener = legacyFocusListener
            // Clear identity first: even a late callback or failed binder call
            // must not retain ownership or affect the following speech turn.
            audioFocusManager = null
            audioFocusRequest = null
            legacyFocusListener = null
            focusGeneration = -1
            focusSpeechId = null
            try {
                if (manager != null) {
                    if (Build.VERSION.SDK_INT >= 26) request?.let { manager.abandonAudioFocusRequest(it) }
                    else listener?.let {
                        @Suppress("DEPRECATION")
                        manager.abandonAudioFocus(it)
                    }
                }
            } catch (_: Exception) { /* Audio-service failure cannot block local cleanup. */ }
        }
        private fun stopSpeech() {
            generation++
            currentSpeech = null
            try { tts?.stop() } catch (_: Exception) {}
            abandonSpeechFocus()
        }
        private fun stopAudio(lifecycleEnd: Boolean = false) {
            if (lifecycleEnd) {
                currentListen?.let { emit(it, "error", error = "Android audio stopped after leaving the foreground") }
                currentSpeech?.let { emit(it, "error", error = "Android audio stopped after leaving the foreground") }
            }
            stopListening()
            stopSpeech()
            try { tts?.shutdown() } catch (_: Exception) {}
            tts = null
            ttsReady = false
        }
    }
}
