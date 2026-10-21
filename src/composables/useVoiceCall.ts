// CyberManju OS — VozPonte browser speech adapter (src/composables/useVoiceCall.ts).
// Role: adapt foreground browser speech to the permission-preserving call controller.
// Exports: useVoiceCall.
// Integrates: Web Speech API and the existing agent send callback.
// Contracts: permission errors stop; hiding/unmounting ends capture; no background listening.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { VoiceCallController, type VoiceCallState } from '@/utils/voiceCall'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition
  webkitSpeechRecognition?: new () => Recognition
}

export function useVoiceCall(send: (text: string, signal: AbortSignal) => Promise<string>, lang: () => string) {
  const state = ref<VoiceCallState>('idle')
  const error = ref('')
  const muted = ref(false)
  const speechWindow = typeof window === 'undefined' ? undefined : window as SpeechWindow
  const RecognitionClass = speechWindow?.SpeechRecognition ?? speechWindow?.webkitSpeechRecognition
  const supported = !!RecognitionClass && !!speechWindow?.speechSynthesis
  let recognition: Recognition | null = null
  let utterance: SpeechSynthesisUtterance | null = null
  let restart: ReturnType<typeof setTimeout> | undefined
  let listenEpoch = 0
  let emptyEnds = 0
  function stopListening() {
    listenEpoch++
    clearTimeout(restart)
    const old = recognition
    recognition = null
    if (old) {
      old.onend = old.onerror = old.onresult = null
      old.abort()
    }
  }
  function stopSpeaking() {
    if (utterance) { utterance.onend = utterance.onerror = null; utterance = null }
    speechWindow?.speechSynthesis?.cancel()
  }
  const controller = new VoiceCallController({
    changed(next, detail) { state.value = next; error.value = detail },
    stopListening,
    stopSpeaking,
    send,
    listen(final, failed) {
      if (!RecognitionClass) throw new Error('Speech recognition is unavailable in this browser/WebView. Use text or the Android VozPonte app.')
      stopListening()
      const epoch = listenEpoch
      function begin() {
        if (epoch !== listenEpoch) return
        const rec = new RecognitionClass!()
        recognition = rec
        rec.lang = lang()
        rec.continuous = false
        rec.interimResults = false
        rec.onresult = event => {
          if (epoch !== listenEpoch) return
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i]
            if (result?.isFinal && result[0].transcript.trim()) {
              emptyEnds = 0
              final(result[0].transcript)
              return
            }
          }
        }
        rec.onerror = event => {
          if (epoch !== listenEpoch || event.error === 'aborted') return
          if (event.error !== 'no-speech') failed(`Microphone: ${event.error}. Check permission and speech provider, then start again.`)
        }
        rec.onend = () => {
          if (epoch !== listenEpoch) return
          // Some engines stop after silence. Bound restarts to avoid a hot permission loop.
          if (++emptyEnds > 5) { failed('No speech detected. Start the call again when ready.'); return }
          restart = setTimeout(begin, 350)
        }
        try { rec.start() } catch (cause) { failed(cause instanceof Error ? cause.message : String(cause)) }
      }
      begin()
    },
    speak(text, done, failed) {
      stopSpeaking()
      utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = lang()
      utterance.onend = done
      utterance.onerror = event => failed(`Speech output: ${event.error}. The answer remains in chat.`)
      speechWindow!.speechSynthesis.speak(utterance)
    },
  })
  function end() { controller.end(); muted.value = false }
  function start() { emptyEnds = 0; muted.value = false; controller.start() }
  function toggleMute() { muted.value = !muted.value; controller.setMuted(muted.value) }
  function visibility() { if (document.hidden) end() }
  onMounted(() => document.addEventListener('visibilitychange', visibility))
  onBeforeUnmount(() => { end(); document.removeEventListener('visibilitychange', visibility) })
  return { state, error, muted, supported, active: computed(() => state.value !== 'idle' && state.value !== 'error'), start, end, toggleMute, interrupt: () => controller.interrupt() }
}
