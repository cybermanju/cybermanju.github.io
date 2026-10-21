// CyberManju OS — Android VozPonte adapter (src/utils/androidVoice.ts).
// Role: device-local JNI speech and explicit native notification/accessibility controls.
// Exports: androidVoiceCommand, isNativeAndroid, AndroidVoiceAudio and bridge data types.
// Integrates: bundled Tauri IPC only; never REST or agent tools.
// Contracts: ordered commands, foreground half-duplex audio, stale events ignored; no notification upload.
import { invoke } from '@tauri-apps/api/core'
import { isAndroidApp, isTauri } from '@/composables/useTauri'

export interface AndroidVoiceStatus {
  android: boolean
  recognitionAvailable: boolean
  microphoneGranted: boolean
  notificationAccess: boolean
  accessibilityEnabled: boolean
  selectedPackages: string[]
}
export interface AndroidVoiceNotification {
  key: string
  packageName: string
  appLabel: string
  title: string
  text: string
  timestamp: number
  canReply: boolean
}
interface AudioEvent {
  id: string
  type: 'final' | 'end' | 'error' | 'spoken'
  text?: string
  error?: string
}
export type AndroidVoiceCommand = <T>(action: string, payload?: Record<string, unknown>) => Promise<T>
export function isNativeAndroid(): boolean { return isTauri() && isAndroidApp() }
let commandQueue: Promise<unknown> = Promise.resolve()
/** Direct core IPC deliberately avoids transport fallback and credentials in REST. */
export function androidVoiceCommand<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isNativeAndroid()) return Promise.reject(new Error('unsupported: Android native services require the Android app'))
  const run = commandQueue.then(() => invoke<T>('android_voice_command', { action, payload }))
  commandQueue = run.catch(() => undefined)
  return run
}
let nextId = 0
const audioSessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
interface PendingAudio {
  id: string
  kind: 'listen' | 'speak'
  deadline: number
  final?: (text: string) => void
  done?: () => void
  failed: (message: string) => void
}
/** Audio events are polled only during an explicitly started foreground turn. */
export class AndroidVoiceAudio {
  private pending: PendingAudio | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly command: AndroidVoiceCommand = androidVoiceCommand) {}
  private clear(): void { clearTimeout(this.timer); this.timer = undefined; this.pending = null }
  private fail(pending: PendingAudio, cause: unknown): void {
    if (this.pending !== pending) return
    this.clear()
    // The adapter owns capture/output cleanup even if its caller only displays
    // the error. Queue this before a failed callback can start another turn.
    void this.command(pending.kind === 'listen' ? 'stopListening' : 'stopSpeaking').catch(() => undefined)
    pending.failed(cause instanceof Error ? cause.message : String(cause))
  }
  private schedule(pending: PendingAudio): void {
    if (this.pending !== pending) return
    this.timer = setTimeout(() => { void this.poll(pending) }, 150)
  }
  private async poll(pending: PendingAudio): Promise<void> {
    try {
      if (Date.now() > pending.deadline) {
        this.fail(pending, 'Android speech timed out. Check the speech provider, then start again.')
        return
      }
      const result = await this.command<{ events: AudioEvent[] }>('poll')
      if (this.pending !== pending) return
      for (const event of result.events) {
        if (this.pending !== pending) return
        if (event.id !== pending.id) continue
        if (event.type === 'error') { this.fail(pending, event.error || 'Android speech failed. Check microphone permission and speech provider.'); return }
        if (event.type === 'final' && pending.kind === 'listen' && event.text?.trim()) {
          this.clear(); pending.final?.(event.text); return
        }
        if (event.type === 'end' && pending.kind === 'listen') {
          this.fail(pending, 'No speech detected. Start the call again when ready.'); return
        }
        if (event.type === 'spoken' && pending.kind === 'speak') {
          this.clear(); pending.done?.(); return
        }
      }
      this.schedule(pending)
    } catch (cause) { this.fail(pending, cause) }
  }
  listen(lang: string, final: (text: string) => void, failed: (message: string) => void): void {
    this.clear()
    const pending: PendingAudio = { id: `voice-${audioSessionId}-${++nextId}`, kind: 'listen', deadline: Date.now() + 60_000, final, failed }
    this.pending = pending
    void this.command('listen', { id: pending.id, lang: lang || 'pt-BR' })
      .then(() => this.schedule(pending)).catch(cause => this.fail(pending, cause))
  }
  speak(text: string, lang: string, done: () => void, failed: (message: string) => void): void {
    this.clear()
    const pending: PendingAudio = { id: `voice-${audioSessionId}-${++nextId}`, kind: 'speak', deadline: Date.now() + 10 * 60_000, done, failed }
    this.pending = pending
    void this.command('speak', { id: pending.id, text, lang: lang || 'pt-BR' })
      .then(() => this.schedule(pending)).catch(cause => this.fail(pending, cause))
  }
  stopListening(): void {
    if (this.pending?.kind === 'listen') this.clear()
    void this.command('stopListening').catch(() => undefined)
  }
  stopSpeaking(): void {
    if (this.pending?.kind === 'speak') this.clear()
    void this.command('stopSpeaking').catch(() => undefined)
  }
}
