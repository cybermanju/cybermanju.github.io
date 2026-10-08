// Voice input for the agent prompt, the code editor, and cybsh.
//
// Wraps VueUse `useSpeechRecognition` with a mode-aware correction
// pipeline (src/utils/speechCorrect): final transcripts are normalised
// (spoken punctuation → marks, code words → symbols, shell homophones →
// verbs) and appended to the target field. Interim results are exposed
// for a live "hearing…" hint. Unsupported browsers get `isSupported=false`
// so mic buttons hide instead of failing.
//
// Languages: `en-US` + `pt-BR`. The default comes from the browser
// (`navigator.language` → pt-* ⇒ pt-BR) and the user's pick persists in
// localStorage, so a Brazilian user dictates in Portuguese on every visit
// without re-selecting. Switching `lang` re-targets both the STT engine
// (reactive `useSpeechRecognition` lang) and the correction tables.

import { computed, ref, watch, type Ref } from 'vue'
import { useSpeechRecognition } from '@vueuse/core'
import {
  correctShellLine,
  detectVoiceLang,
  isPtLang,
  normalizeSpoken,
  VOICE_LANG_STORAGE_KEY,
  type VoiceLang,
  type VoiceMode,
} from '../utils/speechCorrect'

export type { VoiceLang, VoiceMode }
export { VOICE_LANG_STORAGE_KEY, detectVoiceLang, isPtLang }

export interface VoiceInsert {
  /** Text after the mode pipeline (what was actually inserted). */
  text: string
  /** Shell-mode dictionary fixes applied, e.g. `lss→ls`. Empty otherwise. */
  fixes: string[]
}

function loadStoredLang(): VoiceLang | null {
  try {
    const raw = localStorage.getItem(VOICE_LANG_STORAGE_KEY)
    if (raw === 'pt-BR' || raw === 'en-US') return raw
  } catch {
    /* private mode / SSR */
  }
  return null
}

export function useVoiceInput(mode: VoiceMode = 'prose', initialLang?: VoiceLang) {
  const lang = ref<VoiceLang>(initialLang ?? loadStoredLang() ?? detectVoiceLang())
  const rec = useSpeechRecognition({ lang, continuous: true })
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

  watch(lang, (v) => {
    try {
      localStorage.setItem(VOICE_LANG_STORAGE_KEY, v)
    } catch {
      /* private mode — lang still applies for this session */
    }
  })

  function setLang(next: VoiceLang): void {
    if (lang.value === next) return
    const wasListening = rec.isListening.value
    // VueUse only applies `lang` to the engine while idle, so restart.
    if (wasListening) {
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
    lang.value = next
  }

  function toggleLang(): VoiceLang {
    const next: VoiceLang = lang.value === 'pt-BR' ? 'en-US' : 'pt-BR'
    setLang(next)
    return next
  }

  function transform(raw: string): VoiceInsert {
    if (activeMode.value === 'shell') {
      const fixed = correctShellLine(normalizeSpoken(raw, 'shell', lang.value))
      return { text: fixed.line, fixes: fixed.fixes }
    }
    return { text: normalizeSpoken(raw, activeMode.value, lang.value), fixes: [] }
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
    lang,
    setLang,
    toggleLang,
    transform,
    dictateInto,
    toggle,
    start: rec.start,
    stop: rec.stop,
  }
}
