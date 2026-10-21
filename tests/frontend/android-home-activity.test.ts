// CyberManju OS — Android HOME activity tests (tests/frontend/android-home-activity.test.ts).
// Role: Guard safe injection of HOME lifecycle behavior into generated MainActivity fixtures.
// Integrates: scripts/android-home-activity.py, Python subprocess, temporary Kotlin fixtures.
// Contracts: Preserve Tauri initialization and intent callbacks; refuse unsafe lifecycle merges.
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const helper = path.resolve('scripts/android-home-activity.py')
const tempDirs: string[] = []

function fixture(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-home-activity-'))
  tempDirs.push(dir)
  const mainActivity = path.join(dir, 'MainActivity.kt')
  fs.writeFileSync(mainActivity, contents)
  return mainActivity
}

function runHelper(mainActivity: string) {
  return spawnSync('python3', [helper, mainActivity], { encoding: 'utf8' })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('Android HOME lifecycle injection', () => {
  it('preserves generated onCreate and is byte-identical on a second run', () => {
    const original = `package com.cybermanju.os\n\nimport app.tauri.TauriActivity\n\nclass MainActivity : TauriActivity() {\n    override fun onCreate(savedInstanceState: android.os.Bundle?) {\n        super.onCreate(savedInstanceState)\n        initializeDeepLinks()\n    }\n}\n`
    const file = fixture(original)

    expect(runHelper(file).status).toBe(0)
    const firstRun = fs.readFileSync(file)
    const injected = firstRun.toString('utf8')
    expect(injected).toContain('override fun onCreate(savedInstanceState: android.os.Bundle?) {\n        super.onCreate(savedInstanceState)\n        initializeDeepLinks()\n    }')
    expect(injected).toContain('    // BEGIN CyberManju HOME lifecycle')
    expect(injected).toContain('    // END CyberManju HOME lifecycle')

    expect(runHelper(file).status).toBe(0)
    expect(fs.readFileSync(file).equals(firstRun)).toBe(true)
  })

  it('updates the Activity intent before forwarding callbacks to Tauri', () => {
    const file = fixture('class MainActivity : TauriActivity() {\n}\n')
    expect(runHelper(file).status).toBe(0)
    const injected = fs.readFileSync(file, 'utf8')
    const newIntent = injected.slice(injected.indexOf('override fun onNewIntent'), injected.indexOf('override fun onResume'))
    expect(newIntent.indexOf('setIntent(intent)')).toBeGreaterThan(-1)
    expect(newIntent.indexOf('setIntent(intent)')).toBeLessThan(newIntent.indexOf('super.onNewIntent(intent)'))
    expect(injected).toMatch(/override fun onResume\(\) \{\s*super\.onResume\(\)/)
    expect(injected).toMatch(/override fun onPause\(\) \{\s*homeResumed = false\s*invalidateHomeDelivery\(\)\s*super\.onPause\(\)/)
    expect(injected).toMatch(/override fun onDestroy\(\) \{[\s\S]*?homeWebView = null\s*super\.onDestroy\(\)/)
  })

  it('delivers an acknowledged HOME event only for pending HOME state without resetting WebView data', () => {
    const file = fixture('class MainActivity : TauriActivity() {\n}\n')
    expect(runHelper(file).status).toBe(0)
    const injected = fs.readFileSync(file, 'utf8')
    const delivery = injected.slice(injected.indexOf('private fun deliverHome()'), injected.indexOf('override fun onPause'))

    expect(delivery).toContain('if (!homePending || !homeResumed || isFinishing || isDestroyed) return')
    expect(delivery).toContain('window.__CYBERMANJU_HOME_READY__!==true)return false;')
    expect(delivery).toContain("window.dispatchEvent(new Event('cybermanju:android-home'));return true;")
    expect(delivery).toMatch(/if \(delivered == "true"\) \{\s*homePending = false/)
    expect(injected).toMatch(/if \(isHomeIntent\(intent\)\) \{\s*homePending = true/)
    expect(injected).toContain('if (homePending && !homeDeliveryInFlight) homeHandler.post(homeDelivery)')
    expect(delivery).toContain('generation != homeGeneration || view !== homeWebView')
    expect(delivery).toContain('if (homeDeliveryInFlight) return')
    expect(delivery).toContain('homeAttempts = (homeAttempts + 1).coerceAtMost(30)')
    expect(delivery).toContain('else -> 1000L')
    expect(delivery).not.toContain('homeAttempts++ < 100')
    expect(injected).not.toMatch(/\.loadUrl\s*\(|\.reload\s*\(|clearCache\s*\(|clearHistory\s*\(|clearFormData\s*\(|\.clear\s*\(|deleteDatabase\s*\(|getCacheDir\s*\(/)
    expect(injected).not.toMatch(/\b(?:finish|recreate)\s*\(/)
  })

  it.each([
    ['foreign onResume override', 'class MainActivity : TauriActivity() {\n    override fun onResume() { super.onResume() }\n}\n'],
    ['incomplete HOME markers', 'class MainActivity : TauriActivity() {\n    // BEGIN CyberManju HOME lifecycle\n}\n'],
    ['orphan END marker', 'class MainActivity : TauriActivity() {\n    // END CyberManju HOME lifecycle\n}\n'],
  ])('rejects %s without overwriting the fixture', (_name, contents) => {
    const file = fixture(contents)
    const before = fs.readFileSync(file)
    const result = runHelper(file)
    expect(result.status).not.toBe(0)
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })
})
