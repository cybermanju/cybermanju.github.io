// CyberManju OS — shared course interaction policy.
// Role: normalizes course text/voice mode; Integrates: Mandarin course and voice availability.
// Shared Language Teacher interaction policy.
// Text is always available and is the default; voice requires an explicit mode choice and a supported runtime.
export type CourseInteractionMode = 'text' | 'voice'

export function normalizeCourseInteractionMode(value: unknown): CourseInteractionMode {
  return value === 'voice' ? 'voice' : 'text'
}

export function canStartCourseVoice(mode: CourseInteractionMode, voiceSupported: boolean): boolean {
  return mode === 'voice' && voiceSupported
}
