// CyberManju OS — Explicit Android screen reading (native/android/CybermanjuScreenReader.kt).
// Role: Consent-per-session projection, sequential screen locking and bounded local OCR.
// Exports: CybermanjuScreenReader dispatch and non-exported consent/service components.
// Integrates: Android MediaProjection, persistent notification, overlay and bundled ML Kit OCR.
// Contracts: No silent restart, token reuse, accessibility scraping, upload or invisible-app monitoring.
package __PACKAGE__

import android.app.*
import android.content.*
import android.graphics.*
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.*
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.*
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/** Main-looper owned state. Neither Vue nor preferences own a second session. */
object CybermanjuScreenReader {
    private const val LIMITATION = "Reads only the shared visible screen. Other apps shown while sharing may be captured. Locked screens are local snapshots, not frozen external app UIs; hidden apps cannot be monitored. Secure screens may be blank. Overlay-covered content is excluded."
    private val main = Handler(Looper.getMainLooper())
    private val events = ArrayDeque<JSONObject>()
    private var app: Context? = null
    private var id: String? = null
    private var state = "idle"
    private var mode: String? = null
    private var packages = emptyList<String>()
    private var index = 0
    private var lastError: String? = null
    private val captures = linkedMapOf<String, JSONObject>()
    internal var service: CybermanjuScreenReaderService? = null
        private set
    private var timeout: Runnable? = null
    private fun active() = state in setOf("awaiting_permission", "selecting", "reading")
    internal fun owns(sessionId: String?) = sessionId != null && id == sessionId && active()
    internal fun current() = packages.getOrNull(index)
    private fun snapshot(): JSONObject = JSONObject()
        .put("sessionId", id ?: JSONObject.NULL).put("state", state)
        .put("packageName", if (active()) current() ?: JSONObject.NULL else JSONObject.NULL)
        .put("index", index).put("total", packages.size).put("mode", mode ?: JSONObject.NULL)
        .put("packages", JSONArray(packages)).put("captures", JSONArray(captures.values.map { JSONObject(it.toString()) }))
        .put("overlayGranted", app?.let { Settings.canDrawOverlays(it) } ?: false)
        .put("engine", "mlkit-latin-on-device").put("limitation", LIMITATION)
        .also { lastError?.let { error -> it.put("lastError", error) } }
    private fun emit(event: JSONObject) { if (events.size >= 100) events.removeFirst(); events.addLast(event) }
    private fun update(next: String, error: String? = null) {
        state = next; lastError = error
        emit(JSONObject().put("type", "state").put("snapshot", snapshot()))
    }
    private fun clearTimeout() { timeout?.let { main.removeCallbacks(it) }; timeout = null }

    @JvmStatic fun dispatch(a: Activity, action: String, p: JSONObject): JSONObject {
        check(Looper.myLooper() == Looper.getMainLooper())
        app = a.applicationContext
        return try {
            when (action) {
                "readerStatus" -> snapshot()
                "readerPoll" -> {
                    val batch = JSONArray(); while (events.isNotEmpty()) batch.put(events.removeFirst())
                    JSONObject().put("events", batch).put("status", snapshot())
                }
                "readerStop" -> { stop(); snapshot() }
                "readerOverlaySettings" -> {
                    require(a.hasWindowFocus() && !a.isFinishing) { "auth: keep CyberManju in the foreground" }
                    a.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:${a.packageName}")))
                    snapshot()
                }
                "readerStart" -> start(a, p)
                else -> JSONObject().put("error", "unsupported: unknown screen reader action")
            }
        } catch (e: Exception) {
            // Invalid/repeated requests must not corrupt an already running session.
            JSONObject().put("error", e.message?.takeIf { it.contains(':') } ?: "unsupported: screen reader operation unavailable")
        }
    }
    private fun start(a: Activity, p: JSONObject): JSONObject {
        require(!active() && service == null) { "conflict: stop the current screen session first" }
        require(a.hasWindowFocus() && !a.isFinishing && !a.isDestroyed) { "auth: keep CyberManju in the foreground" }
        require(p.optBoolean("consentDisclosure", false)) { "auth: accept the screen sharing disclosure first" }
        require(p.optLong("expiresAt", Long.MAX_VALUE) > System.currentTimeMillis()) { "conflict: screen request expired; start again" }
        require(Settings.canDrawOverlays(a)) { "auth: allow screen selection controls using readerOverlaySettings first" }
        val list = p.getJSONArray("packages")
        require(list.length() in 1..20) { "invalid: select 1–20 apps" }
        val selected = (0 until list.length()).map { list.getString(it) }
        require(selected.distinct().size == selected.size && selected.all {
            it.matches(Regex("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+")) &&
                it != a.packageName && a.packageManager.getLaunchIntentForPackage(it) != null
        }) { "invalid: select distinct launchable external apps" }
        val requestedMode = p.getString("mode")
        require((requestedMode == "single" && selected.size == 1) || (requestedMode == "batch" && selected.size in 2..20)) { "invalid: single requires one app; batch requires 2–20" }
        clearTimeout(); events.clear(); captures.clear(); index = 0; packages = selected; mode = requestedMode
        id = UUID.randomUUID().toString(); update("awaiting_permission")
        val expected = id
        timeout = Runnable { if (owns(expected) && state == "awaiting_permission") stop("cancelled", "Screen sharing consent timed out. Start again.") }
            .also { main.postDelayed(it, 120_000) }
        try { a.startActivity(Intent(a, CybermanjuScreenReaderConsentActivity::class.java).putExtra("sessionId", id)) }
        catch (e: Exception) { stop("error", "Could not open Android sharing consent."); throw e }
        return snapshot()
    }
    internal fun requestProjection(a: Activity, expected: String?) {
        if (!owns(expected) || state != "awaiting_permission") { a.finish(); return }
        val manager = a.getSystemService(MediaProjectionManager::class.java)
        // Default-display sharing is deliberate and disclosed: batch cannot keep
        // several app-window grants alive or reuse a one-use Android 14 token.
        val intent = if (Build.VERSION.SDK_INT >= 34) manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            else manager.createScreenCaptureIntent()
        a.startActivityForResult(intent, 9107)
    }
    internal fun consentResult(a: Activity, expected: String?, result: Int, data: Intent?) {
        if (!owns(expected) || state != "awaiting_permission") return // stale consent after Stop is never reusable
        clearTimeout()
        if (result != Activity.RESULT_OK || data == null) { stop("cancelled", "Android screen sharing was cancelled."); return }
        val intent = Intent(a, CybermanjuScreenReaderService::class.java).setAction("start")
            .putExtra("sessionId", expected).putExtra("result", result).putExtra("data", data)
        try { if (Build.VERSION.SDK_INT >= 26) a.startForegroundService(intent) else a.startService(intent) }
        catch (_: Exception) { stop("error", "Android refused to start the foreground screen session.") }
        // Bound a service-start failure; no unbounded awaiting-permission state.
        if (owns(expected) && service == null) timeout = Runnable {
            if (owns(expected) && service == null) stop("error", "Screen session did not start. Check Android permissions.")
        }.also { main.postDelayed(it, 10_000) }
    }
    internal fun ready(expected: String, value: CybermanjuScreenReaderService): Boolean {
        if (!owns(expected) || service != null) return false
        clearTimeout(); service = value; update("selecting"); return true
    }
    internal fun select(expected: String) {
        if (!owns(expected) || state != "selecting") return
        val pkg = current() ?: return
        captures[pkg] = JSONObject().put("packageName", pkg).put("selectedAt", System.currentTimeMillis())
        update("reading")
    }
    internal fun advance(expected: String): Boolean {
        if (!owns(expected) || state != "reading") return false
        if (index + 1 >= packages.size) { stop(); return false }
        index++; update("selecting"); return true
    }
    internal fun text(expected: String, pkg: String, text: String) {
        if (!owns(expected) || state != "reading" || current() != pkg) return
        captures[pkg]?.put("text", text.take(4000))
        emit(JSONObject().put("type", "text").put("sessionId", expected).put("packageName", pkg)
            .put("text", text.take(16000)).put("timestamp", System.currentTimeMillis()))
    }
    internal fun stop(next: String = "stopped", error: String? = null) {
        clearTimeout()
        // Invalidate pending permission before finishing its activity or stopping the service.
        update(next, error)
        CybermanjuScreenReaderConsentActivity.cancel(id)
        val old = service; service = null
        old?.shutdown()
    }
    internal fun ended(expected: String, value: CybermanjuScreenReaderService, error: String? = null) {
        if (id != expected || (service != null && service !== value)) return
        service = null; clearTimeout()
        if (active()) update(if (error == null) "stopped" else "error", error)
        CybermanjuScreenReaderConsentActivity.cancel(expected)
    }
    internal fun statusLabel(): String = "${index + 1}/${packages.size} • ${current().orEmpty()}\n" +
        if (state == "selecting") "Position the screen, then Select. Shared visible screen only." else "Reading shared visible screen. Hidden apps are not monitored."
    internal fun isReading() = state == "reading"
    internal fun isLast() = index + 1 >= packages.size
}

class CybermanjuScreenReaderConsentActivity : Activity() {
    private var expected: String? = null
    private var prompt: AlertDialog? = null
    companion object {
        private var live: CybermanjuScreenReaderConsentActivity? = null
        internal fun cancel(id: String?) { live?.takeIf { it.expected == id }?.finish() }
        internal fun launch(id: String, intent: Intent): Boolean {
            val a = live?.takeIf { it.expected == id && !it.isFinishing && !it.isDestroyed } ?: return false
            a.startActivity(intent); a.finish(); return true
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); expected = intent.getStringExtra("sessionId"); live = this
        if (!CybermanjuScreenReader.owns(expected)) { finish(); return }
        // Never request a second token on configuration recreation while Android's dialog is open.
        requested = savedInstanceState?.getBoolean("requested") == true
        if (requested) return
        prompt = AlertDialog.Builder(this).setTitle("Share and read the visible screen?")
            .setMessage("CyberManju will read text locally from your shared visible screen, including other apps you show while sharing. No screen images or text are uploaded. Each Select locks a local snapshot, not the external app itself. Apps hidden in the background cannot be monitored. A persistent notification and overlay let you stop anytime. Secure content may be blank.")
            .setNegativeButton("Cancel") { _, _ -> CybermanjuScreenReader.stop("cancelled"); finish() }
            .setPositiveButton("Continue to Android sharing") { _, _ ->
                requested = true
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                    requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9108)
                else project()
            }
            .setOnCancelListener { CybermanjuScreenReader.stop("cancelled"); finish() }.show()
    }
    private var requested = false
    private fun project() {
        try { CybermanjuScreenReader.requestProjection(this, expected) }
        catch (_: Exception) { CybermanjuScreenReader.stop("error", "Screen sharing consent unavailable."); finish() }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == 9108) {
            if (results.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED) project()
            else { CybermanjuScreenReader.stop("cancelled", "Allow notifications to keep visible Stop controls during screen sharing."); finish() }
        }
    }
    override fun onSaveInstanceState(out: Bundle) { out.putBoolean("requested", requested); super.onSaveInstanceState(out) }
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 9107) {
            CybermanjuScreenReader.consentResult(this, expected, resultCode, data)
            // Keep a visible Activity available to launch the first external app.
            // The service finishes us after foreground initialization and overlay setup.
            if (!CybermanjuScreenReader.owns(expected)) finish()
        }
    }
    override fun onBackPressed() { if (CybermanjuScreenReader.owns(expected)) CybermanjuScreenReader.stop("cancelled"); super.onBackPressed() }
    override fun onDestroy() { prompt?.dismiss(); if (live === this) live = null; super.onDestroy() }
}

class CybermanjuScreenReaderService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var expected = ""
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var worker: HandlerThread? = null
    private var workerHandler: Handler? = null
    private var ocr: CybermanjuScreenOcr? = null
    private var overlay: LinearLayout? = null
    private var title: TextView? = null
    private var selectButton: Button? = null
    private var nextButton: Button? = null
    private var window: WindowManager? = null
    private var released = false
    private var registeredScreenOff = false
    private var registeredDisplay = false
    private val busy = AtomicBoolean(false)
    @Volatile private var target: Target? = null
    @Volatile private var mask = Rect()
    private var sequence = 0
    private var sourceWidth = 0
    private var sourceHeight = 0
    private var captureWidth = 0
    private var captureHeight = 0
    private var captureDensity = 0
    private var lastFrame = 0L
    private var previousText: String? = null
    private data class Target(val packageName: String, val generation: Int)
    private val screenOff = object : BroadcastReceiver() { override fun onReceive(c: Context?, i: Intent?) { CybermanjuScreenReader.stop() } }
    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() { end() }
        override fun onCapturedContentResize(width: Int, height: Int) { if (width > 0 && height > 0 && !released) resize(width, height) }
        override fun onCapturedContentVisibilityChanged(isVisible: Boolean) { if (!isVisible) { target = null; end("Shared screen is no longer visible. Start a new consented session.") } }
    }
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(id: Int) {}
        override fun onDisplayRemoved(id: Int) {}
        override fun onDisplayChanged(id: Int) { if (Build.VERSION.SDK_INT < 34 && !released) { val dm = metrics(); resize(dm.widthPixels, dm.heightPixels) } }
    }
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") { CybermanjuScreenReader.stop(); shutdown(); return START_NOT_STICKY }
        if (projection != null) return START_NOT_STICKY
        if (intent?.action != "start" || released) { stopSelf(); return START_NOT_STICKY }
        expected = intent.getStringExtra("sessionId").orEmpty()
        if (!CybermanjuScreenReader.owns(expected)) { stopSelf(); return START_NOT_STICKY }
        try {
            val channel = "cybermanju_screen_reader"
            if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(channel, "Screen reading controls", NotificationManager.IMPORTANCE_LOW))
            val stop = PendingIntent.getService(this, 7101, Intent(this, javaClass).setAction("stop"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else Notification.Builder(this)
            val notification = builder.setContentTitle("CyberManju: visible screen sharing")
                .setContentText("Local OCR is active only after Select. Tap Stop to end sharing.")
                .setSmallIcon(android.R.drawable.ic_menu_view).setOngoing(true)
                .addAction(Notification.Action.Builder(null, "Stop", stop).build()).build()
            if (Build.VERSION.SDK_INT >= 29) startForeground(71, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            else startForeground(71, notification)
            val data = intent.getParcelableExtra<Intent>("data") ?: error("Missing sharing consent")
            projection = getSystemService(MediaProjectionManager::class.java).getMediaProjection(intent.getIntExtra("result", Activity.RESULT_CANCELED), data)
            intent.removeExtra("data") // one-use grant is never retained or reused
            projection!!.registerCallback(projectionCallback, main)
            window = getSystemService(WindowManager::class.java)
            worker = HandlerThread("CyberManjuLocalOCR").also { it.start() }; workerHandler = Handler(worker!!.looper)
            ocr = CybermanjuScreenOcr()
            val dm = metrics(); sourceWidth = dm.widthPixels; sourceHeight = dm.heightPixels
            captureDensity = dm.densityDpi
            val size = dimensions(sourceWidth, sourceHeight); captureWidth = size.first; captureHeight = size.second
            reader = newReader(captureWidth, captureHeight)
            // Exactly one VirtualDisplay per fresh projection token; later resizes reuse it.
            display = projection!!.createVirtualDisplay("CyberManjuReader", captureWidth, captureHeight, dm.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader!!.surface, null, main)
            if (!CybermanjuScreenReader.ready(expected, this)) { shutdown(); return START_NOT_STICKY }
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED)
            else registerReceiver(screenOff, IntentFilter(Intent.ACTION_SCREEN_OFF))
            registeredScreenOff = true
            getSystemService(DisplayManager::class.java).registerDisplayListener(displayListener, main); registeredDisplay = true
            showControls(); openCurrent()
        } catch (_: Exception) { end("Screen sharing could not start. Check overlay and Android sharing permissions.") }
        return START_NOT_STICKY
    }
    private fun metrics(): DisplayMetrics = DisplayMetrics().also { window?.defaultDisplay?.getRealMetrics(it) }
    private fun dimensions(width: Int, height: Int): Pair<Int, Int> {
        val scale = minOf(1.0, 1440.0 / maxOf(width, height).coerceAtLeast(1))
        return Pair((width * scale).roundToInt().coerceAtLeast(1), (height * scale).roundToInt().coerceAtLeast(1))
    }
    private fun newReader(width: Int, height: Int): ImageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2).also {
        it.setOnImageAvailableListener({ source -> frame(source) }, workerHandler)
    }
    private fun resize(width: Int, height: Int) {
        if (released || display == null || (sourceWidth == width && sourceHeight == height)) return
        try {
            val size = dimensions(width, height); val replacement = newReader(size.first, size.second)
            val old = reader; display?.surface = null
            display?.resize(size.first, size.second, captureDensity)
            display?.surface = replacement.surface
            reader = replacement; captureWidth = size.first; captureHeight = size.second; sourceWidth = width; sourceHeight = height
            old?.setOnImageAvailableListener(null, null); old?.close(); updateMask()
        } catch (_: Exception) { end("Screen size changed and sharing stopped. Start a new session.") }
    }
    private fun frame(source: ImageReader) {
        val image = try { source.acquireLatestImage() } catch (_: Exception) { null } ?: return
        var bitmap: Bitmap? = null
        try {
            val selected = target ?: return
            val now = SystemClock.elapsedRealtime()
            if (now - lastFrame < 2000 || !busy.compareAndSet(false, true)) return
            lastFrame = now
            val plane = image.planes[0]; val paddedWidth = plane.rowStride / plane.pixelStride
            val padded = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
            try {
                padded.copyPixelsFromBuffer(plane.buffer)
                bitmap = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
                if (bitmap === padded) bitmap = padded.copy(Bitmap.Config.ARGB_8888, true)
            } finally { padded.recycle() }
            val picture = bitmap ?: error("No frame")
            // Do not recursively OCR our own controls. Their covered pixels were not visible to the user.
            val rect = Rect(mask); if (!rect.isEmpty) Canvas(picture).drawRect(rect, Paint().apply { color = Color.BLACK })
            val engine = ocr ?: error("OCR unavailable")
            bitmap = null // ownership transfers until async OCR completion
            val completed = AtomicBoolean(false)
            val watchdog = Runnable {
                if (!completed.get() && !released) end("Local text recognition timed out. Sharing stopped; start again.")
            }
            main.postDelayed(watchdog, 15_000)
            engine.read(picture) { text, error ->
                completed.set(true); main.removeCallbacks(watchdog)
                picture.recycle(); busy.set(false)
                main.post {
                    if (released || target !== selected) return@post
                    if (error != null) { end("Local screen text recognition failed. Start a new session."); return@post }
                    val found = text.orEmpty()
                    if (found != previousText) { previousText = found; CybermanjuScreenReader.text(expected, selected.packageName, found) }
                }
            }
        } catch (_: Exception) { busy.set(false); main.post { end("Screen frame could not be read. Start a new session.") } }
        finally { bitmap?.recycle(); image.close() }
    }
    private fun openCurrent() {
        target = null; previousText = null; sequence++
        val pkg = CybermanjuScreenReader.current() ?: return
        try {
            val launch = packageManager.getLaunchIntentForPackage(pkg) ?: error("App unavailable")
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            // First launch uses the still-visible consent Activity. Later user-tapped
            // Next actions use the visible overlay's background-launch exemption.
            if (!CybermanjuScreenReaderConsentActivity.launch(expected, launch)) startActivity(launch)
            refreshControls()
        } catch (_: Exception) { end("The selected app cannot be opened. Nothing was selected.") }
    }
    private fun showControls() {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(12, 8, 12, 8); setBackgroundColor(0xee202124.toInt()) }
        title = TextView(this).apply { setTextColor(Color.WHITE); textSize = 12f }; panel.addView(title)
        val row = LinearLayout(this); panel.addView(row)
        fun button(label: String, click: () -> Unit): Button = Button(this).apply { text = label; setOnClickListener { click() }; row.addView(this) }
        selectButton = button("Select screen") {
            CybermanjuScreenReader.select(expected)
            if (CybermanjuScreenReader.isReading()) { target = Target(CybermanjuScreenReader.current()!!, ++sequence); previousText = null }
            refreshControls()
        }
        nextButton = button("Next app") {
            target = null
            if (CybermanjuScreenReader.advance(expected)) openCurrent()
        }
        button("Stop") { CybermanjuScreenReader.stop() }
        overlay = panel
        val params = WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL }
        window!!.addView(panel, params); panel.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> updateMask() }; refreshControls()
    }
    private fun refreshControls() {
        title?.text = CybermanjuScreenReader.statusLabel()
        selectButton?.isEnabled = !CybermanjuScreenReader.isReading()
        nextButton?.isEnabled = CybermanjuScreenReader.isReading()
        nextButton?.text = if (CybermanjuScreenReader.isLast()) "Finish" else "Next app"
    }
    private fun updateMask() {
        val view = overlay ?: return; val location = IntArray(2); view.getLocationOnScreen(location)
        val sx = captureWidth.toFloat() / sourceWidth.coerceAtLeast(1); val sy = captureHeight.toFloat() / sourceHeight.coerceAtLeast(1)
        mask = Rect((location[0] * sx).toInt(), (location[1] * sy).toInt(), ((location[0] + view.width) * sx).toInt(), ((location[1] + view.height) * sy).toInt())
    }
    private fun end(error: String? = null) { CybermanjuScreenReader.ended(expected, this, error); shutdown() }
    internal fun shutdown() {
        if (released) return
        released = true; target = null
        if (registeredScreenOff) { try { unregisterReceiver(screenOff) } catch (_: Exception) {}; registeredScreenOff = false }
        if (registeredDisplay) { getSystemService(DisplayManager::class.java).unregisterDisplayListener(displayListener); registeredDisplay = false }
        try { overlay?.let { window?.removeView(it) } } catch (_: Exception) {}; overlay = null
        try { projection?.unregisterCallback(projectionCallback) } catch (_: Exception) {}
        try { display?.surface = null; display?.release() } catch (_: Exception) {}; display = null
        try { reader?.setOnImageAvailableListener(null, null); reader?.close() } catch (_: Exception) {}; reader = null
        try { projection?.stop() } catch (_: Exception) {}; projection = null
        try { ocr?.close() } catch (_: Exception) {}; ocr = null
        worker?.quitSafely(); worker = null; workerHandler = null
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() { CybermanjuScreenReader.ended(expected, this); shutdown(); super.onDestroy() }
    override fun onTaskRemoved(rootIntent: Intent?) { CybermanjuScreenReader.stop(); super.onTaskRemoved(rootIntent) }
}
