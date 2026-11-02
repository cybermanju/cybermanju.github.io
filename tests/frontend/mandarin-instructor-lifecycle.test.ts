// CyberManju OS — Mandarin instructor lifecycle tests.
// Role: verifies component lifecycle behavior; Integrates: instructor source and Vue test utilities.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'

const instructor = readFileSync('src/components/MandarinInstructor.vue', 'utf8')
const template = instructor.split('<script setup lang="ts">')[0]

function compileTutorTurn() {
  const script = instructor.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
  if (!script) throw new Error('MandarinInstructor script setup not found')
  const sourceFile = ts.createSourceFile('MandarinInstructor.ts', script, ts.ScriptTarget.Latest, true)
  const targets = new Set(['ensureTutorTurnActive', 'sendTutorTurn'])
  const declarations = sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && !!statement.name && targets.has(statement.name.text),
  )
  if (declarations.length !== targets.size) throw new Error('Tutor turn functions not found')
  const code = declarations.map(node => script.slice(node.getStart(sourceFile), node.end)).join('\n')
  const compiled = ts.transpile(code, { target: ts.ScriptTarget.ES2022 })
  return new Function(
    'studio', 'progress', 'tutorPrompt', 'waitForTutorReply', 'newChatLine', 'chatList', 'nextTick',
    `${compiled}; return sendTutorTurn`,
  ) as (
    studio: any,
    progress: any,
    tutorPrompt: (text: string, lessonId?: string) => string,
    waitForTutorReply: (...args: any[]) => Promise<string>,
    newChatLine: (...args: any[]) => any,
    chatList: null,
    nextTick: (callback: () => void) => Promise<void>,
  ) => (text: string, mode: 'voice' | 'text', signal?: AbortSignal) => Promise<string>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function createStudio(options: {
  configId?: string
  loadSession?: () => Promise<void>
  newSession?: () => Promise<any>
} = {}) {
  const configId = options.configId ?? 'agent-1'
  const session = { id: 'remote-session-1', configId, messages: [] as any[] }
  const studio: any = {
    chatConfigId: { value: configId },
    jobActive: { value: false },
    viewing: { value: null as any },
    loadSession: vi.fn(async () => {
      await options.loadSession?.()
      studio.viewing.value = session
    }),
    setViewing: vi.fn((value: any) => { studio.viewing.value = value }),
    newSession: vi.fn(async () => {
      await options.newSession?.()
      studio.viewing.value = session
      return session
    }),
    send: vi.fn(async () => true),
  }
  return { studio, session }
}

function runTurn(studio: any, progress: any, signal: AbortSignal, mode: 'voice' | 'text' = 'voice') {
  const sendTutorTurn = compileTutorTurn()(studio, progress, () => 'prompt', async () => 'resposta', (role, text, mode) => ({ role, text, mode }), null, async () => {})
  return sendTutorTurn('olá', mode, signal)
}

describe('Mandarin instructor UI and voice lifecycle', () => {
  it.each([
    ['loading an existing remote session', 'loadSession'],
    ['creating a remote session', 'newSession'],
  ])('does not send if voice is ended while %s', async (_label, operation) => {
    const gate = deferred<void>()
    const options = operation === 'loadSession'
      ? { loadSession: () => gate.promise }
      : { newSession: () => gate.promise }
    const { studio } = createStudio(options)
    const progress = { value: {
      chatSessionIds: operation === 'loadSession' ? { 'agent-1': 'remote-session-1' } : {},
      chat: [],
    } }
    const controller = new AbortController()
    const pending = runTurn(studio, progress, controller.signal)

    controller.abort()
    gate.resolve()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(studio.send).not.toHaveBeenCalled()
  })

  it.each(['text', 'voice'] as const)('routes the turn through the selected custom Agent config in %s mode', async mode => {
    const configId = 'custom-agent-config'
    const { studio } = createStudio({ configId })
    const progress = { value: { chatSessionIds: {} as Record<string, string>, chat: [] as any[] } }

    await runTurn(studio, progress, new AbortController().signal, mode)

    expect(studio.newSession).toHaveBeenCalledOnce()
    expect(studio.send).toHaveBeenCalledOnce()
    expect(progress.value.chatSessionIds[configId]).toBe('remote-session-1')
    expect(progress.value.chat.map((line: any) => line.text)).toEqual(['olá', 'resposta'])
    expect(progress.value.chat.map((line: any) => line.mode)).toEqual([mode, mode])
    expect(studio.chatConfigId.value).toBe(configId)
  })

  it('keeps the original lesson context when the student changes lessons during session loading', async () => {
    const gate = deferred<void>()
    const { studio } = createStudio({ loadSession: () => gate.promise })
    const progress = { value: { activeLessonId: 'context', chatSessionIds: { 'agent-1': 'remote-session-1' }, chat: [] as any[] } }
    const tutorPrompt = vi.fn((text: string, lessonId?: string) => `${text}:${lessonId}`)
    const sendTutorTurn = compileTutorTurn()(studio, progress, tutorPrompt, async () => 'resposta',
      (role, text, mode, lessonId) => ({ role, text, mode, lessonId }), null, async () => {})
    const pending = sendTutorTurn('olá', 'text', new AbortController().signal)

    progress.value.activeLessonId = 'sounds'
    gate.resolve()
    await pending

    expect(tutorPrompt).toHaveBeenCalledWith('olá', 'context')
    expect(studio.send).toHaveBeenCalledWith('olá:context')
    expect(progress.value.chat.map((line: any) => line.lessonId)).toEqual(['context', 'context'])
  })

  it('makes text the default and requires explicit voice mode before a mic start', () => {
    expect(template).toContain('O modo texto é completo e não pede permissão de microfone.')
    expect(template).toContain('Escolher Voz não liga o microfone.')
    expect(template).toContain('Iniciar conversa por voz')
    expect(instructor).toContain("interactionMode: normalizeCourseInteractionMode(input.interactionMode)")
    expect(instructor).toContain('canStartCourseVoice(progress.value.interactionMode, voice.supported)')
    expect(instructor).toContain("progress.value.interactionMode !== 'voice'")
  })

  it('labels transcript clearing as local-only and leaves remote Agent sessions untouched', () => {
    expect(template).toContain('HISTÓRICO LOCAL DO CURSO')
    expect(template).toContain('Apagar somente o histórico local do curso; a sessão remota do Agent não será apagada')
    expect(template).toContain('a sessão remota do Agent continua em Agents')
    const clearChat = instructor.slice(instructor.indexOf('function clearChat()'), instructor.indexOf('function shortcutLabel'))
    expect(clearChat).toContain('progress.value.chat = []')
    expect(clearChat).toContain('progress.value.chatSessionIds = {}')
    expect(clearChat).not.toContain('studio.')
  })

  it('surfaces the structured pedagogy fields without leaking answer keys before 2/3', () => {
    for (const field of [
      'languagePoints', 'communicativeFunctions', 'explanations', 'listeningPractice',
      'pronunciationPractice', 'writingTasks', 'characterSamples', 'exerciseBank', 'readingSummaries',
      'referenceIndexes', 'sourceContextNotes', 'pageSummaries',
    ]) expect(template).toContain(`activePedagogy.${field}`)

    expect(instructor).toMatch(/const quizSolutionsUnlocked = computed\(\(\) => quizPassingScore\.value > 0 && \(progress\.value\.bestQuizScores\[activeLessonId\.value\] \?\? 0\) >= quizPassingScore\.value\)/)
    expect(instructor).toContain('buildTutorQuizContext(lesson.questions, solutionsUnlocked)')
    expect(instructor).toContain('(progress.value.bestQuizScores[lesson.id] ?? 0) >= passingScore')
    expect(template).toMatch(/v-if="quizSolutionsUnlocked[^\"]*"[^>]*class="mi-pedagogy-answer">Resposta de referência: \{\{ item\.expectedAnswer \}\}/)
    expect(template).toMatch(/v-if="quizSolutionsUnlocked[^\"]*"[^>]*class="mi-pedagogy-answer">Modelo de referência: \{\{ item\.modelAnswer \}\}/)
    expect(template).toMatch(/v-if="quizSolutionsUnlocked[^\"]*"[^>]*class="mi-pedagogy-answer">\{\{ question\.answer \}\}/)
  })
})
