// CyberManju OS — Android HOME configuration (tests/frontend/android-home-configure.test.ts).
// Role: Execute post-init configuration against realistic Android fixtures.
// Exports: Vitest suite.
// Integrates: android-configure.sh and generated manifest/MainActivity/Gradle files.
// Contracts: HOME belongs to MAIN/LAUNCHER, existing filters survive, reruns are stable.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

function fixture(test: (dir: string, manifest: string, kotlin: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'cybermanju-home-'))
  const main = join(dir, 'app/src/main')
  const java = join(main, 'java/com/cybermanju/os')
  mkdirSync(java, { recursive: true })
  const manifest = join(main, 'AndroidManifest.xml')
  const kotlin = join(java, 'MainActivity.kt')
  writeFileSync(kotlin, 'package com.cybermanju.os\nclass MainActivity : TauriActivity() {}\n')
  writeFileSync(join(dir, 'app/build.gradle.kts'), 'android {\n  buildTypes {\n    release {\n      proguardFiles("proguard-rules.pro")\n    }\n  }\n}\ndependencies {\n}\n')
  writeFileSync(join(dir, 'app/proguard-rules.pro'), '# fixture rules\n')
  writeFileSync(manifest, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <queries><package android:name="example.other" /></queries>
  <application android:usesCleartextTraffic="\${usesCleartextTraffic}">
    <activity android:name=".OtherActivity" android:exported="false">
      <!-- android.intent.category.HOME in a comment must not satisfy the check. -->
    </activity>
    <activity android:name=".MainActivity" android:launchMode="standard" android:exported="false">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <data android:scheme="cybermanju" />
      </intent-filter>
    </activity>
  </application>
</manifest>\n`)
  try { test(dir, manifest, kotlin) } finally { rmSync(dir, { recursive: true, force: true }) }
}
const configure = (dir: string) => execFileSync('bash', ['scripts/android-configure.sh', dir], { encoding: 'utf8' })

describe('Android HOME post-init configuration', () => {
  it('targets the real launcher activity and preserves app/deep-link visibility', () => fixture((dir, path, kotlin) => {
    configure(dir)
    const manifest = readFileSync(path, 'utf8')
    const activities = [...manifest.matchAll(/<activity\b[^>]*>[\s\S]*?<\/activity>/g)].map(match => match[0])
    const main = activities.find(activity => activity.includes('android:name=".MainActivity"'))!
    expect(activities.find(activity => activity.includes('android:name=".OtherActivity"'))).not.toContain('<category android:name="android.intent.category.HOME"')
    expect(main).toContain('android:launchMode="singleTask"')
    expect(main).toContain('android:exported="true"')
    expect(main).toMatch(/<intent-filter>\s*<action android:name="android.intent.action.MAIN" \/>\s*<category android:name="android.intent.category.HOME" \/>\s*<category android:name="android.intent.category.DEFAULT" \/>/)
    expect(main).toContain('android.intent.category.LAUNCHER')
    expect(main).toContain('android:scheme="cybermanju"')
    expect(manifest).toContain('android:name="example.other"')
    expect(readFileSync(kotlin, 'utf8')).toContain('override fun onNewIntent')
  }))

  it('is byte-for-byte stable on rerun and upgrades previously marked manifests', () => fixture((dir, path, kotlin) => {
    configure(dir)
    const before = [path, kotlin].map(file => readFileSync(file, 'utf8'))
    configure(dir)
    expect([path, kotlin].map(file => readFileSync(file, 'utf8'))).toEqual(before)
    // Simulate a manifest already stamped by an older configure version.
    writeFileSync(path, before[0].replace(/<intent-filter>\s*<action android:name="android.intent.action.MAIN" \/>\s*<category android:name="android.intent.category.HOME" \/>\s*<category android:name="android.intent.category.DEFAULT" \/>\s*<\/intent-filter>/, ''))
    configure(dir)
    expect(readFileSync(path, 'utf8')).toContain('<category android:name="android.intent.category.HOME" />')
  }))
})
