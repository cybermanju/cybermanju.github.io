// CyberManju OS — Mandarin chat cancellation tests (tests/frontend/mandarin-chat-cancel.test.ts).
// Role: protect local transcript clearing against late text tutor turns.
// Contracts: clearChat aborts local work; cancelled sends cannot restore local history.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'

const instructor = readFileSync('src/components/MandarinInstructor.vue', 'utf8')
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
    `let chatSendBusy = false; let textPracticeController = null; ${compiled}; return { sendTextPractice, clearChat }`,
  ) as (
    progress: { value: { chat: unknown[]; chatSessionIds: Record<string, string> } },
    chatDraft: { value: string },
    newChatLine: (...args: unknown[]) => unknown,
    sendTutorTurn: (text: string, mode: 'text', signal: AbortSignal) => Promise<string>,
  ) => { sendTextPractice: () => Promise<void>; clearChat: () => void }
}

describe('Mandarin local text chat cancellation', () => {
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
  })
})
