// CyberManju OS — Android voice installer contracts (tests/frontend/android-voice-services.test.ts).
// Role: Exercise the Android service installer against generated-project fixtures and guard privacy constraints.
// Exports: Vitest suite.
// Integrates: scripts/android-voice-services.py and native/android sources.
// Contracts: package-aware Kotlin installation, idempotent manifest merge, bounded local-only service behavior.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
function fixture(run: (dir: string, manifest: string, kotlin: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'cybermanju-voice-'))
  const main = join(dir, 'app/src/main')
  const java = join(main, 'java/org/example/app')
  mkdirSync(java, { recursive: true })
  mkdirSync(join(main, 'res/values'), { recursive: true })
  mkdirSync(join(dir, 'app'), { recursive: true })
  const kotlin = join(java, 'MainActivity.kt')
  const manifest = join(main, 'AndroidManifest.xml')
  writeFileSync(kotlin, 'package org.example.app\nclass MainActivity : TauriActivity() {}\n')
  writeFileSync(join(dir, 'app/build.gradle.kts'), 'android {\n  buildTypes {\n    getByName("release") {\n      optimization { enable = true }\n      proguardFiles(*fileTree(".") { include("**/*.pro"); exclude("build/**") }.files.toTypedArray())\n    }\n  }\n}\n')
  writeFileSync(join(main, 'res/values/strings.xml'), '<resources><string name="other">Keep me</string></resources>\n')
  writeFileSync(manifest, `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="org.example.app">\n  <queries><package android:name="existing.app" /></queries>\n  <application android:label="CyberManju">\n    <service android:name=".CybermanjuMessages" android:exported="true"><intent-filter><action android:name="android.service.notification.NotificationListenerService" /></intent-filter></service>\n    <activity android:name=".MainActivity" />\n  </application>\n</manifest>\n`)
  try { run(dir, manifest, kotlin) } finally { rmSync(dir, { recursive: true, force: true }) }
}
function install(dir: string) { execFileSync('python3', ['scripts/android-voice-services.py', dir], { cwd: root, encoding: 'utf8' }) }

describe('Android voice services installer', () => {
  it('copies package-substituted Kotlin and registers services, accessibility XML, and speech queries without removing messages', () => fixture((dir, manifest, mainKotlin) => {
    install(dir)
    const target = join(dir, 'app/src/main/java/org/example/app')
    const bridge = readFileSync(join(target, 'CybermanjuVoiceServices.kt'), 'utf8')
    const access = readFileSync(join(target, 'CybermanjuVoiceAccessibility.kt'), 'utf8')
    const xml = readFileSync(join(dir, 'app/src/main/res/xml/cybermanju_voice_accessibility.xml'), 'utf8')
    const m = readFileSync(manifest, 'utf8')
    expect(bridge).toContain('package org.example.app')
    expect(bridge).toContain('@JvmStatic fun dispatch(activity: Activity, action: String, payload: String): String')
    expect(access).toContain('package org.example.app')
    expect(xml).toContain('android:isAccessibilityTool="false"')
    expect(xml).toContain('android:canRetrieveWindowContent="true"')
    expect(m).toContain('.CybermanjuMessages')
    expect(m).toContain('.CybermanjuVoiceNotificationListener')
    expect(m).toContain('.CybermanjuVoiceAccessibility')
    expect(m).toContain('android.speech.action.RECOGNIZE_SPEECH')
    expect(m).toContain('android.speech.RecognitionService')
    expect(m).toContain('android.intent.action.TTS_SERVICE')
    expect(m).toContain('existing.app')
    expect(m).not.toContain('QUERY_ALL_PACKAGES')
    expect(readFileSync(mainKotlin, 'utf8')).toContain('package org.example.app')
    expect(readFileSync(join(dir, 'app/src/main/res/values/strings.xml'), 'utf8')).toContain('Keep me')
    expect(readFileSync(join(dir, 'app/build.gradle.kts'), 'utf8')).toContain('proguardFiles(\"cybermanju-voice.pro\")')
    expect(readFileSync(join(dir, 'app/cybermanju-voice.pro'), 'utf8')).toContain('-keep class org.example.app.CybermanjuVoiceServices')
  }))
  it('fails closed when Gradle release rules cannot be resolved', () => fixture((dir) => {
    writeFileSync(join(dir, 'app/build.gradle.kts'), 'android { buildTypes { } }\n')
    expect(() => install(dir)).toThrow()
  }))
  it('validates APK DEX requirements deterministically with synthetic DEX fixtures', () => {
    execFileSync('python3', ['tests/python/test_android_voice_apk.py'], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  })
  it('is byte-stable on the second invocation and retains existing service content', () => fixture((dir, manifest) => {
    install(dir)
    const before = readFileSync(manifest, 'utf8')
    install(dir)
    expect(readFileSync(manifest, 'utf8')).toBe(before)
    expect(before.match(/CybermanjuVoiceNotificationListener/g)).toHaveLength(1)
    expect(before.match(/CybermanjuVoiceAccessibility/g)).toHaveLength(1)
    expect(before.match(/CybermanjuMessages/g)).toHaveLength(1)
  }))
  it('guards the exact JNI, bounded buffers, confirmation, local-only and narrowly-scoped accessibility contracts', () => {
    const bridge = readFileSync(join(root, 'native/android/CybermanjuVoiceServices.kt'), 'utf8')
    const access = readFileSync(join(root, 'native/android/CybermanjuVoiceAccessibility.kt'), 'utf8')
    expect(bridge).toContain('dispatch(activity: Activity, action: String, payload: String): String')
    expect(bridge).toContain('pendingConfirmation')
    expect(bridge).toContain('items.size > 100')
    expect(bridge).toContain('require(aPackages.length() <= 50)')
    expect(bridge).toContain('notification access disabled')
    expect(bridge).not.toMatch(/HttpURLConnection|OkHttpClient|Retrofit/)
    expect(access).toContain('SystemClock.elapsedRealtime() + 30_000')
    expect(access).toContain('focused.isPassword')
    expect(access).toContain('ACTION_SET_TEXT')
    expect(access).not.toMatch(/performAction\(AccessibilityNodeInfo\.ACTION_CLICK|dispatchGesture|focused\.text|node\.text/)
  })
  it('requires exact permission components, native confirmation and unchanged reply identity', () => {
    const bridge = readFileSync(join(root, 'native/android/CybermanjuVoiceServices.kt'), 'utf8')
    expect(bridge).toContain('ComponentName(c, CybermanjuVoiceNotificationListener::class.java)')
    expect(bridge).toContain('ComponentName(a, CybermanjuVoiceAccessibility::class.java)')
    expect(bridge).toContain('check(dialog == null)')
    expect(bridge).toContain('.setPositiveButton("Confirm")')
    expect(bridge).toContain('sbn.postTime == expected.timestamp')
    expect(bridge).toContain('action.actionIntent == expected.replyIntent')
    expect(bridge).toContain('action.actionIntent?.creatorPackage == pkg')
    expect(bridge).toContain('main.post(task)')
    expect(bridge).toContain('private fun requireForeground')
    const endOfSpeech = bridge.match(/override fun onEndOfSpeech\(\) \{([^}]+)\}/)?.[1]
    expect(endOfSpeech).toBeTruthy()
    expect(endOfSpeech).not.toContain('emit(')
  })
  it('reports microphone permission independently from recognition provider availability', () => {
    const bridge = readFileSync(join(root, 'native/android/CybermanjuVoiceServices.kt'), 'utf8')
    const transport = readFileSync(join(root, 'src/utils/androidVoice.ts'), 'utf8')
    expect(bridge).toContain('.put("recognitionAvailable", SpeechRecognizer.isRecognitionAvailable(a))')
    expect(bridge).toContain('.put("microphoneGranted", a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)')
    expect(transport).toContain('microphoneGranted: boolean')
  })
  it('preserves the exact static JNI signature and does not add an agent/REST route', () => {
    const launcher = readFileSync(join(root, 'crates/launcher/src/lib.rs'), 'utf8')
    const transport = readFileSync(join(root, 'src/utils/androidVoice.ts'), 'utf8')
    const routes = readFileSync(join(root, 'src/composables/useTauri.ts'), 'utf8')
    const handler = readFileSync(join(root, 'src-tauri/src/lib.rs'), 'utf8')
    expect(launcher).toContain('(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;')
    expect(launcher).toContain('"loadClass"')
    expect(launcher).toContain('payload.to_string().len() > 32_768')
    expect(handler).toContain('commands::launcher::android_voice_command')
    expect(transport).toContain("from '@tauri-apps/api/core'")
    expect(transport).not.toMatch(/fetch\(|REST_ROUTES|sendPrompt/)
    expect(routes).not.toContain('android_voice_command:')
  })
})
