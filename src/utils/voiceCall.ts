// CyberManju OS — VozPonte call controller (src/utils/voiceCall.ts).
// Role: foreground, half-duplex voice conversation without bypassing agent permissions.
// Exports: VoiceCallController, VoiceCallPorts, VoiceCallState, speechText.
// Integrates: browser speech adapter and the existing agent prompt pipeline.
// Contracts: explicit start; no microphone during TTS; stale callbacks cannot restart a call.

export type VoiceCallState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'muted' | 'error'
export interface VoiceCallPorts {
  listen(final: (text: string) => void, error: (message: string) => void): void
  stopListening(): void
  speak(text: string, done: () => void, error: (message: string) => void): void
  stopSpeaking(): void
  send(text: string, signal: AbortSignal): Promise<string>
  changed(state: VoiceCallState, error: string): void
}

/** Omit code/URLs from speech, keep the full unmodified answer in the transcript. */
export function speechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' [code in chat] ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 6000)
}

export class VoiceCallController {
  state: VoiceCallState = 'idle'
  error = ''
  private generation = 0
  private request: AbortController | null = null
  private muted = false
  constructor(private readonly ports: VoiceCallPorts) {}
  get active(): boolean { return this.state !== 'idle' && this.state !== 'error' }
  private update(state: VoiceCallState, error = ''): void {
    this.state = state
    this.error = error
    this.ports.changed(state, error)
  }
  start(): void {
    this.end()
    this.muted = false
    this.listen(this.generation)
  }
  end(): void {
    this.generation++
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
  private listen(generation: number): void {
    if (generation !== this.generation) return
    if (this.muted) { this.update('muted'); return }
    this.update('listening')
    try {
      this.ports.listen(text => {
        if (generation !== this.generation || this.state !== 'listening' || !text.trim()) return
        this.update('thinking')
        this.ports.stopListening()
        const request = new AbortController()
        this.request = request
        void this.ports.send(text.trim(), request.signal).then(answer => {
          if (generation !== this.generation || request.signal.aborted) return
          const spoken = speechText(answer)
          if (!spoken) { this.listen(generation); return }
          this.update('speaking')
          this.ports.speak(spoken, () => {
            if (generation === this.generation && this.state === 'speaking') this.listen(generation)
          }, message => { if (generation === this.generation) this.fail(message) })
        }).catch(error => {
          if (generation === this.generation && !request.signal.aborted) this.fail(error instanceof Error ? error.message : String(error))
        })
      }, message => { if (generation === this.generation && this.state === 'listening') this.fail(message) })
    } catch (error) { this.fail(error instanceof Error ? error.message : String(error)) }
  }
}
