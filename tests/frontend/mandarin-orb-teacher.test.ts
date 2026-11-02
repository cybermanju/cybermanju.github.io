// CyberManju OS — Mandarin orb teacher regression tests.
// Role: verifies instructor/orb behavior; Integrates: Vue source and course fixture contracts.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { compileStyle, parse } from '@vue/compiler-sfc'

const instructor = readFileSync('src/components/MandarinInstructor.vue', 'utf8')
const orb = readFileSync('src/components/OrbNavigator.vue', 'utf8')
const course = readFileSync('src/utils/mandarinCourse.ts', 'utf8')
const template = instructor.split('<script setup lang="ts">')[0]
const script = instructor.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
if (!script) throw new Error('MandarinInstructor script setup not found')

function componentFunction(name: string, parameters: string[] = []) {
  const sourceFile = ts.createSourceFile('MandarinInstructor.ts', script!, ts.ScriptTarget.Latest, true)
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
  if (!declaration) throw new Error(`Component function not found: ${name}`)
  const code = script!.slice(declaration.getStart(sourceFile), declaration.end)
  const compiled = ts.transpile(code, { target: ts.ScriptTarget.ES2022 })
  const factory = new Function(...parameters, `${compiled}; return ${name}`)
  return (parameters.length ? factory : factory()) as (...args: any[]) => any
}

const teacherOrbActivityFor = componentFunction('teacherOrbActivityFor')
const countExploredCourseStages = componentFunction('countExploredCourseStages')
const makeRecordLessonStage = componentFunction('recordLessonStage', ['progress'])
const makeLessonStageVisited = componentFunction('lessonStageVisited', ['progress'])
const makeLessonStageCount = componentFunction('lessonStageCount', ['progress', 'countExploredCourseStages'])

describe('Language Teacher reuses the Home Orb as a voice-state teacher', () => {
  it('limits light-theme inversion to the Orb canvas instead of inverting the document', () => {
    const { descriptor } = parse(instructor)
    const result = compileStyle({ source: descriptor.styles[0].content, id: 'data-v-test', scoped: true })
    expect(result.errors).toEqual([])
    expect(result.code).toContain('[data-ui-mode="light"] .language-learn .mi-teacher-dock__orb .orb-canvas')
    expect(result.code).not.toMatch(/\[data-ui-mode="light"\]\s*\{/)
  })

  it('keeps the same OrbNavigator component and binds visual activity to the live tutor state', () => {
    expect(instructor).toContain("import OrbNavigator from '@/components/OrbNavigator.vue'")
    expect(template).toContain('<OrbNavigator :screen-index="0" :screen-count="1"')
    expect(template).toContain('teacher-mode :activity="teacherOrbActivity" :caption="teacherOrbCaption"')
    expect(script).toContain('teacherOrbActivityFor(progress.value.interactionMode, voice.state.value, chatSendBusy.value)')
    expect(template).toContain('class="mi-teacher-dock"')
    expect(template).toContain('class="mi-orb-dialog mi-orb-dialog--floating" role="status" aria-live="polite"')
    expect(template).toContain('class="mi-teacher-dock__orb"><OrbNavigator')
    expect(orb).toContain(':data-activity="teacherMode ? activity : undefined"')
    expect(orb).toContain(':data-activity="teacherMode ? activity : undefined" :role="teacherMode ? \'img\' : undefined"')
    expect(orb).toContain(':aria-hidden="teacherMode || undefined"')
    expect(orb).toContain('if (props.disabled || props.teacherMode || !event.isPrimary')
    expect(orb).toContain('if (props.disabled || props.teacherMode) return')
  })

  it('keeps the Orb idle in complete Text mode regardless of voice state and reflects voice states only in Voz mode', () => {
    const states = ['idle', 'listening', 'thinking', 'speaking', 'muted', 'error']
    for (const state of states) {
      expect(teacherOrbActivityFor('text', state), `text mode / ${state}`).toBe('idle')
      expect(teacherOrbActivityFor('voice', state), `voice mode / ${state}`).toBe(state)
    }
    expect(teacherOrbActivityFor('text', 'listening', true)).toBe('thinking')
    expect(teacherOrbActivityFor('voice', 'listening', true)).toBe('listening')
    expect(teacherOrbActivityFor('voice', 'idle', true)).toBe('thinking')
    expect(script).toContain("if (progress.value.interactionMode === 'text') return 'Modo Texto completo · microfone desligado'")
    expect(script).toContain('o microfone fica desligado até tocar em Iniciar')
    expect(script).toContain("progress.value.interactionMode !== 'voice'")
    expect(script).toContain("if (voice.state.value === 'speaking' && latestTutorLine.value) return speechText(latestTutorLine.value.text)")
    expect(template).toContain(':disabled="!hydrated || progress.interactionMode === \'text\' || voice.active.value"')
  })

  it('renders a live Orb dialogue, provisional student/tutor bubbles, and prevents duplicate sends', () => {
    expect(template).toContain('class="mi-orb-dialog mi-orb-dialog--floating" role="status" aria-live="polite"')
    expect(template).toContain('v-if="pendingStudentText" class="mi-chat-line mi-chat-line--student mi-chat-line--pending"')
    expect(template).toContain('mi-chat-line--thinking')
    expect(template).toContain('role="progressbar"')
    expect(template).toContain('|| chatSendBusy')
  })

  it('provides mobile lesson selection, all five visible stages, readable inputs, and touch targets', () => {
    expect(template).toContain('aria-haspopup="dialog" aria-controls="mandarin-lesson-sheet"')
    expect(template).toContain('<dialog id="mandarin-lesson-sheet"')
    expect(script).toContain('dialog.showModal()')
    expect(instructor).toContain('grid-template-columns: 1fr 1fr 88px 1fr 1fr')
    expect(template).toContain('class="mi-stage-nav ll-bottom-navigation"')
    expect(template).toContain('@pointerup="onTeacherOrbPointerUp"')
    expect(instructor).toContain('min-height: 48px; border-radius: 12px; font-size: 16px')
    expect(instructor).toContain('min-width: 44px; width: 44px; min-height: 44px')
    expect(instructor).toContain('env(safe-area-inset-bottom, 0px)')
    expect(template).toContain('Como alternativa acessível, use o campo de escrita')
  })

  it('counts only the four learning milestones and persists their visit times', () => {
    expect(countExploredCourseStages({ learn: '2026-11-01T12:00:00Z', write: '2026-11-01T12:01:00Z' })).toBe(2)
    expect(countExploredCourseStages({ sources: '2026-11-01T12:02:00Z' })).toBe(0)
    expect(countExploredCourseStages(undefined)).toBe(0)
    expect(course).toContain('lessonStageVisits: Partial<Record<LessonId, Partial<Record<CourseStage, string>>>>')
    expect(instructor).toContain('Number.isFinite(Date.parse(timestamp))')

    const progress = { value: { lessonStageVisits: {} as Record<string, Record<string, string>> } }
    const recordLessonStage = makeRecordLessonStage(progress)
    const lessonStageVisited = makeLessonStageVisited(progress)
    const lessonStageCount = makeLessonStageCount(progress, countExploredCourseStages)
    recordLessonStage('context', 'learn')
    const firstVisit = progress.value.lessonStageVisits.context.learn
    recordLessonStage('context', 'learn')
    recordLessonStage('context', 'write')
    recordLessonStage('context', 'sources')
    expect(progress.value.lessonStageVisits.context.learn).toBe(firstVisit)
    expect(lessonStageVisited('context', 'write')).toBe(true)
    expect(lessonStageCount('context')).toBe(2)
  })

  it('animates listening, thinking and speaking distinctly while honoring reduced-motion settings', () => {
    expect(orb).toContain("data-activity='listening'")
    expect(orb).toContain("data-activity='thinking'")
    expect(orb).toContain("data-activity='speaking'")
    expect(orb).toContain('orb-teacher-listen')
    expect(orb).toContain('orb-teacher-think')
    expect(orb).toContain('orb-teacher-speak')
    expect(orb).toContain('.orb-navigator--teacher.motion-reduced .orb-core[data-activity]')
    expect(orb).toContain('orb-teacher-ripple')
    expect(orb).toContain('orb-teacher-orbit')
    expect(orb).toContain('@media (prefers-reduced-motion: reduce)')
    expect(instructor).toContain(':motion-reduced="motion.reduced.value"')
  })

  it('starts microphone capture only after mode opt-in and explicit button or Orb action', () => {
    expect(template).toContain('@click="startVoice"')
    expect(instructor).toContain("function setInteractionMode(mode: CourseInteractionMode)")
    const setMode = script!.match(/function setInteractionMode\(mode: CourseInteractionMode\) \{([\s\S]*?)\n\}/)?.[1]
    expect(setMode).toBeTruthy()
    expect(setMode).not.toContain('voice.start()')
    const startVoice = script!.match(/async function startVoice\(\) \{([\s\S]*?)\n\}/)?.[1]
    expect(startVoice).toContain('voice.start()')
    expect(template).toContain('@click="onTeacherOrbTap"')
    expect(script).toContain("if (progress.value.interactionMode !== 'voice')")
    expect(script).toContain('if (!voice.pushToTalkSupported)')
    expect(template).toContain('O modo texto é completo e não pede permissão de microfone.')
  })
})
