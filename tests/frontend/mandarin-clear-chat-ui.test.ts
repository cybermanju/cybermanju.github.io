// @vitest-environment happy-dom
// CyberManju OS — Mandarin local chat clearing UI regressions.
// Role: exercise the rendered clear control with the real voice call controller.
// Contracts: clearing stops local capture/work; remote Agent sessions are never deleted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, nextTick, ref } from 'vue'
import MandarinInstructor from '@/components/MandarinInstructor.vue'
import { defaultMandarinProgress, MANDARIN_LESSONS, MANDARIN_QUIZ } from '@/utils/mandarinCourse'
import { VoiceCallController, type VoiceCallState } from '@/utils/voiceCall'

const io = vi.hoisted(() => ({
  useVoiceCall: vi.fn(), useStudioAgent: vi.fn(),
  vaultGetJson: vi.fn(), vaultSetJson: vi.fn(),
}))
vi.mock('@/composables/useVoiceCall', () => ({ useVoiceCall: io.useVoiceCall }))
vi.mock('@/composables/useStudioAgent', () => ({ useStudioAgent: io.useStudioAgent }))
vi.mock('@/composables/useVault', () => ({
  vaultGetJson: io.vaultGetJson, vaultSetJson: io.vaultSetJson, vaultBackend: () => 'kv',
}))
vi.mock('@/composables/useWindowManager', () => ({ useWindowManager: () => ({ open: vi.fn() }) }))
vi.mock('@/composables/useWindowUi', () => ({ useWindowUi: () => ({ focused: { value: true } }) }))
vi.mock('@/composables/useMotion', () => ({ useMotion: () => ({ reduced: { value: true } }) }))
vi.mock('@/components/AppIcon.vue', () => ({ default: { template: '<i aria-hidden="true" />' } }))
vi.mock('@/components/OrbNavigator.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/LanguageTeacherVoiceProviders.vue', () => ({ default: { template: '<div />' } }))

let wrapper: VueWrapper | undefined
let controller: VoiceCallController
let finalSpeech: (text: string) => void
let finishSpeech: () => void
const startListening = vi.fn()
const stopListening = vi.fn()
const finishListening = vi.fn()
const stopSpeaking = vi.fn()
const speak = vi.fn()
const deviceSpeak = vi.fn()
let pushToTalkSupported = true
type TutorSession = { id: string; messages: Array<{ role: string; content: string }> }
const studio = {
  chatConfigId: ref('agent-1'),
  configs: ref([{ id: 'agent-1', name: 'Tutor de teste', model: 'fixture' }]),
  jobActive: ref(false), pendingApproval: ref(false), activeJob: ref<{ sessionId: string; status: string } | null>(null),
  jobError: ref(''), viewing: ref<TutorSession | null>(null),
  ensureCatalog: vi.fn(), newSession: vi.fn(), loadSession: vi.fn(), send: vi.fn(), abort: vi.fn(),
  deleteSession: vi.fn(),
  setViewing: vi.fn((session: TutorSession | null) => { studio.viewing.value = session }),
}
const clearSelector = 'button[aria-label="Apagar somente o histórico local do curso; a sessão remota do Agent não será apagada"]'

beforeEach(() => {
  vi.clearAllMocks()
  pushToTalkSupported = true
  vi.stubGlobal('speechSynthesis', { speak: deviceSpeak, cancel: vi.fn() })
  studio.chatConfigId.value = 'agent-1'
  studio.jobActive.value = false
  studio.pendingApproval.value = false
  studio.activeJob.value = null
  studio.viewing.value = null
  studio.newSession.mockImplementation(async () => {
    const session = { id: 'remote-session', messages: [] }
    studio.viewing.value = session
    return session
  })
  studio.loadSession.mockImplementation(async (id: string) => { studio.viewing.value = { id, messages: [] } })
  studio.send.mockResolvedValue(true)
  io.useStudioAgent.mockReturnValue(studio)
  io.vaultGetJson.mockResolvedValue(defaultMandarinProgress())
  io.vaultSetJson.mockResolvedValue(undefined)
  io.useVoiceCall.mockImplementation((send: (text: string, signal: AbortSignal) => Promise<string>) => {
    const state = ref<VoiceCallState>('idle')
    const error = ref('')
    controller = new VoiceCallController({
      send,
      listen(final) { startListening(); finalSpeech = final }, stopListening, finishListening, stopSpeaking,
      speak(text, done) { speak(text); finishSpeech = done },
      changed(next, detail) { state.value = next; error.value = detail },
    })
    return {
      state, error, muted: ref(false), supported: true, pushToTalkSupported, provider: null,
      active: computed(() => state.value !== 'idle' && state.value !== 'error'),
      start: () => controller.start(), end: () => controller.end(),
      startHold: () => controller.start({ singleTurn: true }), finishHold: () => controller.finishHold(),
      interrupt: () => controller.interrupt(),
    }
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals() })

async function clickButton(text: string) {
  const button = wrapper!.findAll('button').find(candidate => candidate.text() === text || candidate.attributes('aria-label') === text)
  expect(button, `button ${text}`).toBeDefined()
  await button!.trigger('click')
}
async function openVoiceTutor() {
  wrapper = mount(MandarinInstructor, { attachTo: document.body })
  await flushPromises()
  await clickButton('Tutor')
  await clickButton('Voz · falar e ouvir')
  return wrapper.get<HTMLButtonElement>(clearSelector)
}

describe('Mandarin clear chat rendered voice flow', () => {
  it('offers Mandarin first and six honest coming-soon languages without fake course buttons', async () => {
    wrapper = mount(MandarinInstructor, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.get('.ll-app-name').text()).toBe('Language Learn')
    await wrapper.get('.ll-language-switch').trigger('click')
    const dialog = wrapper.get<HTMLDialogElement>('#language-learn-library')
    expect(dialog.element.open).toBe(true)
    expect(dialog.get('.ll-language-available strong').text()).toBe('Mandarim')
    expect(dialog.findAll('.ll-coming-language strong').map(row => row.text())).toEqual(['Japonês', 'Português', 'Inglês', 'Alemão', 'Tupi', 'Latim'])
    expect(dialog.findAll('.ll-coming-language small').every(row => row.text() === 'Em breve')).toBe(true)
    expect(dialog.findAll('.ll-coming-language button')).toHaveLength(0)
    await dialog.get('.ll-language-available').trigger('click')
    expect(dialog.element.open).toBe(false)
    expect(startListening).not.toHaveBeenCalled()
    expect(deviceSpeak).not.toHaveBeenCalled()
  })

  it('keeps holding silent in Text, then finalizes one opted-in voice turn on release without re-listening', async () => {
    wrapper = mount(MandarinInstructor, { attachTo: document.body })
    await flushPromises()
    const orb = wrapper.get('.ll-orb-hit')
    const pointer = { isPrimary: true, button: 0, pointerId: 1, clientX: 50, clientY: 50 }
    await orb.trigger('pointerdown', pointer)
    await new Promise(resolve => setTimeout(resolve, 430))
    await nextTick()
    expect(wrapper.get('.mi-orb-dialog').text()).toContain('escolha Voz')
    expect(startListening).not.toHaveBeenCalled()
    expect(speak).not.toHaveBeenCalled()
    expect(deviceSpeak).not.toHaveBeenCalled()
    await orb.trigger('pointerup', pointer)
    await orb.trigger('click')
    await clickButton('Voz · falar e ouvir')
    expect(startListening).not.toHaveBeenCalled()
    await orb.trigger('pointerdown', pointer)
    await new Promise(resolve => setTimeout(resolve, 430))
    expect(controller.state).toBe('listening')
    expect(startListening).toHaveBeenCalledOnce()
    await orb.trigger('pointerup', pointer)
    await orb.trigger('click')
    expect(finishListening).toHaveBeenCalledOnce()
    expect(controller.state).toBe('listening')
    finalSpeech('你好')
    await flushPromises()
    studio.viewing.value!.messages.push({ role: 'assistant', content: '**你好** Consulte https://example.com' })
    await flushPromises()
    expect(controller.state).toBe('speaking')
    expect(wrapper.get('.mi-orb-dialog').text()).toBe(speak.mock.lastCall![0])
    expect(wrapper.get('.mi-orb-dialog').text()).not.toContain('https://')
    finishSpeech()
    await nextTick()
    expect(controller.state).toBe('idle')
    expect(startListening).toHaveBeenCalledOnce()
  })

  it('cancels a pending or active hold and ignores the late final instead of sending it', async () => {
    await openVoiceTutor()
    const orb = wrapper!.get('.ll-orb-hit')
    const pointer = { isPrimary: true, button: 0, pointerId: 2, clientX: 50, clientY: 50 }
    await orb.trigger('pointerdown', pointer)
    await orb.trigger('pointercancel', pointer)
    await new Promise(resolve => setTimeout(resolve, 430))
    expect(startListening).not.toHaveBeenCalled()
    await orb.trigger('pointerdown', pointer)
    await new Promise(resolve => setTimeout(resolve, 430))
    const lateFinal = finalSpeech
    expect(controller.state).toBe('listening')
    await orb.trigger('pointercancel', pointer)
    expect(controller.state).toBe('idle')
    lateFinal('不要发送')
    await flushPromises()
    expect(studio.send).not.toHaveBeenCalled()
  })

  it('explains unsupported hold capture and keeps explicit tap-to-start/tap-to-stop usable', async () => {
    pushToTalkSupported = false
    await openVoiceTutor()
    const orb = wrapper!.get('.ll-orb-hit')
    const pointer = { isPrimary: true, button: 0, pointerId: 3, clientX: 50, clientY: 50 }
    await orb.trigger('pointerdown', pointer)
    await new Promise(resolve => setTimeout(resolve, 430))
    await nextTick()
    expect(wrapper!.get('.mi-orb-dialog').text()).toContain('não finaliza a fala ao soltar')
    expect(startListening).not.toHaveBeenCalled()
    await orb.trigger('pointerup', pointer)
    await orb.trigger('click')
    await orb.trigger('click')
    expect(controller.state).toBe('listening')
    await orb.trigger('click')
    expect(controller.state).toBe('idle')
  })

  it('does not start a pending hold after the app is unmounted', async () => {
    await openVoiceTutor()
    await wrapper!.get('.ll-orb-hit').trigger('pointerdown', { isPrimary: true, button: 0, pointerId: 4 })
    wrapper!.unmount()
    wrapper = undefined
    await new Promise(resolve => setTimeout(resolve, 430))
    expect(startListening).not.toHaveBeenCalled()
  })

  it('keeps the Orb dock present and makes writing, review, and passing quiz controls change state', async () => {
    wrapper = mount(MandarinInstructor, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('.mi-teacher-dock').exists()).toBe(true)
    expect(wrapper.find('.mi-orb-dialog').exists()).toBe(true)

    await clickButton('Escrever')
    const writing = wrapper.get<HTMLTextAreaElement>('.mi-writing-input')
    const glyph = wrapper.find('.mi-character-picks button').text()
    await wrapper.find('.mi-character-picks button').trigger('click')
    expect(writing.element.value).toContain(glyph)

    await clickButton('Aprender')
    await clickButton('Marcar como revisada')
    expect(wrapper.get('.mi-progress-top strong').text()).toBe(`0 / ${MANDARIN_LESSONS.length}`)
    await clickButton('Revisar')
    const lessonId = defaultMandarinProgress().activeLessonId
    for (const question of MANDARIN_QUIZ[lessonId]) {
      const option = wrapper.findAll<HTMLInputElement>('input[type="radio"]').find(input =>
        input.element.name === question.id && input.element.value === question.answerId,
      )
      expect(option, `correct answer for ${question.id}`).toBeDefined()
      await option!.setValue()
    }
    await clickButton('Conferir respostas')
    expect(wrapper.get('.mi-quiz-result').text()).toContain('aula concluída')
    expect(wrapper.get('.mi-progress-top strong').text()).toBe(`1 / ${MANDARIN_LESSONS.length}`)
    await vi.waitFor(() => expect(io.vaultSetJson.mock.lastCall?.[1]).toMatchObject({ completedLessons: [lessonId], bestQuizScores: { [lessonId]: MANDARIN_QUIZ[lessonId].length } }))
    const saved = io.vaultSetJson.mock.lastCall![1]
    wrapper.unmount()
    io.vaultGetJson.mockResolvedValue(saved)
    wrapper = mount(MandarinInstructor, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.get('.mi-progress-top strong').text()).toBe(`1 / ${MANDARIN_LESSONS.length}`)
  })

  it('keeps text replies and selecting Voz silent until the explicit microphone start', async () => {
    wrapper = mount(MandarinInstructor, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.findAll('.mi-concept-top .mi-icon-button').every(button => (button.element as HTMLButtonElement).disabled)).toBe(true)

    await clickButton('Tutor')
    await wrapper.get('#mandarin-chat-input').setValue('Como digo olá?')
    await wrapper.get('.mi-chat-compose').trigger('submit')
    await flushPromises()
    studio.viewing.value!.messages.push({ role: 'assistant', content: '你好 · Nǐ hǎo · Olá.' })
    await flushPromises()
    expect(wrapper.get('.mi-chat-list').text()).toContain('你好 · Nǐ hǎo · Olá.')
    expect(startListening).not.toHaveBeenCalled()
    expect(speak).not.toHaveBeenCalled()
    expect(deviceSpeak).not.toHaveBeenCalled()
    await clickButton('Voz · falar e ouvir')
    expect(controller.state).toBe('idle')
    expect(startListening).not.toHaveBeenCalled()
    expect(deviceSpeak).not.toHaveBeenCalled()
    expect(wrapper.find('.mi-voice-controls').text()).toContain('Iniciar conversa por voz')
    await clickButton('Iniciar conversa por voz')
    expect(startListening).toHaveBeenCalledOnce()
    expect(controller.state).toBe('listening')
  })

  it('opens the mobile lesson sheet and selection closes it at the new lesson introduction', async () => {
    wrapper = mount(MandarinInstructor, { attachTo: document.body })
    await flushPromises()
    vi.spyOn(wrapper.get('.mi-teacher-dock').element, 'getBoundingClientRect').mockReturnValue({ top: 600 } as DOMRect)
    await clickButton('Revisar')
    await wrapper.get('.mi-mobile-course').trigger('click')
    const dialog = wrapper.get<HTMLDialogElement>('#mandarin-lesson-sheet')
    expect(dialog.element.open).toBe(true)
    expect(dialog.element.style.getPropertyValue('--mi-sheet-bottom')).toBe(`${Math.max(0, window.innerHeight - 600)}px`)
    expect(wrapper.get('.mi-mobile-course').attributes('aria-expanded')).toBe('true')
    const next = MANDARIN_LESSONS[1]
    const lesson = dialog.findAll('.mi-lesson-link').find(button => button.find('strong').text() === next.title)
    await lesson!.trigger('click')
    expect(dialog.element.open).toBe(false)
    expect(wrapper.get('.mi-main h2').text()).toBe(next.title)
    expect(wrapper.get('.mi-stage-button[aria-current="page"]').text()).toBe('Aprender')
    expect(wrapper.get('.mi-progress-top strong').text()).toBe(`0 / ${MANDARIN_LESSONS.length}`)
  })

  it('requires review confirmation after a passing quiz and advances only after valid completion', async () => {
    wrapper = mount(MandarinInstructor, { attachTo: document.body })
    await flushPromises()
    await clickButton('Revisar')
    const lessonId = defaultMandarinProgress().activeLessonId
    for (const question of MANDARIN_QUIZ[lessonId]) {
      const option = wrapper.findAll<HTMLInputElement>('input[type="radio"]').find(input => input.element.name === question.id && input.element.value === question.answerId)
      await option!.setValue()
    }
    await clickButton('Conferir respostas')
    expect(wrapper.get('.mi-progress-top strong').text()).toBe(`0 / ${MANDARIN_LESSONS.length}`)
    expect(wrapper.findAll('button').some(button => button.text() === 'Próxima aula')).toBe(false)
    await clickButton('Concluir revisão desta aula')
    expect(wrapper.get('.mi-progress-top strong').text()).toBe(`1 / ${MANDARIN_LESSONS.length}`)
    await clickButton('Próxima aula')
    expect(wrapper.get('.mi-main h2').text()).toBe(MANDARIN_LESSONS[1].title)
    expect(wrapper.get('.mi-progress-top strong').text()).toBe(`1 / ${MANDARIN_LESSONS.length}`)
  })

  it('enables clear during the first listening call before any pending text, then stops capture locally', async () => {
    const loaded = { ...defaultMandarinProgress(), chatSessionIds: { 'agent-1': 'remote-session' } }
    io.vaultGetJson.mockResolvedValue(loaded)
    const clear = await openVoiceTutor()
    expect(clear.element.disabled).toBe(true)
    await clickButton('Iniciar conversa por voz')
    expect(wrapper!.find('.mi-chat-line--pending').exists()).toBe(false)
    expect(wrapper!.get('.mi-chat-head strong').text()).toBe('0 mensagens salvas')
    expect(clear.element.disabled).toBe(false)
    const lateFinal = finalSpeech
    const stops = stopListening.mock.calls.length

    await clear.trigger('click')
    expect(controller.state).toBe('idle')
    expect(stopListening).toHaveBeenCalledTimes(stops + 1)
    expect(stopSpeaking).toHaveBeenCalledTimes(stops + 1)
    expect(clear.element.disabled).toBe(true)
    lateFinal('你好')
    await flushPromises()
    expect(studio.newSession).not.toHaveBeenCalled()
    expect(studio.loadSession).not.toHaveBeenCalled()
    expect(studio.send).not.toHaveBeenCalled()
    expect(studio.deleteSession).not.toHaveBeenCalled()
    expect(wrapper!.find('.mi-chat-line').exists()).toBe(false)
    await vi.waitFor(() => expect(io.vaultSetJson).toHaveBeenCalled())
    expect(io.vaultSetJson.mock.lastCall?.[1]).toMatchObject({ chat: [], chatSessionIds: {} })
  })

  it('keeps clear usable for a muted first call with an empty transcript', async () => {
    const clear = await openVoiceTutor()
    await clickButton('Iniciar conversa por voz')
    controller.setMuted(true)
    await nextTick()
    expect(wrapper!.find('.mi-chat-line--pending').exists()).toBe(false)
    expect(clear.element.disabled).toBe(false)
    await clear.trigger('click')
    expect(controller.state).toBe('idle')
    expect(studio.deleteSession).not.toHaveBeenCalled()
  })

  it('clears while a voice session is being created and ignores its late completion', async () => {
    let resolveSession!: (session: { id: string; messages: [] }) => void
    studio.newSession.mockImplementation(() => new Promise(resolve => { resolveSession = resolve }))
    const clear = await openVoiceTutor()
    await clickButton('Iniciar conversa por voz')
    finalSpeech('你好')
    await nextTick()
    expect(wrapper!.get('.mi-chat-line--pending').text()).toContain('你好')
    expect(clear.element.disabled).toBe(false)
    await clear.trigger('click')
    const session = { id: 'late-remote-session', messages: [] as [] }
    studio.viewing.value = session
    resolveSession(session)
    await flushPromises()
    expect(controller.state).toBe('idle')
    expect(wrapper!.find('.mi-chat-line').exists()).toBe(false)
    expect(wrapper!.find('.mi-chat-line--pending').exists()).toBe(false)
    expect(studio.send).not.toHaveBeenCalled()
    expect(studio.deleteSession).not.toHaveBeenCalled()
    expect(speak).not.toHaveBeenCalled()
  })

  it('clears between completed voice turns while keeping the remote session intact', async () => {
    const clear = await openVoiceTutor()
    await clickButton('Iniciar conversa por voz')
    finalSpeech('你好')
    await flushPromises()
    studio.viewing.value!.messages.push({ role: 'assistant', content: '你好！' })
    await flushPromises()
    expect(controller.state).toBe('speaking')
    finishSpeech()
    await nextTick()
    expect(controller.state).toBe('listening')
    await clear.trigger('click')
    expect(wrapper!.find('.mi-chat-line').exists()).toBe(false)
    expect(controller.state).toBe('idle')
    expect(studio.abort).not.toHaveBeenCalled()
    expect(studio.deleteSession).not.toHaveBeenCalled()
  })
})
