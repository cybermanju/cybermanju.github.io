"""CyberManju native host runtime tests using Kotlin/JVM Android doubles, not device tests.

Run with unittest. KOTLIN_LIB may point to a Kotlin compiler distribution's lib
folder; JSON_JAR may point to org.json 20240303. Without JSON_JAR the pinned jar
is retrieved from Maven Central into the temporary test directory.
"""
import glob
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[2]

STUBS = {
"R.kt": '''package android
object R { object id { const val content = 1 } }
''',
"Os.kt": '''package android.os
open class Bundle { fun putInt(key: String, value: Int) {} }
object Build { object VERSION { var SDK_INT = 35 } }
class Looper { companion object { private val loop = Looper(); fun myLooper() = loop; fun getMainLooper() = loop } }
class Handler(loop: Looper) { fun post(task: Runnable): Boolean { task.run(); return true } }
''',
"Context.kt": '''package android.content
import android.app.KeyguardManager
import android.content.pm.PackageManager
class SharedPreferences {
 val values = mutableMapOf<String, Any>()
 fun getString(key: String, default: String?): String? = values[key] as? String ?: default
 fun getInt(key: String, default: Int): Int = values[key] as? Int ?: default
 fun edit() = Editor(this)
 class Editor(val prefs: SharedPreferences) {
  private val next = mutableMapOf<String,Any>()
  fun putString(k:String,v:String): Editor { next[k]=v; return this }
  fun putInt(k:String,v:Int): Editor { next[k]=v; return this }
  fun commit():Boolean { prefs.values.putAll(next); return true }
 }
}
open class Context {
 companion object { const val MODE_PRIVATE=0; const val KEYGUARD_SERVICE="keyguard"; val prefs=SharedPreferences() }
 val resources = Resources(); val packageManager = PackageManager()
 fun getSharedPreferences(name:String, mode:Int)=prefs
 fun getSystemService(name:String):Any? = KeyguardManager()
}
class Resources { val displayMetrics=Metrics() }
class Metrics { var density=1f }
data class ComponentName(val pkg:String,val name:String) {
 fun flattenToString()="$pkg/$name"
 companion object { fun unflattenFromString(s:String):ComponentName? { val p=s.split('/'); return if(p.size==2) ComponentName(p[0],p[1]) else null } }
}
class Intent(val action:String="") {
 val extras=mutableMapOf<String,Any>()
 fun putExtra(key:String,value:Any):Intent { extras[key]=value;return this }
 fun getIntExtra(key:String,default:Int)=extras[key] as? Int ?: default
}
''',
"Pm.kt": '''package android.content.pm
class PackageManager
''',
"Activity.kt": '''package android.app
import android.content.*
import android.os.Bundle
import android.view.*
class KeyguardManager { var isKeyguardLocked=false }
open class Application {
 val callbacks=mutableListOf<ActivityLifecycleCallbacks>()
 fun registerActivityLifecycleCallbacks(c:ActivityLifecycleCallbacks) { callbacks.add(c) }
 fun unregisterActivityLifecycleCallbacks(c:ActivityLifecycleCallbacks) { callbacks.remove(c) }
 interface ActivityLifecycleCallbacks {
  fun onActivityPaused(a:Activity); fun onActivityDestroyed(a:Activity)
  fun onActivityCreated(a:Activity,b:Bundle?); fun onActivityStarted(a:Activity)
  fun onActivityResumed(a:Activity); fun onActivityStopped(a:Activity)
  fun onActivitySaveInstanceState(a:Activity,b:Bundle)
 }
}
open class Activity:Context() {
 companion object { const val RESULT_OK=-1; const val RESULT_CANCELED=0 }
 val application=Application(); val content=ViewGroup(this)
 var isFinishing=false; var isDestroyed=false; var focus=true
 var started:Pair<Intent,Int>?=null
 fun hasWindowFocus()=focus
 @Suppress("UNCHECKED_CAST") fun <T:View> findViewById(id:Int):T = content as T
 fun startActivityForResult(intent:Intent,request:Int) { started=intent to request }
 fun pause() { application.callbacks.toList().forEach { it.onActivityPaused(this) } }
 fun destroy() { isDestroyed=true; application.callbacks.toList().forEach { it.onActivityDestroyed(this) } }
}
''',
"View.kt": '''package android.view
import android.content.Context
open class View(val context:Context) {
 companion object { const val VISIBLE=0; const val GONE=8 }
 var parent:ViewGroup?=null; var visibility=VISIBLE; var width=900; var height=700
 var layoutParams:ViewGroup.LayoutParams?=null; var isClickable=false
}
open class ViewGroup(c:Context):View(c) {
 val children=mutableListOf<View>()
 open class LayoutParams(val width:Int,val height:Int) { companion object { const val MATCH_PARENT=-1 } }
 fun addView(v:View) { children.add(v);v.parent=this }
 fun addView(v:View,p:LayoutParams) { v.layoutParams=p;addView(v) }
 fun removeView(v:View) { children.remove(v);v.parent=null }
}
''',
"Frame.kt": '''package android.widget
import android.content.Context
import android.view.ViewGroup
class FrameLayout(c:Context):ViewGroup(c) {
 class LayoutParams(w:Int,h:Int):ViewGroup.LayoutParams(w,h) { var leftMargin=0;var topMargin=0 }
}
''',
"Widgets.kt": '''package android.appwidget
import android.app.Activity
import android.content.*
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
class AppWidgetProviderInfo {
 companion object { const val WIDGET_CATEGORY_HOME_SCREEN=1 }
 var provider=ComponentName("sample","Widget");var minWidth=100;var minHeight=80
 var maxResizeWidth=0;var maxResizeHeight=0;var resizeMode=3;var configure:ComponentName?=null
 fun loadLabel(pm:PackageManager):CharSequence="Sample widget"
}
class AppWidgetManager {
 companion object {
  const val OPTION_APPWIDGET_HOST_CATEGORY="category"; const val OPTION_APPWIDGET_MIN_WIDTH="minW"
  const val OPTION_APPWIDGET_MAX_WIDTH="maxW";const val OPTION_APPWIDGET_MIN_HEIGHT="minH"
  const val OPTION_APPWIDGET_MAX_HEIGHT="maxH";const val ACTION_APPWIDGET_BIND="bind"
  const val EXTRA_APPWIDGET_ID="id";const val EXTRA_APPWIDGET_PROVIDER="provider";const val EXTRA_APPWIDGET_OPTIONS="options"
  val singleton=AppWidgetManager();fun getInstance(c:Context)=singleton
 }
 val installedProviders=mutableListOf<AppWidgetProviderInfo>(); val bound=mutableMapOf<Int,AppWidgetProviderInfo>()
 var allowed=true
 fun getAppWidgetInfo(id:Int)=bound[id]
 fun bindAppWidgetIdIfAllowed(id:Int,c:ComponentName,b:Bundle):Boolean {
  if(allowed) bound[id]=installedProviders.first { it.provider==c }; return allowed
 }
}
open class AppWidgetHost(c:Context,id:Int) {
 companion object {
  var next=1;val allocated=mutableSetOf<Int>();val deleted=mutableSetOf<Int>()
  var listening=false;var released=0;val made=mutableListOf<AppWidgetHostView>()
 }
 val appWidgetIds:IntArray get()=allocated.toIntArray()
 fun allocateAppWidgetId():Int { val id=next++;allocated.add(id);return id }
 fun deleteAppWidgetId(id:Int) { allocated.remove(id);deleted.add(id);AppWidgetManager.singleton.bound.remove(id) }
 fun deleteHost() { allocated.toList().forEach { deleteAppWidgetId(it) } }
 fun startAppWidgetConfigureActivityForResult(a:Activity,id:Int,flags:Int,request:Int,b:Bundle?) {
  a.started=Intent("configure").putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id) to request
 }
 fun createView(a:Activity,id:Int,info:AppWidgetProviderInfo)=AppWidgetHostView(a).also { made.add(it) }
 fun startListening() { listening=true };fun stopListening() { listening=false }
 protected fun clearViews() { released++ }
}
class AppWidgetHostView(c:Context):View(c) { fun updateAppWidgetSize(b:Bundle,a:Int,c:Int,d:Int,e:Int) {} }
'''
}

HARNESS = r'''package runtime.widgets
import android.app.*
import android.appwidget.*
import android.content.*
import android.view.*
import org.json.JSONObject
fun main(args:Array<String>) {
 val a=Activity();val m=AppWidgetManager.singleton
 val info=AppWidgetProviderInfo();m.installedProviders.add(info)
 fun auth()=JSONObject().put("userInitiated",true).put("expiresAt",System.currentTimeMillis()+4000)
 fun call(action:String,p:JSONObject=JSONObject(),owner:Activity=a):JSONObject = JSONObject(CybermanjuWidgets.dispatch(owner,action,p.toString()))
 fun add(placement:String="slot"):Int {
  val out=call("add",auth().put("provider",info.provider.flattenToString()).put("placementId",placement))
  check(out.optBoolean("ok")) { out.toString() };return out.getInt("appWidgetId")
 }
 fun widgets(owner:Activity=a)=call("list",owner=owner).getJSONArray("widgets")
 fun layout(id:Int)=call("layout",JSONObject().put("appWidgetId",id).put("visible",true)
  .put("xDp",0).put("yDp",0).put("widthDp",200).put("heightDp",100).put("workspaceId","workspace-2"))
 when(args.single()) {
  "ready-remove" -> { val id=add();check(widgets().getJSONObject(0).getString("state")=="ready")
   check(call("remove",auth().put("appWidgetId",id)).getBoolean("ok"));check(widgets().length()==0)
   check(id in AppWidgetHost.deleted && id !in AppWidgetHost.allocated) }
  "bind-denied" -> { m.allowed=false;val id=add();val request=a.started!!.second
   check(CybermanjuWidgets.onActivityResult(a,request,Activity.RESULT_CANCELED,null))
   check(widgets().length()==0 && id in AppWidgetHost.deleted)
   check(!CybermanjuWidgets.onActivityResult(a,request,Activity.RESULT_OK,null)) }
  "bind-approved" -> { m.allowed=false;val id=add();val request=a.started!!.second;m.bound[id]=info
   check(CybermanjuWidgets.onActivityResult(a,request,Activity.RESULT_OK,Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id)))
   check(widgets().getJSONObject(0).getString("state")=="ready") }
  "config-cancel" -> { info.configure=ComponentName("sample","Configure");val id=add();val request=a.started!!.second
   check(widgets().getJSONObject(0).getString("state")=="configuring")
   CybermanjuWidgets.onActivityResult(a,request,Activity.RESULT_CANCELED,null)
   check(widgets().length()==0 && id in AppWidgetHost.deleted) }
  "wrong-result-id" -> { m.allowed=false;val id=add();val request=a.started!!.second;m.bound[id]=info
   CybermanjuWidgets.onActivityResult(a,request,Activity.RESULT_OK,Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id+1))
   check(widgets().length()==0 && id in AppWidgetHost.deleted) }
  "recreation" -> { m.allowed=false;val id=add();val request=a.started!!.second;a.destroy();val b=Activity()
   check(widgets(b).getJSONObject(0).getInt("appWidgetId")==id);m.bound[id]=info
   CybermanjuWidgets.onActivityResult(b,request,Activity.RESULT_OK,null)
   check(widgets(b).getJSONObject(0).getString("state")=="ready") }
  "lifecycle" -> { val id=add();check(layout(id).getBoolean("ok"));check(AppWidgetHost.listening)
   val view=AppWidgetHost.made.single();check(view.visibility==View.VISIBLE)
   a.pause();check(view.visibility==View.GONE && !AppWidgetHost.listening)
   check(layout(id).getBoolean("ok"));a.destroy();check(AppWidgetHost.released==1)
   check(id in AppWidgetHost.allocated && a.application.callbacks.isEmpty()) }
  "security" -> { val id=add()
   check(call("remove",auth().put("appWidgetId",id+99)).getString("error").startsWith("not_found:"))
   check(call("remove",auth().put("expiresAt",0).put("appWidgetId",id)).getString("error").startsWith("auth:"))
   a.focus=false;check(call("list").getString("error").startsWith("auth:"));a.focus=true
   check(widgets().length()==1)
   check(!CybermanjuWidgets.onActivityResult(a,123,Activity.RESULT_OK,null)) }
  "reconfigure-cancel" -> { val id=add();info.configure=ComponentName("sample","Configure")
   check(call("configure",auth().put("appWidgetId",id)).getBoolean("ok"))
   check(call("cancel",auth().put("appWidgetId",id)).getBoolean("ok"))
   check(widgets().getJSONObject(0).getString("state")=="ready" && id in AppWidgetHost.allocated) }
  "orphan-recovery" -> { AppWidgetHost.allocated.add(900);call("list");check(900 in AppWidgetHost.deleted) }
  "bounds-and-persistence" -> { val id=add();check(layout(id).getBoolean("ok"))
   val r=widgets().getJSONObject(0);check(r.getString("workspaceId")=="workspace-2" && r.getInt("widthDp")==200)
   val invalid=JSONObject().put("appWidgetId",id).put("visible",true).put("xDp",899).put("yDp",0).put("widthDp",200).put("heightDp",100)
   check(call("layout",invalid).getString("error").startsWith("invalid:"))
   a.destroy();val b=Activity();check(widgets(b).getJSONObject(0).getInt("appWidgetId")==id) }
  else -> error("unknown case")
 }
 println("PASS "+args.single())
}
'''


class WidgetRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        candidates = [os.environ.get("KOTLIN_LIB", "")] + glob.glob(str(Path.home() / ".gradle/wrapper/dists/gradle-*-all/*/gradle-*/lib"))
        lib = next((Path(p) for p in candidates if p and list(Path(p).glob("kotlin-compiler-embeddable-*.jar"))), None)
        if lib is None or not shutil.which("java"):
            if os.environ.get("REQUIRE_KOTLIN_COMPILER") == "1":
                raise AssertionError("Java and Kotlin compiler required; set KOTLIN_LIB")
            raise unittest.SkipTest("Java and Kotlin compiler required; set KOTLIN_LIB")
        cls.temp = tempfile.TemporaryDirectory(prefix="widget-host-runtime-")
        cls.addClassCleanup(cls.temp.cleanup)
        base = Path(cls.temp.name)
        jar = Path(os.environ["JSON_JAR"]) if os.environ.get("JSON_JAR") else base / "json.jar"
        if not jar.exists():
            urllib.request.urlretrieve("https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar", jar)
        if hashlib.sha256(jar.read_bytes()).hexdigest() != "3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed":
            raise AssertionError("org.json runtime dependency checksum mismatch")
        for name, source in STUBS.items():
            (base / name).write_text(source)
        (base / "CybermanjuWidgets.kt").write_text((ROOT / "native/android/CybermanjuWidgets.kt").read_text().replace("__PACKAGE__", "runtime.widgets"))
        (base / "Harness.kt").write_text(HARNESS)
        stdlib = next(lib.glob("kotlin-stdlib-[0-9]*.jar"))
        annotations = next(lib.glob("annotations-*.jar"))
        cls.classpath = f"{base / 'runtime.jar'}:{jar}:{stdlib}"
        cmd = ["java", "-cp", f"{lib}/*", "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect", "-jvm-target", "1.8", "-classpath", f"{jar}:{stdlib}:{annotations}", "-d", str(base / "runtime.jar")] + [str(p) for p in base.glob("*.kt")]
        result = subprocess.run(cmd, text=True, capture_output=True, timeout=120)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    def test_host_state_lifecycle_security_and_recovery(self):
        for case in ("ready-remove", "bind-denied", "bind-approved", "config-cancel", "wrong-result-id", "recreation", "lifecycle", "security", "reconfigure-cancel", "orphan-recovery", "bounds-and-persistence"):
            with self.subTest(case=case):
                result = subprocess.run(["java", "-cp", self.classpath, "runtime.widgets.HarnessKt", case], text=True, capture_output=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PASS " + case, result.stdout)


if __name__ == "__main__":
    unittest.main()
