import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const instructor = readFileSync('src/components/MandarinInstructor.vue', 'utf8')
const orb = readFileSync('src/components/OrbNavigator.vue', 'utf8')
const template = instructor.split('<script setup lang="ts">')[0]
const script = instructor.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
if (!script) throw new Error('MandarinInstructor script setup not found')

function componentFunction(name: string) {
  const sourceFile = ts.createSourceFile('MandarinInstructor.ts', script!, ts.ScriptTarget.Latest, true)
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
  if (!declaration) throw new Error(`Component function not found: ${name}`)
  const code = script!.slice(declaration.getStart(sourceFile), declaration.end)
  const compiled = ts.transpile(code, { target: ts.ScriptTarget.ES2022 })
  return new Function(`${compiled}; return ${name}`)() as (...args: string[]) => string
}

const teacherOrbActivityFor = componentFunction('teacherOrbActivityFor')

describe('Language Teacher reuses the Home Orb as a voice-state teacher', () => {
  it('keeps the same OrbNavigator component and binds visual activity to the live tutor state', () => {
    expect(instructor).toContain("import OrbNavigator from '@/components/OrbNavigator.vue'")
    expect(template).toContain('<OrbNavigator :screen-index="0" :screen-count="1"')
    expect(template).toContain('teacher-mode :activity="teacherOrbActivity" :caption="teacherOrbCaption"')
    expect(script).toContain('teacherOrbActivityFor(progress.value.interactionMode, voice.state.value)')
    expect(orb).toContain(':data-activity="teacherMode ? activity : undefined"')
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
    expect(script).toContain("if (progress.value.interactionMode === 'text') return 'Modo Texto completo · microfone desligado'")
    expect(script).toContain('o microfone fica desligado até tocar em Iniciar')
  })

  it('animates listening, thinking and speaking distinctly while honoring reduced-motion settings', () => {
    expect(orb).toContain("data-activity='listening'")
    expect(orb).toContain("data-activity='thinking'")
    expect(orb).toContain("data-activity='speaking'")
    expect(orb).toContain('orb-teacher-listen')
    expect(orb).toContain('orb-teacher-think')
    expect(orb).toContain('orb-teacher-speak')
    expect(orb).toContain('.orb-navigator--teacher.motion-reduced .orb-core[data-activity]')
    expect(orb).toContain('@media (prefers-reduced-motion: reduce)')
    expect(instructor).toContain(':motion-reduced="motion.reduced.value"')
  })

  it('still starts microphone capture only from the explicit Start voice button', () => {
    expect(template).toContain('@click="startVoice"')
    expect(instructor).toContain("function setInteractionMode(mode: CourseInteractionMode)")
    const setMode = script!.match(/function setInteractionMode\(mode: CourseInteractionMode\) \{([\s\S]*?)\n\}/)?.[1]
    expect(setMode).toBeTruthy()
    expect(setMode).not.toContain('voice.start()')
    const startVoice = script!.match(/async function startVoice\(\) \{([\s\S]*?)\n\}/)?.[1]
    expect(startVoice).toContain('voice.start()')
    expect(template).toContain('O modo texto é completo e não pede permissão de microfone.')
  })
})
