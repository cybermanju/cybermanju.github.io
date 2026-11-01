// CyberManju OS — course interaction policy tests.
// Role: verifies text/voice mode behavior; Integrates: Mandarin course defaults and voice eligibility.
import { describe, expect, it } from 'vitest'
import { MANDARIN_LESSONS, defaultMandarinProgress } from '@/utils/mandarinCourse'
import { canStartCourseVoice, normalizeCourseInteractionMode } from '@/utils/courseInteraction'

describe('Language Teacher interaction modes', () => {
  it('defaults to complete text mode and never starts voice from mode selection alone', () => {
    expect(defaultMandarinProgress().interactionMode).toBe('text')
    expect(normalizeCourseInteractionMode(undefined)).toBe('text')
    expect(normalizeCourseInteractionMode('unexpected')).toBe('text')
    expect(normalizeCourseInteractionMode('voice')).toBe('voice')
    expect(canStartCourseVoice('text', true)).toBe(false)
    expect(canStartCourseVoice('voice', false)).toBe(false)
    expect(canStartCourseVoice('voice', true)).toBe(true)
  })

  it('keeps keyboard/text learning material and exercises in every unit without voice', () => {
    const progress = defaultMandarinProgress()
    expect(MANDARIN_LESSONS).toHaveLength(29)
    for (const lesson of MANDARIN_LESSONS) {
      expect(progress.interactionMode, lesson.id).toBe('text')
      expect(lesson.practicePrompt.trim(), `${lesson.id} practice prompt`).not.toBe('')
      expect(lesson.writingPrompt.trim(), `${lesson.id} writing prompt`).not.toBe('')
      expect(lesson.examples.length, `${lesson.id} text examples`).toBeGreaterThan(0)
      expect(lesson.exercises.length, `${lesson.id} text exercises`).toBeGreaterThan(0)
      expect(lesson.questions.length, `${lesson.id} text quiz`).toBeGreaterThan(0)
    }
  })
})
