// CyberManju OS — VozPonte call controller (src/utils/voiceCall.ts).
// Role: foreground, half-duplex voice conversation without bypassing agent permissions.
// Exports: VoiceCallController, VoiceCallPorts, VoiceCallState, speechText.
// Integrates: browser speech adapter and the existing agent prompt pipeline.
// Contracts: explicit start; no microphone during TTS; stale callbacks cannot restart a call.

export type VoiceCallState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'muted' | 'error'
export interface VoiceCallPorts {
  listen(final: (text: string) => void, error: (message: string) => void, ended?: () => void, singleTurn?: boolean): void
  stopListening(): void
  /** Ask a recognizer to finish naturally, preserving its pending final-result callback. */
  finishListening?(): void
  speak(text: string, done: () => void, error: (message: string) => void): void
  stopSpeaking(): void
  send(text: string, signal: AbortSignal): Promise<string>
  changed(state: VoiceCallState, error: string): void
}

/** Omit code/URLs from speech, keep the full unmodified answer in the transcript. */
export function speechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' [code in chat] ')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 6000)
}

const HOLD_FINISH_WATCHDOG_MS = 2_000

export class VoiceCallController {
  state: VoiceCallState = 'idle'
  error = ''
  private generation = 0
  private request: AbortController | null = null
  private muted = false
  private singleTurn = false
  private holdReleased = false
  private holdWatchdog: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly ports: VoiceCallPorts) {}
  get active(): boolean { return this.state !== 'idle' && this.state !== 'error' }
  private update(state: VoiceCallState, error = ''): void {
    this.state = state
    this.error = error
    this.ports.changed(state, error)
  }
  start(options: { singleTurn?: boolean } = {}): void {
    this.end()
    this.muted = false
    this.singleTurn = options.singleTurn === true
    this.holdReleased = false
    this.listen(this.generation)
  }
  /** Release only an active capture; a pending answer/TTS is never cancelled. */
  finishHold(): void {
    if (!this.singleTurn || this.state !== 'listening' || this.holdReleased) return
    this.holdReleased = true
    clearTimeout(this.holdWatchdog)
    this.holdWatchdog = setTimeout(() => {
      if (this.holdReleased && this.state === 'listening') {
        this.fail('No speech recognition result arrived after release. Start the call again when ready.')
      }
    }, HOLD_FINISH_WATCHDOG_MS)
    try { this.ports.finishListening?.() }
    catch (cause) { this.fail(cause instanceof Error ? cause.message : String(cause)) }
  }
  end(): void {
    this.generation++
    clearTimeout(this.holdWatchdog)
    this.holdWatchdog = undefined
    this.holdReleased = false
    this.singleTurn = false
    this.request?.abort()
    this.request = null
    this.ports.stopListening()
    this.ports.stopSpeaking()
    this.update('idle')
  }
  fail(message: string): void {
    this.end()
    this.update('error', message)
  }
  setMuted(muted: boolean): void {
    if (!this.active) return
    this.muted = muted
    if (muted && this.state === 'listening') {
      // Change state BEFORE aborting: synchronous late finals must be ignored.
      this.generation++
      this.update('muted')
      this.ports.stopListening()
    } else if (!muted && this.state === 'muted') this.listen(this.generation)
  }
  /** Explicit barge-in: cancel spoken output, then listen (never simultaneous capture). */
  interrupt(): void {
    if (this.state !== 'speaking') return
    this.generation++
    this.ports.stopSpeaking()
    this.listen(this.generation)
  }
  private finishSingleTurn(): void {
    if (this.singleTurn) this.end()
  }
  private listen(generation: number): void {
    if (generation !== this.generation) return
    if (this.muted) { this.update('muted'); return }
    // Each listen/reply cycle owns a fresh epoch, not just each entire call.
    // Providers may deliver a late final/error/done after the next turn starts.
    generation = ++this.generation
    const singleTurn = this.singleTurn
    this.update('listening')
    try {
      this.ports.listen(text => {
        if (generation !== this.generation || this.state !== 'listening' || !text.trim()) return
        clearTimeout(this.holdWatchdog)
        this.holdWatchdog = undefined
        this.update('thinking')
        this.ports.stopListening()
        const request = new AbortController()
        this.request = request
        void this.ports.send(text.trim(), request.signal).then(answer => {
          if (generation !== this.generation || request.signal.aborted) return
          this.request = null
          const spoken = speechText(answer)
          if (!spoken) {
            if (singleTurn) this.finishSingleTurn()
            else this.listen(generation)
            return
          }
          this.update('speaking')
          this.ports.speak(spoken, () => {
            if (generation !== this.generation || this.state !== 'speaking') return
            if (singleTurn) this.finishSingleTurn()
            else this.listen(generation)
          }, message => { if (generation === this.generation) this.fail(message) })
        }).catch(error => {
          if (generation === this.generation && !request.signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
        })
      }, message => { if (generation === this.generation && this.state === 'listening') this.fail(message) }, () => {
        if (generation !== this.generation || this.state !== 'listening') return
        if (singleTurn || this.holdReleased) this.fail('No speech detected. Start the call again when ready.')
      }, singleTurn)
    } catch (error) { this.fail(error instanceof Error ? error.message : String(error)) }
  }
}
