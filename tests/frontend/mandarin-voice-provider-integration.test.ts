// CyberManju OS — Mandarin voice provider integration tests.
// Role: verifies shared tutor voice wiring; Integrates: instructor, provider settings, and course state.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const instructor = readFileSync(
  new URL('../../src/components/MandarinInstructor.vue', import.meta.url),
  'utf8',
)
const course = readFileSync(new URL('../../src/utils/mandarinCourse.ts', import.meta.url), 'utf8')
const voiceSettings = readFileSync(new URL('../../src/utils/languageTeacherVoiceSettings.ts', import.meta.url), 'utf8')
const providerPanel = readFileSync(new URL('../../src/components/LanguageTeacherVoiceProviders.vue', import.meta.url), 'utf8')

describe('Mandarin instructor voice provider integration', () => {
  it('uses the shared OS voice bridge for the selected tutor Agent', () => {
    expect(instructor).toContain("import { useVoiceCall } from '@/composables/useVoiceCall'")
    expect(instructor).toContain('const voice = useVoiceCall(sendVoicePrompt, () => progress.value.voiceLanguage)')
    expect(instructor).toContain('async function sendVoicePrompt(text: string, signal: AbortSignal)')
    expect(instructor).toContain("sendTutorTurn(text, 'voice', signal)")
  })

  it('offers every saved Agent config, including custom providers, through the shared tutor driver', () => {
    expect(instructor).toContain('v-for="config in studio.configs.value"')
    expect(instructor).toContain(':value="config.id"')
    expect(instructor).toContain('const configId = studio.chatConfigId.value')
    expect(instructor).toContain('progress.value.chatSessionIds[configId]')
    expect(instructor).toContain('studio.send(tutorPrompt(text.slice(0, 800)))')
  })

  it('makes text the default and starts voice only after explicit mode selection and action', () => {
    expect(instructor).toContain("label: 'Tutor'")
    expect(instructor).toContain('Texto · teclado')
    expect(instructor).toContain('Voz · falar e ouvir')
    expect(instructor).toContain("canStartCourseVoice(progress.value.interactionMode, voice.supported)")
    expect(instructor).toContain("progress.value.interactionMode !== 'voice'")
    expect(instructor).toContain('@click="startVoice"')
    expect(instructor).toContain('O modo texto é completo e não pede permissão de microfone.')
    expect(instructor).toContain('<LanguageTeacherVoiceProviders />')
  })

  it('shows the active OS runtime and does not route custom TTS to the tutor Agent', () => {
    expect(instructor).toContain('Rota ativa para conversa:')
    expect(instructor).toContain('voice.provider?.label')
    expect(instructor).toContain('não é o Agent da conversa')
    expect(instructor).toContain('nunca fala automaticamente nas aulas')
  })

  it('documents the secure limits of remote voice providers and VoiceStudio test configuration', () => {
    expect(course).toContain('state: \'needs-host-adapter\'')
    expect(course).toContain('token efêmero de uso limitado')
    expect(course).toContain('state: \'manual-test-configurable\'')
    expect(voiceSettings).toContain("url.protocol !== 'https:'")
    expect(voiceSettings).toContain('url.search || url.hash')
    expect(voiceSettings).toContain("redirect: 'error'")
    expect(voiceSettings).toContain("credentials: 'omit'")
    expect(voiceSettings).not.toContain('Authorization')
    expect(voiceSettings).not.toContain('voiceStudioApiKey')
    expect(providerPanel).toContain('não são enviadas nem ativam esses providers')
    expect(providerPanel).toContain('sem chaves, bearer token ou cookies')
    expect(providerPanel).toContain('broker confiável')
    for (const url of [
      'https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk',
      'https://ai.google.dev/gemini-api/docs/ephemeral-tokens',
      'https://elevenlabs.io/docs/eleven-agents/customization/authentication',
      'https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-webrtc-token',
      'https://voicestudio.sh/docs/text-to-speech',
      'https://github.com/debpalash/VoiceStudio/blob/main/docs/speech-platform.md',
    ]) expect(instructor).toContain(url)
  })
})
