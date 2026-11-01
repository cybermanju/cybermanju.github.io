// CyberManju OS — Orb Chatter voice provider tests.
// Role: verifies provider resolution contracts; Integrates: the OS Orb Chatter provider module.
import { describe, expect, it } from 'vitest'
import {
  ORB_CHATTER_VOICE_PROVIDERS,
  getVoiceProvider,
  resolveVoiceProvider,
} from '../../src/integrations/orb-chatter/providers'

describe('Orb Chatter provider contract for CyberManju OS', () => {
  it('prefers the native Android path when it is available', () => {
    const provider = resolveVoiceProvider({
      androidNative: true,
      speechRecognition: true,
      speechSynthesis: true,
    })
    expect(provider?.id).toBe('os-android-agent')
    expect(provider?.implementation).toBe('implemented')
  })

  it('selects browser speech only when recognition and synthesis are both present', () => {
    expect(resolveVoiceProvider({
      androidNative: false,
      speechRecognition: true,
      speechSynthesis: true,
    })?.id).toBe('os-browser-agent')
    expect(resolveVoiceProvider({
      androidNative: false,
      speechRecognition: true,
      speechSynthesis: false,
    })).toBeNull()
    expect(resolveVoiceProvider({
      androidNative: false,
      speechRecognition: false,
      speechSynthesis: true,
    })).toBeNull()
  })

  it('marks only the existing browser and Android voice bridges as implemented', () => {
    expect(ORB_CHATTER_VOICE_PROVIDERS
      .filter(provider => provider.implementation === 'implemented')
      .map(provider => provider.id))
      .toEqual(['os-browser-agent', 'os-android-agent'])
    for (const id of ['gemini-live', 'elevenlabs', 'remote-colab'] as const) {
      expect(getVoiceProvider(id).implementation).toBe('interface-only')
    }
  })

  it('declares server-side credential boundaries for future services, not embedded keys', () => {
    expect(getVoiceProvider('gemini-live').credentials).toBe('server-managed-secret')
    expect(getVoiceProvider('elevenlabs').credentials).toBe('server-managed-secret')
    expect(getVoiceProvider('remote-colab').credentials).toBe('server-managed-secret')
    for (const provider of ORB_CHATTER_VOICE_PROVIDERS) {
      expect(Object.keys(provider)).not.toContain('url')
      expect(Object.keys(provider)).not.toContain('endpoint')
      expect(Object.keys(provider)).not.toContain('apiKey')
    }
    expect(JSON.stringify(ORB_CHATTER_VOICE_PROVIDERS)).not.toMatch(/AIza|sk-[A-Za-z0-9]{8,}/)
  })
})
