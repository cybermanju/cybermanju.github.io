// Voice input for the agent prompt, the code editor, and cybsh.
//
// Wraps VueUse `useSpeechRecognition` with a mode-aware correction
// pipeline (src/utils/speechCorrect): final transcripts are normalised
// (spoken punctuation → marks, code words → symbols, shell homophones →
// verbs) and appended to the target field. Interim results are exposed
// for a live "hearing…" hint. Unsupported browsers get `isSupported=false`
// so mic buttons hide instead of failing.

import { computed, ref, watch, type Ref } from 'vue'
import { useSpeechRecognition } from '@vueuse/core'
import { correctShellLine, normalizeSpoken, type VoiceMode } from './speechCorrect'

export type { VoiceMode }

export interface VoiceInsert {
  /** Text after the mode pipeline (what was actually inserted). */
  text: string
  /** Shell-mode dictionary fixes applied, e.g. `lss→ls`. Empty otherwise. */
  fixes: string[]
}

export function useVoiceInput(mode: VoiceMode = 'prose') {
  const rec = useSpeechRecognition({ lang: 'en-US', continuous: true })
  const activeMode = ref<VoiceMode>(mode)
  const lastInsert = ref<VoiceInsert | null>(null)
  const lastError = ref('')

  const listening = computed(() => rec.isListening.value)
  const interim = computed(() => (rec.isFinal.value ? '' : rec.result.value))

  watch(
    () => rec.error.value,
    (e) => {
      lastError.value = e ? String((e as Error)?.message ?? e) : ''
    },
  )

  function transform(raw: string): VoiceInsert {
    if (activeMode.value === 'shell') {
      const fixed = correctShellLine(normalizeSpoken(raw, 'shell'))
      return { text: fixed.line, fixes: fixed.fixes }
    }
    return { text: normalizeSpoken(raw, activeMode.value), fixes: [] }
  }

  /**
   * Start dictation into `target`: each FINAL transcript is corrected and
   * appended (space-joined). Stops automatically appending on `stop()`.
   * Returns an unsubscribe fn — call it (or `stop()`) on unmount.
   */
  function dictateInto(target: Ref<string>): () => void {
    let consumed = ''
    const stopWatch = watch(
      () => rec.result.value,
      (text) => {
        if (!rec.isFinal.value || !text || text === consumed) return
        consumed = text
        const ins = transform(text)
        lastInsert.value = ins
        target.value = target.value ? `${target.value} ${ins.text}` : ins.text
      },
    )
    try {
      rec.start()
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    }
    return () => {
      stopWatch()
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
  }

  function toggle() {
    try {
      rec.toggle()
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    isSupported: rec.isSupported,
    listening,
    interim,
    isFinal: rec.isFinal,
    confidence: rec.confidence,
    lastInsert,
    lastError,
    mode: activeMode,
    transform,
    dictateInto,
    toggle,
    start: rec.start,
    stop: rec.stop,
  }
}
