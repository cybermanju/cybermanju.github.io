// @vitest-environment happy-dom
// CyberManju OS — Language Teacher voice-provider panel tests (tests/frontend/language-teacher-voice-providers.test.ts).
// Role: verifies accessible local deletion and its UI state transitions.
// Exports: Vitest suite.
// Integrates: LanguageTeacherVoiceProviders.vue, mocked voice-settings services, Vue Test Utils.
// Contracts: deletion requires local confirmation; only success clears the draft and disables TTS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import LanguageTeacherVoiceProviders from '@/components/LanguageTeacherVoiceProviders.vue'

const voiceSettings = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  test: vi.fn(),
}))

vi.mock('@/utils/languageTeacherVoiceSettings', () => ({
  defaultLanguageTeacherVoiceSettings: () => ({
    geminiApiKey: '',
    elevenLabsApiKey: '',
    elevenLabsAgentId: '',
    voiceStudioEndpoint: '',
    voiceStudioModel: '',
    voiceStudioVoice: '',
    voiceStudioFormat: 'wav',
    voiceStudioSpeed: 1,
  }),
  loadLanguageTeacherVoiceSettings: voiceSettings.load,
  saveLanguageTeacherVoiceSettings: voiceSettings.save,
  deleteLanguageTeacherVoiceSettings: voiceSettings.remove,
  testVoiceStudioTts: voiceSettings.test,
}))

const savedSettings = {
  geminiApiKey: 'gemini-local-secret',
  elevenLabsApiKey: 'eleven-local-secret',
  elevenLabsAgentId: 'agent-local-id',
  voiceStudioEndpoint: 'https://voice.example/v1/audio/speech',
  voiceStudioModel: 'local-model',
  voiceStudioVoice: 'local-voice',
  voiceStudioFormat: 'mp3',
  voiceStudioSpeed: 1.25,
}

let wrappers: ReturnType<typeof mount>[] = []

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find(candidate => candidate.text().includes(text))
  if (!button) throw new Error(`Botão não encontrado: ${text}`)
  return button
}

async function mountSavedPanel() {
  const wrapper = mount(LanguageTeacherVoiceProviders, { attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
  vi.stubGlobal('confirm', vi.fn(() => true))
  voiceSettings.load.mockResolvedValue({ settings: savedSettings, hasSavedConfig: true })
  voiceSettings.save.mockResolvedValue(savedSettings)
  voiceSettings.remove.mockResolvedValue(undefined)
  voiceSettings.test.mockResolvedValue({ contentType: 'audio/wav', byteLength: 4 })
})

afterEach(() => {
  wrappers.splice(0).reverse().forEach(wrapper => wrapper.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('LanguageTeacherVoiceProviders local deletion', () => {
  it('requires explicit local confirmation and leaves state intact when canceled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const wrapper = await mountSavedPanel()
    const removeButton = buttonByText(wrapper, 'Apagar configuração e credenciais locais')

    expect(removeButton.attributes('disabled')).toBeUndefined()
    await removeButton.trigger('click')

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(voiceSettings.remove).not.toHaveBeenCalled()
    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe('gemini-local-secret')
    expect(buttonByText(wrapper, 'Testar VoiceStudio').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[role="status"]').text()).toBe('Exclusão cancelada.')
  })

  it('deletes after confirmation, resets every draft field and disables TTS', async () => {
    vi.mocked(window.confirm).mockReturnValue(true)
    const wrapper = await mountSavedPanel()
    const removeButton = buttonByText(wrapper, 'Apagar configuração e credenciais locais')

    await removeButton.trigger('click')
    await flushPromises()

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(voiceSettings.remove).toHaveBeenCalledOnce()
    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.findAll('input[type="password"]')[1].element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('input[type="url"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.findAll('input[type="text"]')[0].element as HTMLInputElement).value).toBe('')
    expect((wrapper.findAll('input[type="text"]')[1].element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('wav')
    expect((wrapper.find('input[type="number"]').element as HTMLInputElement).value).toBe('1')
    expect(buttonByText(wrapper, 'Testar VoiceStudio').attributes('disabled')).toBeDefined()
    expect(buttonByText(wrapper, 'Apagar configuração e credenciais locais').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="status"]').text()).toBe('Configuração e credenciais locais apagadas do arquivo .cybermanju.')
    expect(wrapper.find('[role="status"]').attributes('data-error')).toBe('false')
  })

  it('marks all actions busy while deleting and re-enables them after success', async () => {
    vi.mocked(window.confirm).mockReturnValue(true)
    let finishDelete!: () => void
    voiceSettings.remove.mockReturnValue(new Promise<void>(resolve => { finishDelete = resolve }))
    const wrapper = await mountSavedPanel()

    await buttonByText(wrapper, 'Apagar configuração e credenciais locais').trigger('click')
    await wrapper.vm.$nextTick()

    expect(voiceSettings.remove).toHaveBeenCalledOnce()
    expect(buttonByText(wrapper, 'Apagando…').attributes('disabled')).toBeDefined()
    expect(buttonByText(wrapper, 'Atualizar do vault').attributes('disabled')).toBeDefined()
    expect(buttonByText(wrapper, 'Salvar no .cybermanju').attributes('disabled')).toBeDefined()
    expect(buttonByText(wrapper, 'Testar VoiceStudio').attributes('disabled')).toBeDefined()

    finishDelete()
    await flushPromises()
    expect(buttonByText(wrapper, 'Apagar configuração e credenciais locais').attributes('disabled')).toBeDefined()
  })

  it('preserves saved values and TTS eligibility when deletion fails', async () => {
    vi.mocked(window.confirm).mockReturnValue(true)
    voiceSettings.remove.mockRejectedValue(new Error('Falha ao persistir exclusão no vault.'))
    const wrapper = await mountSavedPanel()

    await buttonByText(wrapper, 'Apagar configuração e credenciais locais').trigger('click')
    await flushPromises()

    expect(voiceSettings.remove).toHaveBeenCalledOnce()
    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe('gemini-local-secret')
    expect((wrapper.find('input[type="url"]').element as HTMLInputElement).value).toBe(savedSettings.voiceStudioEndpoint)
    expect(buttonByText(wrapper, 'Testar VoiceStudio').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[role="status"]').text()).toBe('Falha ao persistir exclusão no vault.')
    expect(wrapper.find('[role="status"]').attributes('data-error')).toBe('true')
  })

  it('keeps deletion and TTS gated when the vault cannot be opened', async () => {
    voiceSettings.load.mockRejectedValue(new Error('Vault bloqueado.'))
    const wrapper = await mountSavedPanel()

    expect(buttonByText(wrapper, 'Apagar configuração e credenciais locais').attributes('disabled')).toBeDefined()
    expect(buttonByText(wrapper, 'Testar VoiceStudio').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="status"]').text()).toBe('Vault bloqueado.')
    expect(wrapper.find('[role="status"]').attributes('data-error')).toBe('true')
  })
})
