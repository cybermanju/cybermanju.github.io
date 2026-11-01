import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const instructor = readFileSync(
  new URL('../../src/components/MandarinInstructor.vue', import.meta.url),
  'utf8',
)

describe('Mandarin instructor voice provider integration', () => {
  it('uses the shared OS voice bridge for the selected tutor Agent', () => {
    expect(instructor).toContain("import { useVoiceCall } from '@/composables/useVoiceCall'")
    expect(instructor).toContain('const voice = useVoiceCall(sendVoicePrompt, () => progress.value.voiceLanguage)')
    expect(instructor).toContain('async function sendVoicePrompt(text: string, signal: AbortSignal)')
  })

  it('shows the runtime selected by the bridge and rejects client-supplied routes/secrets', () => {
    expect(instructor).toContain('Rota ativa neste dispositivo:')
    expect(instructor).toContain('voice.provider?.label')
    expect(instructor).toContain('Esta tela não aceita URL de rota nem encaminha chaves informadas pelo cliente.')
  })
})
