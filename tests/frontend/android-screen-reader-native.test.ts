// CyberManju OS — Android screen-reader native contracts (tests/frontend/android-screen-reader-native.test.ts).
// Role: Guard opt-in capture, local OCR, bounded worker use and native-owned sequential selection.
// Exports: Vitest suite.
// Integrates: Android Kotlin reader/installer and the VoiceServices dispatch.
// Contracts: Static regressions supplement compilation, not Android device lifecycle tests.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const kotlin = readFileSync('native/android/CybermanjuScreenReader.kt', 'utf8')
const installer = readFileSync('scripts/android-voice-services.py', 'utf8')
const bridge = readFileSync('native/android/CybermanjuVoiceServices.kt', 'utf8')

describe('native Android screen reader', () => {
  it('uses dedicated reader polling and a single native session state', () => {
    for (const action of ['readerStatus', 'readerStart', 'readerStop', 'readerOverlaySettings', 'readerNotificationSettings', 'readerPoll']) {
      expect(kotlin).toContain(`"${action}"`)
      expect(bridge).toContain(`"${action}"`)
    }
    expect(kotlin).toContain('consentDisclosure')
    expect(kotlin).toContain('require(!active() && service == null)')
    expect(kotlin).toContain('if (events.size >= 100) events.removeFirst()')
    expect(kotlin).toContain('.put("lastError", error)')
    expect(kotlin).not.toMatch(/Base64|base64|SharedPreferences|ACTION_SET_TEXT/)
  })
  it('reports actual permission state and uses guarded settings and permission APIs', () => {
    for (const key of ['overlayGranted', 'notificationGranted', 'notificationsEnabled', 'projectionActive', 'androidApi']) expect(kotlin).toContain(`.put("${key}"`)
    expect(kotlin).toContain('manager.areNotificationsEnabled()')
    expect(kotlin).toContain('getNotificationChannel("cybermanju_screen_reader")?.importance')
    expect(kotlin).toContain('Build.VERSION.SDK_INT < 33 || it.checkSelfPermission')
    expect(kotlin).toContain('if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)')
    expect(kotlin).toContain('Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS')
    expect(kotlin).toContain('requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9108)')
    expect(kotlin).toContain('if (!CybermanjuScreenReader.controlsAllowed())')
    expect(kotlin).toContain('if (active()) stop()')
    const stop = kotlin.slice(kotlin.indexOf('internal fun stop('), kotlin.indexOf('internal fun ended('))
    expect(stop.indexOf('service = null')).toBeLessThan(stop.indexOf('update(next, error)'))
  })
  it('consumes one fresh projection grant only after a foreground notification and callback registration', () => {
    const foreground = kotlin.indexOf('startForeground(71')
    const grant = kotlin.indexOf('.getMediaProjection(')
    const callback = kotlin.indexOf('registerCallback(projectionCallback')
    const display = kotlin.indexOf('.createVirtualDisplay(')
    expect(foreground).toBeLessThan(grant)
    expect(grant).toBeLessThan(callback)
    expect(callback).toBeLessThan(display)
    expect(kotlin.match(/\.createVirtualDisplay\(/g)).toHaveLength(1)
    expect(kotlin).toContain('intent.removeExtra("data")')
    expect(kotlin).toContain('display?.resize(')
    expect(kotlin).toContain('START_NOT_STICKY')
  })
  it('invalidates late consent, bounds waiting time and does not restart a stopped session', () => {
    expect(kotlin).toContain('if (!owns(expected) || state != "awaiting_permission") return')
    expect(kotlin).toContain('main.postDelayed(it, 120_000)')
    expect(kotlin).toContain('main.postDelayed(it, 10_000)')
    const stop = kotlin.slice(kotlin.indexOf('internal fun stop('), kotlin.indexOf('internal fun ended('))
    expect(stop.indexOf('update(next, error)')).toBeLessThan(stop.indexOf('CybermanjuScreenReaderConsentActivity.cancel(id)'))
    expect(kotlin).toContain('requested = savedInstanceState?.getBoolean("requested") == true')
    expect(kotlin).toContain('if (requested) return') // retained permission request is not launched again
  })
  it('opens first, locks the screen only on Select and advances only after a selection', () => {
    expect(kotlin).toContain('showControls(); openCurrent()')
    const select = kotlin.slice(kotlin.indexOf('internal fun select('), kotlin.indexOf('internal fun advance('))
    expect(select).toContain('state != "selecting"')
    expect(select).toContain('captures[pkg] =')
    expect(select).toContain('update("reading")')
    expect(select).not.toContain('startActivity')
    expect(kotlin).toContain('if (!owns(expected) || state != "reading") return false')
    expect(kotlin).toContain('button("Stop")')
  })
  it('uses bounded local OCR, drops stale results, and releases every resource on Stop', () => {
    expect(kotlin).toContain('"mlkit-latin-on-device"')
    expect(kotlin).toContain('HandlerThread("CyberManjuLocalOCR")')
    expect(kotlin).toContain('now - lastFrame < 2000')
    expect(kotlin).toContain('busy.compareAndSet(false, true)')
    expect(kotlin).toContain('if (released || target !== selected) return@post')
    expect(kotlin).toContain('finally { bitmap?.recycle(); image.close() }')
    expect(kotlin).toContain('projection?.stop()')
    expect(kotlin).toContain('reader?.close()')
    expect(kotlin).toContain('ocr?.close()')
    expect(kotlin).toContain('worker?.quitSafely()')
    expect(kotlin).toContain('Intent.ACTION_SCREEN_OFF')
    expect(kotlin).not.toMatch(/https?:\/\/|HttpClient|URLConnection|Socket\(/)
  })
  it('installs non-exported reader components, explicit permissions and bundled offline OCR', () => {
    expect(installer).toContain('CybermanjuScreenReader.kt')
    expect(installer).toContain('CybermanjuScreenOcr.kt')
    expect(installer).toContain('FOREGROUND_SERVICE_MEDIA_PROJECTION')
    expect(installer).toContain('SYSTEM_ALERT_WINDOW')
    expect(installer).toContain('POST_NOTIFICATIONS')
    expect(installer).toContain('"exported": "false"')
    expect(installer).toContain('com.google.mlkit:text-recognition:16.0.1')
    expect(installer).not.toContain('play-services-mlkit-text-recognition')
  })
})
