// CyberManju OS — Android speech audio focus regressions.
// Role: Validate focus ownership, request freshness and fail-closed native cleanup.
// Exports: Vitest source-contract suite.
// Integrates: CybermanjuVoiceServices.kt; runtime behavior still requires an Android device.
// Contracts: no delayed playback, forced routing or automatic resume after focus loss.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Android TTS audio focus source contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'native/android/CybermanjuVoiceServices.kt'), 'utf8')

  it('requests transient focus with the exact speech attributes and no delayed playback', () => {
    expect(source).toContain('AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)')
    expect(source).toContain('.setAudioAttributes(attributes)')
    expect(source).toContain('.setWillPauseWhenDucked(true)')
    expect(source).toContain('.setAcceptsDelayedFocusGain(false)')
    expect(source).toContain('AudioAttributes.USAGE_ASSISTANT')
    expect(source).toContain('AudioAttributes.CONTENT_TYPE_SPEECH')
    expect(source).toContain('AudioManager.STREAM_MUSIC')
  })

  it('denial and focus loss report errors, stop output, and never resume automatically', () => {
    expect(source).toContain('Audio focus denied; speech was not started')
    expect(source).toContain('Audio focus lost; speech stopped and will not resume automatically')
    expect(source).toContain('if (change <= 0)')
    expect(source).toContain('stopSpeech()')
    expect(source).toContain('focusGeneration != gen || focusSpeechId != id')
  })

  it('rejects expired listen and speak requests before native audio starts', () => {
    expect(source).toContain('p.optLong("expiresAt", 0L) > System.currentTimeMillis()')
    expect(source).toContain('conflict: audio request expired; start again')
    expect(source).toContain('"listen" -> {\n                    require(p.optLong')
    expect(source).toContain('"speak" -> {\n                    require(p.optLong')
  })

  it('abandons the exact acquired request on completion and all stop paths', () => {
    expect(source).toContain('manager.abandonAudioFocusRequest(it)')
    expect(source).toContain('manager.abandonAudioFocus(it)')
    expect(source).toContain('abandonSpeechFocus()')
  })
  it('invalidates focus ownership before attempting best-effort system release', () => {
    const cleanup = source.slice(source.indexOf('private fun abandonSpeechFocus()'), source.indexOf('private fun stopSpeech()'))
    expect(cleanup.indexOf('focusSpeechId = null')).toBeLessThan(cleanup.indexOf('manager.abandonAudioFocusRequest'))
    expect(cleanup).toContain('catch (_: Exception)')
    expect(source).not.toMatch(/setSpeakerphoneOn|setBluetoothScoOn|startBluetoothSco|MODE_IN_COMMUNICATION/)
  })
})
