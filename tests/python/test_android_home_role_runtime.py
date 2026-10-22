#!/usr/bin/env python3
# CyberManju OS — HOME role native bridge regressions (tests/python/test_android_home_role_runtime.py).
# Role: execute the real Kotlin bridge against deterministic Android/WebView doubles.
# Exports: unittest suite for lifecycle, callback handshake, recovery and API-level behavior.
# Integrates: CybermanjuHomeRole.kt and the cached Gradle Kotlin compiler.
# Contracts: tests are JVM simulations, not Android-device tests; user/system consent remains external.
import glob
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

STUBS = {
    "Os.kt": '''package android.os
object Build { object VERSION { var SDK_INT = 34 }; object VERSION_CODES { const val N=24; const val Q=29 } }
class Looper { companion object { private val main=Looper(); fun myLooper()=main; fun getMainLooper()=main } }
class Handler(loop:Looper) {
 companion object { val queue=mutableListOf<Runnable>(); fun step() { check(queue.isNotEmpty()) { "no queued handler work" }; queue.removeAt(0).run() } }
 fun post(r:Runnable):Boolean { queue.add(r); return true }
 fun postDelayed(r:Runnable,delay:Long):Boolean { queue.add(r); return true }
 fun removeCallbacks(r:Runnable) { queue.removeAll { it===r } }
}
''',
    "Base64.kt": '''package android.util
object Base64 { const val NO_WRAP=2; fun encodeToString(b:ByteArray,flags:Int)=java.util.Base64.getEncoder().encodeToString(b); fun decode(s:String,flags:Int)=java.util.Base64.getDecoder().decode(s) }
''',
    "Intent.kt": '''package android.content
class Intent(val action:String) {
 private val cats=mutableSetOf<String>()
 fun addCategory(value:String):Intent { cats.add(value); return this }
 fun hasCategory(value:String)=cats.contains(value)
 companion object { const val ACTION_MAIN="android.intent.action.MAIN"; const val CATEGORY_HOME="android.intent.category.HOME" }
}
class ActivityNotFoundException(message:String="not found"):RuntimeException(message)
class SharedPreferences {
 private val values=mutableMapOf<String,Any>()
 fun getString(k:String,d:String?):String?=values[k] as? String ?: d
 fun getBoolean(k:String,d:Boolean)=values[k] as? Boolean ?: d
 fun edit()=Editor(values)
 class Editor(private val values:MutableMap<String,Any>) {
  private val puts=mutableMapOf<String,Any>(); private val removes=mutableSetOf<String>()
  fun putString(k:String,v:String):Editor { puts[k]=v; removes.remove(k); return this }
  fun putBoolean(k:String,v:Boolean):Editor { puts[k]=v; removes.remove(k); return this }
  fun remove(k:String):Editor { removes.add(k); puts.remove(k); return this }
  fun commit():Boolean { removes.forEach(values::remove); values.putAll(puts); return true }
 }
}
open class Context {
 companion object { const val MODE_PRIVATE=0; const val KEYGUARD_SERVICE="keyguard"; private val prefs=mutableMapOf<String,SharedPreferences>() }
 open val packageName="com.cybermanju.os"
 open val packageManager=android.content.pm.PackageManager()
 open fun getSharedPreferences(name:String,mode:Int)=prefs.getOrPut(name){SharedPreferences()}
 open fun getSystemService(name:String):Any?=android.app.KeyguardManager()
 open fun <T> getSystemService(type:Class<T>):T?=null
}
''',
    "PackageManager.kt": '''package android.content.pm
import android.content.Intent
class ActivityInfo(var packageName:String="",var name:String="")
class ResolveInfo(var activityInfo:ActivityInfo?=null)
class PackageManager {
 companion object { const val MATCH_DEFAULT_ONLY=0x00010000 }
 var homePackage:String?="android"; var homeClass="com.android.internal.app.ResolverActivity"
 var homeSettingsAvailable=true; var defaultAppsAvailable=true; var failResolveAction:String?=null
 fun resolveActivity(intent:Intent,flags:Int):ResolveInfo? {
  if(intent.action==failResolveAction) throw SecurityException("resolution blocked")
  if(intent.action=="android.intent.action.MAIN" && intent.hasCategory("android.intent.category.HOME"))
   return homePackage?.let { ResolveInfo(ActivityInfo(it,homeClass)) }
  if(intent.action=="android.settings.HOME_SETTINGS" && homeSettingsAvailable) return ResolveInfo(ActivityInfo("com.android.settings","SettingsActivity"))
  if(intent.action=="android.settings.MANAGE_DEFAULT_APPS_SETTINGS" && defaultAppsAvailable) return ResolveInfo(ActivityInfo("com.android.settings","SettingsActivity"))
  return null
 }
}
''',
    "RoleManager.kt": '''package android.app.role
import android.content.Intent
class RoleManager {
 var available=true; var held=false
 fun isRoleAvailable(role:String)=available
 fun isRoleHeld(role:String)=held
 fun createRequestRoleIntent(role:String)=Intent("role:$role")
 companion object { const val ROLE_HOME="android.app.role.HOME" }
}
''',
    "Settings.kt": '''package android.provider
object Settings { const val ACTION_HOME_SETTINGS="android.settings.HOME_SETTINGS"; const val ACTION_MANAGE_DEFAULT_APPS_SETTINGS="android.settings.MANAGE_DEFAULT_APPS_SETTINGS" }
''',
    "Activity.kt": '''package android.app
import android.content.*
import android.app.role.RoleManager
class KeyguardManager { var isKeyguardLocked=false }
open class Activity:Context() {
 var isFinishing=false; var isDestroyed=false; var focused=true
 var launched:Intent?=null; var forResult:Pair<Intent,Int>?=null
 var failAction:String?=null; var launchFailure:RuntimeException?=null; var onLaunchFailure:(()->Unit)?=null
 val roleManager=RoleManager()
 fun hasWindowFocus()=focused
 override fun getSystemService(name:String):Any?=if(name==KEYGUARD_SERVICE) KeyguardManager() else null
 @Suppress("UNCHECKED_CAST") override fun <T> getSystemService(type:Class<T>):T?=if(type==RoleManager::class.java) roleManager as T else null
 fun startActivity(intent:Intent) { if(intent.action==failAction) { onLaunchFailure?.invoke(); throw (launchFailure ?: SecurityException("blocked")) }; launched=intent }
 fun startActivityForResult(intent:Intent,requestCode:Int) { forResult=intent to requestCode }
}
''',
    "WebView.kt": '''package android.webkit
import android.util.Base64
import org.json.JSONObject
class WebView {
 var ready=false; var ackMode="match"; var evaluations=0; var events=0
 var delayCallback=false; val pendingCallbacks=mutableListOf<()->Unit>()
 private val detail=Regex("JSON\\\\.parse\\\\(atob\\\\('([^']+)'\\\\)\\\\)")
 private val expected=Regex("window\\\\.__CYBERMANJU_HOME_ROLE_ACKED__===atob\\\\('([^']+)'\\\\)")
 fun evaluateJavascript(script:String,callback:(String)->Unit) {
  evaluations++
  if(!ready) { respond(callback,"false"); return }
  val encoded=detail.find(script)?.groupValues?.get(1) ?: error("missing encoded event detail")
  val value=JSONObject(String(Base64.decode(encoded,Base64.NO_WRAP),Charsets.UTF_8))
  events++
  val expectedId=String(Base64.decode(expected.find(script)?.groupValues?.get(1) ?: error("missing ACK correlation"),Base64.NO_WRAP),Charsets.UTF_8)
  val acknowledged=ackMode=="match" && value.getString("requestId")==expectedId
  respond(callback,if(acknowledged) "true" else "false")
 }
 private fun respond(callback:(String)->Unit,value:String) { if(delayCallback) pendingCallbacks.add { callback(value) } else callback(value) }
 fun completeCallback() { check(pendingCallbacks.isNotEmpty()); pendingCallbacks.removeAt(0).invoke() }
}
''',
    "Json.kt": '''package org.json
class JSONObject {
 private val values=linkedMapOf<String,Any?>()
 constructor()
 constructor(raw:String) {
  val text=raw.trim(); require(text.startsWith("{") && text.endsWith("}"))
  val pattern=Regex("\\\"([^\\\"]+)\\\"\\\\s*:\\\\s*\\\"([^\\\"]*)\\\"")
  pattern.findAll(text).forEach { values[it.groupValues[1]]=it.groupValues[2] }
 }
 fun put(key:String,value:Any?):JSONObject { values[key]=value; return this }
 fun has(key:String)=values.containsKey(key)
 fun length()=values.size
 fun optString(key:String,default:String="")=values[key] as? String ?: default
 fun getString(key:String)=values[key] as? String ?: error("missing $key")
 override fun toString()="{"+values.entries.joinToString(",") { "\\\"${it.key}\\\":\\\"${it.value}\\\"" }+"}"
}
''',
}

HARNESS = '''package regression
import android.app.Activity
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.os.Build
import android.os.Handler
import android.webkit.WebView
import org.json.JSONObject
import com.cybermanju.os.CybermanjuHomeRole

private const val ID="baddcafe-0011-4234-aabc-0123456789ab"
private fun start(a:Activity):JSONObject = JSONObject(CybermanjuHomeRole.dispatch(a,"request",JSONObject().put("requestId",ID).toString()))
private fun status(a:Activity)=JSONObject(CybermanjuHomeRole.dispatch(a,"status","{}"))
fun main(args:Array<String>) {
 when(args.single()) {
  "late-listener" -> {
   val a=Activity(); val web=WebView(); CybermanjuHomeRole.onWebViewCreated(a,web); CybermanjuHomeRole.onResume(a,web)
   check(start(a).getString("state")=="pending"); CybermanjuHomeRole.onPause(a); CybermanjuHomeRole.onResume(a,web)
   Handler.step(); check(web.events==0); check(status(a).getString("pendingRequestId")==ID)
   web.ready=true; Handler.step(); check(web.events==1); check(!status(a).has("pendingRequestId"))
  }
  "mismatched-ack" -> {
   val a=Activity(); val web=WebView(); web.ready=true; web.ackMode="mismatch"
   CybermanjuHomeRole.onWebViewCreated(a,web); CybermanjuHomeRole.onResume(a,web); check(start(a).getString("state")=="pending")
   CybermanjuHomeRole.onPause(a); CybermanjuHomeRole.onResume(a,web); Handler.step()
   check(web.events==1); check(status(a).getString("pendingRequestId")==ID)
   web.ackMode="match"; Handler.step(); check(web.events==2); check(!status(a).has("pendingRequestId"))
  }
  "process-recreation" -> {
   val a=Activity(); val old=WebView(); old.ready=false; CybermanjuHomeRole.onWebViewCreated(a,old); CybermanjuHomeRole.onResume(a,old)
   check(start(a).getString("state")=="pending"); CybermanjuHomeRole.onPause(a); CybermanjuHomeRole.onDestroy(a)
   val b=Activity(); val web=WebView(); web.ready=true; CybermanjuHomeRole.onWebViewCreated(b,web)
   check(status(b).getString("pendingRequestId")==ID); CybermanjuHomeRole.onResume(b,web); Handler.step()
   check(web.events==1); check(!status(b).has("pendingRequestId"))
  }
  "api24-fallback" -> {
   Build.VERSION.SDK_INT=24; val a=Activity(); val web=WebView(); a.packageManager.homePackage="other.launcher"; a.packageManager.homeClass="other.launcher.HomeActivity"
   a.packageManager.homeSettingsAvailable=false
   CybermanjuHomeRole.onWebViewCreated(a,web); CybermanjuHomeRole.onResume(a,web)
   check(status(a).getString("state")=="not_held")
   check(start(a).getString("state")=="pending"); check(a.launched?.action=="android.settings.MANAGE_DEFAULT_APPS_SETTINGS")
   web.ready=true; CybermanjuHomeRole.onPause(a); CybermanjuHomeRole.onResume(a,web); Handler.step()
   check(web.events==1); check(status(a).getString("state")=="not_held")
  }
  "webview-replaced-async" -> {
   val a=Activity(); val old=WebView(); old.ready=true; old.delayCallback=true
   CybermanjuHomeRole.onWebViewCreated(a,old); CybermanjuHomeRole.onResume(a,old)
   check(start(a).getString("state")=="pending"); CybermanjuHomeRole.onPause(a); CybermanjuHomeRole.onResume(a,old)
   Handler.step(); check(old.pendingCallbacks.size==1)
   val replacement=WebView(); replacement.ready=true; CybermanjuHomeRole.onWebViewCreated(a,replacement)
   Handler.step(); check(replacement.events==1); check(!status(a).has("pendingRequestId"))
   old.completeCallback(); check(!status(a).has("pendingRequestId"))
  }
  "settings-security-failure" -> {
   Build.VERSION.SDK_INT=24; val a=Activity(); val web=WebView(); a.packageManager.homePackage="other.launcher"; a.packageManager.homeClass="other.launcher.HomeActivity"
   CybermanjuHomeRole.onWebViewCreated(a,web); CybermanjuHomeRole.onResume(a,web)
   a.failAction="android.settings.HOME_SETTINGS"; a.launchFailure=SecurityException("denied")
   check(start(a).getString("state")=="failed"); check(a.launched==null)
   check(!status(a).has("pendingRequestId"))
  }
  "settings-activity-not-found" -> {
   Build.VERSION.SDK_INT=24
   val disappeared=Activity(); disappeared.packageManager.homePackage="other.launcher"; disappeared.packageManager.homeClass="other.launcher.HomeActivity"
   CybermanjuHomeRole.onResume(disappeared,null)
   disappeared.failAction="android.settings.HOME_SETTINGS"; disappeared.launchFailure=ActivityNotFoundException()
   disappeared.onLaunchFailure={ disappeared.packageManager.homeSettingsAvailable=false }
   check(start(disappeared).getString("state")=="pending")
   check(disappeared.launched?.action=="android.settings.MANAGE_DEFAULT_APPS_SETTINGS")

   val stillResolvable=Activity(); stillResolvable.packageManager.homePackage="other.launcher"; stillResolvable.packageManager.homeClass="other.launcher.HomeActivity"
   stillResolvable.getSharedPreferences("cybermanju.home.role.v1",0).edit().remove("pendingRequestId").remove("leftForSystem").commit()
   CybermanjuHomeRole.onResume(stillResolvable,null)
   stillResolvable.failAction="android.settings.HOME_SETTINGS"; stillResolvable.launchFailure=ActivityNotFoundException()
   check(start(stillResolvable).getString("state")=="failed"); check(stillResolvable.launched==null)
   check(!status(stillResolvable).has("pendingRequestId"))
  }
  "settings-resolution-failure" -> {
   Build.VERSION.SDK_INT=24; val a=Activity(); a.packageManager.failResolveAction="android.settings.HOME_SETTINGS"
   a.packageManager.homePackage="other.launcher"; a.packageManager.homeClass="other.launcher.HomeActivity"
   CybermanjuHomeRole.onResume(a,null)
   check(start(a).getString("state")=="failed"); check(a.launched==null)
   check(!status(a).has("pendingRequestId"))
  }
  "api29-role" -> {
   Build.VERSION.SDK_INT=29; val a=Activity(); a.roleManager.available=false
   check(status(a).getString("state")=="unavailable")
   a.roleManager.available=true; a.roleManager.held=true; check(status(a).getString("state")=="held")
   a.roleManager.held=false; val web=WebView(); web.ready=true; CybermanjuHomeRole.onWebViewCreated(a,web); CybermanjuHomeRole.onResume(a,web)
   check(start(a).getString("state")=="pending"); check(a.forResult?.second==60001)
  }
  "foreground-gate" -> {
   val a=Activity(); a.focused=false; val out=JSONObject(CybermanjuHomeRole.dispatch(a,"request",JSONObject().put("requestId",ID).toString()))
   check(out.getString("error").startsWith("auth:")); check(a.forResult==null)
  }
  else -> error("unknown case")
 }
 println("PASS "+args.single())
}
'''


def compiler_lib():
    gradle_home = Path(os.environ.get("GRADLE_USER_HOME", str(Path.home() / ".gradle")))
    candidates = [os.environ.get("KOTLIN_LIB", "")]
    candidates.extend(glob.glob(str(gradle_home / "wrapper" / "dists" / "**" / "gradle-*" / "lib"), recursive=True))
    return next((Path(path) for path in candidates if path and list(Path(path).glob("kotlin-compiler-embeddable-*.jar"))), None)


class HomeRoleRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lib = compiler_lib()
        if lib is None or not shutil.which("java"):
            if os.environ.get("REQUIRE_KOTLIN_COMPILER") == "1":
                raise AssertionError("Java/Kotlin compiler required; set KOTLIN_LIB")
            raise unittest.SkipTest("Kotlin compiler unavailable")
        cls.temp = tempfile.TemporaryDirectory(prefix="cybermanju-home-role-jvm-")
        cls.directory = Path(cls.temp.name)
        cls.addClassCleanup(cls.temp.cleanup)
        for name, content in STUBS.items():
            (cls.directory / name).write_text(content, encoding="utf-8")
        source = (ROOT / "native/android/CybermanjuHomeRole.kt").read_text(encoding="utf-8")
        (cls.directory / "CybermanjuHomeRole.kt").write_text(source.replace("__PACKAGE__", "com.cybermanju.os"), encoding="utf-8")
        (cls.directory / "Harness.kt").write_text(HARNESS, encoding="utf-8")
        cls.classes = cls.directory / "classes"
        cp = os.pathsep.join(glob.glob(str(lib / "*.jar")))
        result = subprocess.run(["java", "-cp", cp, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
                                 "-no-stdlib", "-no-reflect", "-classpath", cp, "-d", str(cls.classes),
                                 *map(str, cls.directory.glob("*.kt"))], capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        cls.runtime_cp = str(cls.classes) + os.pathsep + cp

    def run_case(self, name):
        result = subprocess.run(["java", "-cp", self.runtime_cp, "regression.HarnessKt", name],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS " + name, result.stdout)

    def test_listener_late_does_not_lose_return_event(self): self.run_case("late-listener")
    def test_mismatched_ack_keeps_request_until_exact_ack(self): self.run_case("mismatched-ack")
    def test_process_recreation_recovers_same_request_id(self): self.run_case("process-recreation")
    def test_api24_uses_observed_settings_state(self): self.run_case("api24-fallback")
    def test_api29_checks_role_availability_and_held(self): self.run_case("api29-role")
    def test_request_requires_foreground_focus(self): self.run_case("foreground-gate")
    def test_old_async_webview_callback_does_not_strand_pending_result(self): self.run_case("webview-replaced-async")
    def test_settings_security_failure_does_not_fallback_or_retain_pending(self): self.run_case("settings-security-failure")
    def test_activity_not_found_falls_back_only_after_primary_stops_resolving(self): self.run_case("settings-activity-not-found")
    def test_settings_resolution_errors_fail_closed(self): self.run_case("settings-resolution-failure")


if __name__ == "__main__":
    unittest.main(verbosity=2)
