// CyberManju OS — native Android widget host (native/android/CybermanjuWidgets.kt).
// Role: Own RemoteViews, explicit bind/configure approval and stable placement/ID storage.
// Exports: dispatch and onActivityResult via generated MainActivity; no DOM rendering or system overlays.
// Contracts: UI-thread only; foreground unlocked activity; hidden until each explicit layout; no OS gesture interception.
package __PACKAGE__

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetHostView
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.WeakHashMap
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

private class WidgetFailure(message: String) : RuntimeException(message)
private fun widgetRequire(condition: Boolean, message: () -> String) { if (!condition) throw WidgetFailure(message()) }
private fun widgetFail(message: String): Nothing = throw WidgetFailure(message)
private class WidgetHost(context: Context, id: Int) : AppWidgetHost(context, id) {
    fun releaseViews() { clearViews() }
}

class CybermanjuWidgets private constructor(private val activity: Activity) : Application.ActivityLifecycleCallbacks {
    private val manager = AppWidgetManager.getInstance(activity)
    private val host = WidgetHost(activity, HOST_ID)
    private val prefs = activity.getSharedPreferences("cybermanju.widgets.v1", Context.MODE_PRIVATE)
    private val records = JSONObject(prefs.getString("records", "{}") ?: "{}")
    private val views = mutableMapOf<Int, AppWidgetHostView>()
    private var layer: FrameLayout? = null
    private var listening = false

    init {
        // Recover the small allocate-before-journal crash window without touching saved IDs.
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            host.appWidgetIds.filter { !records.has(it.toString()) }.forEach { host.deleteAppWidgetId(it) }
        } else if (records.length() == 0) host.deleteHost()
        activity.application.registerActivityLifecycleCallbacks(this)
    }

    private fun save() {
        widgetRequire(prefs.edit().putString("records", records.toString()).commit()) { "storage: widget state could not be saved" }
    }
    private fun record(id: Int): JSONObject = records.optJSONObject(id.toString())
        ?: widgetFail("not_found: widget is not owned by this host")
    private fun persist(id: Int, value: JSONObject) { records.put(id.toString(), value); save() }
    private fun pending(): Int? = records.keys().asSequence().map { it.toInt() }
        .firstOrNull { record(it).optString("state") != "ready" }
    private fun delete(id: Int) {
        record(id)
        views.remove(id)?.let { (it.parent as? ViewGroup)?.removeView(it) }
        // Delete platform ID first: a crash leaves a removable stale record, not an orphan platform ID.
        host.deleteAppWidgetId(id)
        records.remove(id.toString())
        save()
    }
    private fun nextRequest(): Int {
        val code = (prefs.getInt("request", 20000) + 1).let { if (it > 60000) 20001 else it }
        widgetRequire(prefs.edit().putInt("request", code).commit()) { "storage: request could not be saved" }
        return code
    }
    private fun options(width: Int, height: Int) = Bundle().apply {
        putInt(AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY, android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN)
        putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, width)
        putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, width)
        putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, height)
        putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, height)
    }
    private fun providers(): JSONArray {
        val density = activity.resources.displayMetrics.density
        return JSONArray().apply {
            manager.installedProviders.sortedBy { it.loadLabel(activity.packageManager).toString() }.forEach { info ->
                put(JSONObject().put("provider", info.provider.flattenToString())
                    .put("label", info.loadLabel(activity.packageManager).toString())
                    .put("minWidthDp", (info.minWidth / density).toDouble())
                    .put("minHeightDp", (info.minHeight / density).toDouble())
                    .put("resizeMode", info.resizeMode).put("configurable", info.configure != null))
            }
        }
    }
    private fun list(): JSONArray = JSONArray().apply {
        records.keys().asSequence().toList().forEach { key ->
            val r = JSONObject(records.getJSONObject(key).toString())
            r.put("appWidgetId", key.toInt())
            r.put("providerAvailable", manager.getAppWidgetInfo(key.toInt()) != null)
            put(r)
        }
    }
    private fun configure(id: Int, reconfigure: Boolean = false) {
        val r = record(id)
        val info = manager.getAppWidgetInfo(id) ?: widgetFail("not_found: widget provider unavailable")
        if (info.configure == null) {
            r.put("state", "ready"); r.remove("requestCode"); r.remove("reconfigure")
            persist(id, r)
            return
        }
        val request = nextRequest()
        r.put("state", "configuring").put("requestCode", request).put("reconfigure", reconfigure)
        persist(id, r)
        try {
            host.startAppWidgetConfigureActivityForResult(activity, id, 0, request, null)
        } catch (_: Exception) {
            if (reconfigure) { r.put("state", "ready"); r.remove("requestCode"); r.remove("reconfigure"); persist(id, r) }
            else delete(id)
            widgetFail("unavailable: widget configuration could not open")
        }
    }
    private fun add(p: JSONObject): Int {
        widgetRequire(pending() == null) { "conflict: finish or cancel the pending widget first" }
        widgetRequire(records.length() < 128) { "invalid: widget host limit reached" }
        val component = ComponentName.unflattenFromString(p.getString("provider"))
            ?: widgetFail("invalid: provider component required")
        val info = manager.installedProviders.firstOrNull { it.provider == component }
            ?: widgetFail("not_found: installed widget provider unavailable")
        val placement = p.getString("placementId")
        widgetRequire(placement.length in 1..128 && !placement.any { it.isISOControl() }) { "invalid: placementId required" }
        widgetRequire(records.keys().asSequence().none { records.getJSONObject(it).optString("placementId") == placement }) {
            "conflict: placementId already exists; use list to recover"
        }
        val id = host.allocateAppWidgetId()
        val density = activity.resources.displayMetrics.density
        val r = JSONObject().put("provider", component.flattenToString()).put("placementId", placement)
            .put("state", "binding").put("widthDp", maxOf(1, (info.minWidth / density).roundToInt()))
            .put("heightDp", maxOf(1, (info.minHeight / density).roundToInt()))
        try {
            persist(id, r)
            val opts = options(r.getInt("widthDp"), r.getInt("heightDp"))
            if (manager.bindAppWidgetIdIfAllowed(id, component, opts)) configure(id)
            else {
                val request = nextRequest()
                r.put("requestCode", request); persist(id, r)
                activity.startActivityForResult(Intent(AppWidgetManager.ACTION_APPWIDGET_BIND)
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_PROVIDER, component)
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_OPTIONS, opts), request)
            }
            return id
        } catch (e: Exception) {
            // Includes denied/missing bind activities and persistence failure after allocation.
            host.deleteAppWidgetId(id)
            records.remove(id.toString()); save()
            throw e
        }
    }
    private fun result(request: Int, result: Int, data: Intent?): Boolean {
        val id = records.keys().asSequence().map { it.toInt() }.firstOrNull {
            record(it).optInt("requestCode", -1) == request
        } ?: return false
        val r = record(id)
        val returnedId = data?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id) ?: id
        val accepted = result == Activity.RESULT_OK && returnedId == id &&
            manager.getAppWidgetInfo(id)?.provider?.flattenToString() == r.getString("provider")
        if (r.optString("state") == "binding") {
            if (!accepted) delete(id) else try { configure(id) } catch (_: Exception) {
                // Provider disappearance/launch/persistence failure must not strand a newly bound ID.
                if (records.has(id.toString())) delete(id)
            }
        } else if (accepted || r.optBoolean("reconfigure")) {
            r.put("state", "ready"); r.remove("requestCode"); r.remove("reconfigure"); persist(id, r)
        } else delete(id)
        return true
    }
    private fun content(): ViewGroup = activity.findViewById(android.R.id.content)
    private fun overlay(): FrameLayout = layer ?: FrameLayout(activity).also {
        // A non-clickable ViewGroup only consumes touch inside its widget children.
        it.isClickable = false
        content().addView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        layer = it
    }
    private fun layout(p: JSONObject) {
        val id = p.getInt("appWidgetId")
        val r = record(id)
        widgetRequire(r.getString("state") == "ready") { "conflict: widget is not configured yet" }
        if (!p.optBoolean("visible", false)) {
            views[id]?.visibility = View.GONE
            if (listening && views.values.none { it.visibility == View.VISIBLE }) { host.stopListening(); listening = false }
            return
        }
        val info = manager.getAppWidgetInfo(id) ?: widgetFail("not_found: widget provider unavailable")
        widgetRequire(info.provider.flattenToString() == r.getString("provider")) { "integrity: widget provider changed" }
        // Coordinates are physical-independent dp relative to android.R.id.content, NOT absolute screen pixels.
        fun dimension(name: String): Double = p.getDouble(name).also { widgetRequire(it.isFinite()) { "invalid: finite bounds required" } }
        val x = dimension("xDp"); val y = dimension("yDp")
        val width = dimension("widthDp"); val height = dimension("heightDp")
        val parent = content(); val density = activity.resources.displayMetrics.density
        widgetRequire(x >= 0 && y >= 0 && width >= 1 && height >= 1 &&
            (x + width) * density <= parent.width + 1 && (y + height) * density <= parent.height + 1) {
            "invalid: widget bounds must fit the native content viewport"
        }
        widgetRequire(width * density >= info.minWidth && height * density >= info.minHeight) { "invalid: widget is smaller than provider minimum" }
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            widgetRequire((info.maxResizeWidth <= 0 || width * density <= info.maxResizeWidth) &&
                (info.maxResizeHeight <= 0 || height * density <= info.maxResizeHeight)) { "invalid: widget exceeds provider maximum" }
        }
        val workspace = p.optString("workspaceId", r.optString("workspaceId", "home"))
        widgetRequire(workspace.length in 1..128) { "invalid: workspaceId required" }
        val container = overlay()
        val view = views[id] ?: host.createView(activity, id, info).also { views[id] = it; container.addView(it) }
        view.layoutParams = FrameLayout.LayoutParams((width * density).roundToInt(), (height * density).roundToInt()).apply {
            leftMargin = (x * density).roundToInt(); topMargin = (y * density).roundToInt()
        }
        view.visibility = View.VISIBLE
        val w = width.roundToInt(); val h = height.roundToInt()
        if (r.optInt("widthDp") != w || r.optInt("heightDp") != h) {
            view.updateAppWidgetSize(options(w, h), w, h, w, h)
        }
        // Persist logical placement and last size, never transient visibility/animation frames.
        if (r.optDouble("xDp", -1.0) != x || r.optDouble("yDp", -1.0) != y ||
            r.optInt("widthDp") != w || r.optInt("heightDp") != h || r.optString("workspaceId") != workspace) {
            r.put("xDp", x).put("yDp", y).put("widthDp", w).put("heightDp", h).put("workspaceId", workspace)
            persist(id, r)
        }
        if (!listening) { host.startListening(); listening = true }
    }
    private fun hide() { views.values.forEach { it.visibility = View.GONE }; if (listening) { host.stopListening(); listening = false } }
    private fun handle(action: String, p: JSONObject): JSONObject {
        val out = JSONObject().put("ok", true).put("action", action)
        when (action) {
            "providers" -> out.put("providers", providers())
            "list" -> out.put("widgets", list())
            "add" -> out.put("appWidgetId", add(p))
            "configure" -> {
                widgetRequire(pending() == null) { "conflict: finish or cancel the pending widget first" }
                configure(p.getInt("appWidgetId"), true)
            }
            "layout" -> layout(p)
            "hide" -> hide()
            "remove", "cancel" -> {
                val id = p.getInt("appWidgetId")
                if (action == "cancel") widgetRequire(record(id).optString("state") != "ready") { "conflict: widget is not pending" }
                if (action == "cancel" && record(id).optBoolean("reconfigure")) {
                    val r = record(id); r.put("state", "ready"); r.remove("requestCode"); r.remove("reconfigure"); persist(id, r)
                } else delete(id)
            }
            else -> widgetFail("unsupported: unknown widget action")
        }
        val parent = content()
        out.put("viewport", JSONObject().put("widthDp", (parent.width / activity.resources.displayMetrics.density).toDouble())
            .put("heightDp", (parent.height / activity.resources.displayMetrics.density).toDouble()))
        return out
    }
    override fun onActivityPaused(a: Activity) { if (a === activity) hide() }
    override fun onActivityDestroyed(a: Activity) {
        if (a !== activity) return
        hide(); host.releaseViews(); views.clear()
        layer?.let { (it.parent as? ViewGroup)?.removeView(it) }; layer = null
        activity.application.unregisterActivityLifecycleCallbacks(this)
        sessions.remove(activity)
    }
    override fun onActivityCreated(a: Activity, b: Bundle?) {}
    override fun onActivityStarted(a: Activity) {}
    override fun onActivityResumed(a: Activity) {} // UI must re-layout; never show a stale screen after resume.
    override fun onActivityStopped(a: Activity) { if (a === activity) hide() }
    override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}

    companion object {
        private const val HOST_ID = 0x43594D57
        // Values are weak too: a WeakHashMap with strong values capturing Activity would leak it.
        private val sessions = WeakHashMap<Activity, WeakReference<CybermanjuWidgets>>()
        private val main = Handler(Looper.getMainLooper())
        private fun session(a: Activity): CybermanjuWidgets = sessions[a]?.get() ?: CybermanjuWidgets(a).also {
            sessions[a] = WeakReference(it)
        }
        private fun failure(message: String) = JSONObject().put("error", message).toString()
        @JvmStatic fun dispatch(a: Activity, action: String, payload: String): String {
            val task = FutureTask<String> {
                try {
                    widgetRequire(payload.length <= 65536) { "invalid: widget payload too large" }
                    val p = JSONObject(payload)
                    val keyguard = a.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                    widgetRequire(!a.isDestroyed && !a.isFinishing && a.hasWindowFocus() && keyguard != null && !keyguard.isKeyguardLocked) {
                        "auth: widget actions require the unlocked foreground app"
                    }
                    if (action in setOf("add", "configure", "remove", "cancel")) {
                        val expiry = p.opt("expiresAt"); val now = System.currentTimeMillis()
                        widgetRequire(p.opt("userInitiated") == true && expiry is Number && expiry.toLong() > now && expiry.toLong() <= now + 5000) {
                            "auth: fresh explicit widget action required"
                        }
                    }
                    session(a).handle(action, p).toString()
                } catch (e: Exception) {
                    // Never return platform/provider/JSON exception messages across the bridge.
                    failure(if (e is WidgetFailure) e.message.orEmpty() else "unavailable: native widget operation failed")
                }
            }
            if (Looper.myLooper() == Looper.getMainLooper()) task.run() else if (!main.post(task)) return failure("unavailable: Android UI unavailable")
            return try { task.get(3, TimeUnit.SECONDS) } catch (_: Exception) {
                task.cancel(false)
                failure("conflict: widget result uncertain; recover using list before retrying")
            }
        }
        @JvmStatic fun onActivityResult(a: Activity, request: Int, result: Int, data: Intent?): Boolean =
            try { session(a).result(request, result, data) } catch (_: Exception) { false }
    }
}
