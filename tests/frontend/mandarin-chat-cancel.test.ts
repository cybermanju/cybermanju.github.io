// CyberManju OS — Mandarin chat cancellation tests (tests/frontend/mandarin-chat-cancel.test.ts).
// Role: protect local transcript clearing against late text tutor turns.
// Contracts: clearChat aborts local work; cancelled sends cannot restore local history.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'

const instructor = readFileSync('src/components/MandarinInstructor.vue', 'utf8')
const template = instructor.split('<script setup lang="ts">')[0]
const script = instructor.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
if (!script) throw new Error('MandarinInstructor script setup not found')

function compileChatActions() {
  const sourceFile = ts.createSourceFile('MandarinInstructor.ts', script!, ts.ScriptTarget.Latest, true)
  const targets = new Set(['sendTextPractice', 'clearChat'])
  const declarations = sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && !!statement.name && targets.has(statement.name.text),
  )
  if (declarations.length !== targets.size) throw new Error('Mandarin chat action functions not found')
  const code = declarations.map(node => script!.slice(node.getStart(sourceFile), node.end)).join('\n')
  const compiled = ts.transpile(code, { target: ts.ScriptTarget.ES2022 })
  return new Function(
    'progress', 'chatDraft', 'newChatLine', 'sendTutorTurn',
    `const chatSendBusy = { value: false }; const pendingStudentText = { value: '' }; const activeLessonId = { value: 'context' }; const chatList = { value: null }; const nextTick = callback => Promise.resolve().then(callback); let textPracticeController = null; const voiceRequest = new AbortController(); const voice = { active: { value: false } }; let stopVoiceCalls = 0; const stopVoice = () => { stopVoiceCalls++; voice.active.value = false; voiceRequest.abort(); }; ${compiled}; return { sendTextPractice, clearChat, voice, voiceSignal: voiceRequest.signal, pendingStudentText, get stopVoiceCalls() { return stopVoiceCalls; } }`,
  ) as (
    progress: { value: { chat: unknown[]; chatSessionIds: Record<string, string> } },
    chatDraft: { value: string },
    newChatLine: (...args: unknown[]) => unknown,
    sendTutorTurn: (text: string, mode: 'text', signal: AbortSignal) => Promise<string>,
  ) => { sendTextPractice: () => Promise<void>; clearChat: () => void; voice: { active: { value: boolean } }; voiceSignal: AbortSignal; pendingStudentText: { value: string }; stopVoiceCalls: number }
}

function compileUnmountCleanup() {
  const sourceFile = ts.createSourceFile('MandarinInstructor.ts', script!, ts.ScriptTarget.Latest, true)
  const registration = sourceFile.statements
    .filter(ts.isExpressionStatement)
    .map(statement => statement.expression)
    .find(expression => ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'onBeforeUnmount')
  if (!registration || !ts.isCallExpression(registration)) throw new Error('MandarinInstructor unmount hook not found')
  const callback = registration.arguments[0]
  if (!callback || !ts.isArrowFunction(callback)) throw new Error('MandarinInstructor unmount callback not found')
  const compiled = ts.transpile(`return (${script!.slice(callback.getStart(sourceFile), callback.end)})`, { target: ts.ScriptTarget.ES2022 })
  return new Function('window', 'onGlobalShortcut', 'textPracticeController', 'drawingObserver', 'saveTimer', 'clearTimeout', 'stopVoice', compiled) as (
    window: { removeEventListener: (...args: unknown[]) => void; speechSynthesis?: { cancel: () => void } },
    onGlobalShortcut: () => void,
    textPracticeController: AbortController,
    drawingObserver: { disconnect: () => void } | null,
    saveTimer: ReturnType<typeof setTimeout> | null,
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void,
    stopVoice: () => void,
  ) => () => void
}

function getClearButtonDisabled() {
  const button = template.match(/<button\b(?=[^>]*aria-label="Apagar somente o histórico local do curso; a sessão remota do Agent não será apagada")[^>]*>/)?.[0]
  const expression = button?.match(/:disabled="([^"]+)"/)?.[1]
  if (!expression) throw new Error('Mandarin chat clear button disabled binding not found')
  return new Function('progress', 'pendingStudentText', 'voice = { active: { value: false } }', `return ${expression}`) as (
    progress: { chat: unknown[] },
    pendingStudentText: string,
    voice?: { active: { value: boolean } },
  ) => boolean
}

describe('Mandarin local text chat cancellation', () => {
  it('keeps the clear button available for a pending first message without saved history', () => {
    const isDisabled = getClearButtonDisabled()

    expect(isDisabled({ chat: [] }, '你好')).toBe(false)
    expect(isDisabled({ chat: [] }, '')).toBe(true)
    expect(isDisabled({ chat: [{ text: 'mensagem salva' }] }, '')).toBe(false)
    expect(isDisabled({ chat: [] }, '', { active: { value: true } })).toBe(false)
  })

  it('aborts a pending text turn when clearing and does not restore chat or its local session link', async () => {
    const progress = { value: { chat: [{ text: 'mensagem anterior' }], chatSessionIds: { 'agent-1': 'local-link' } } }
    const chatDraft = { value: '  你好  ' }
    const newChatLine = vi.fn((role: string, text: string, mode: string) => ({ role, text, mode }))
    const sendTutorTurn = vi.fn((_text: string, _mode: 'text', signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Turno cancelado.', 'AbortError')), { once: true })
    }))
    const actions = compileChatActions()(progress, chatDraft, newChatLine, sendTutorTurn)

    const pending = actions.sendTextPractice()
    expect(sendTutorTurn).toHaveBeenCalledOnce()
    expect(sendTutorTurn.mock.calls[0][0]).toBe('你好')
    expect(sendTutorTurn.mock.calls[0][1]).toBe('text')
    const signal = sendTutorTurn.mock.calls[0][2]

    actions.clearChat()

    expect(signal.aborted).toBe(true)
    expect(progress.value.chat).toEqual([])
    expect(progress.value.chatSessionIds).toEqual({})
    await expect(pending).resolves.toBeUndefined()
    expect(progress.value.chat).toEqual([])
    expect(progress.value.chatSessionIds).toEqual({})
    expect(newChatLine).not.toHaveBeenCalled()
    expect(chatDraft.value).toBe('')
    expect(actions.pendingStudentText.value).toBe('')
  })

  it('aborts a pending text turn when the instructor unmounts', () => {
    const controller = new AbortController()
    const removeEventListener = vi.fn()
    const cancelSpeech = vi.fn()
    const cleanup = compileUnmountCleanup()(
      { removeEventListener, speechSynthesis: { cancel: cancelSpeech } },
      vi.fn(), controller, null, null, vi.fn(), vi.fn(),
    )

    cleanup()

    expect(controller.signal.aborted).toBe(true)
    expect(removeEventListener).toHaveBeenCalledOnce()
    expect(cancelSpeech).toHaveBeenCalledOnce()
  })

  it('ends an active voice turn locally before clearing history and never deletes the remote session', () => {
    const progress = { value: { chat: [{ text: 'fala anterior' }], chatSessionIds: { 'agent-1': 'local-link' } } }
    const actions = compileChatActions()(progress, { value: '' }, vi.fn(), vi.fn())
    actions.voice.active.value = true

    actions.clearChat()

    expect(actions.voiceSignal.aborted).toBe(true)
    expect(actions.stopVoiceCalls).toBe(1)
    expect(progress.value.chat).toEqual([])
    expect(progress.value.chatSessionIds).toEqual({})
    expect(actions.pendingStudentText.value).toBe('')
    const clearChat = script!.slice(script!.indexOf('function clearChat()'), script!.indexOf('function shortcutLabel'))
    expect(clearChat).toContain('if (voice.active.value) stopVoice()')
    expect(clearChat).not.toContain('studio.')
  })
})
