// CyberManju OS — Explicit Android screen reader (src/utils/androidScreenReader.ts).
// Role: Typed local-only API for consented MediaProjection and sequential screen selection.
// Exports: AndroidScreenReader and reader snapshot/event types.
// Integrates: android_voice_command through androidVoiceCommand; native overlay owns selection.
// Contracts: Native is the sole session-state owner; no REST fallback, hidden capture or automatic retry.
import { androidVoiceCommand, type AndroidVoiceCommand } from '@/utils/androidVoice'

export type ReaderState = 'idle' | 'awaiting_permission' | 'selecting' | 'reading' | 'stopped' | 'cancelled' | 'error'
export type ReaderMode = 'single' | 'batch'
export interface ReaderCapture {
  packageName: string
  selectedAt: number
  /** Bounded local text snapshot; never an image, remote upload or hidden-app feed. */
  text?: string
}
export interface ReaderStatus {
  sessionId: string | null
  state: ReaderState
  packageName: string | null
  /** Zero-based position in the explicitly selected queue. */
  index: number
  total: number
  overlayGranted: boolean
  packages: string[]
  mode: ReaderMode | null
  captures: ReaderCapture[]
  engine: string
  limitation: string
  lastError?: string
}
export type ReaderEvent =
  | { type: 'state'; snapshot: ReaderStatus }
  | { type: 'text'; sessionId: string; packageName: string; text: string; timestamp: number }
export interface ReaderPoll {
  events: ReaderEvent[]
  /** Authoritative snapshot even when the bounded event queue overflowed. */
  status: ReaderStatus
}
export interface ReaderStart {
  packages: string[]
  mode: ReaderMode
  /** Set only after the user affirmatively accepts the in-app disclosure. */
  consentDisclosure: true
}

/** No cached session or background JS timer: UI refreshes from native on resume. */
export class AndroidScreenReader {
  constructor(private readonly command: AndroidVoiceCommand = androidVoiceCommand) {}

  start(request: ReaderStart): Promise<ReaderStatus> {
    const packages = [...new Set(request.packages.map(value => value.trim()))]
    if (request.consentDisclosure !== true) return Promise.reject(new Error('auth: screen reading requires explicit disclosure consent'))
    if (request.mode !== 'single' && request.mode !== 'batch') return Promise.reject(new Error('invalid: screen reader mode'))
    if (packages.length !== request.packages.length || packages.some(value => !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(value))) {
      return Promise.reject(new Error('invalid: select distinct Android app packages'))
    }
    if ((request.mode === 'single' && packages.length !== 1) ||
        (request.mode === 'batch' && (packages.length < 2 || packages.length > 20))) {
      return Promise.reject(new Error('invalid: select one app or a batch of 2–20 apps'))
    }
    // Never retry start automatically: every session needs a fresh Android consent.
    return this.command<ReaderStatus>('readerStart', { ...request, packages, expiresAt: Date.now() + 10_000 })
  }

  status(): Promise<ReaderStatus> { return this.command<ReaderStatus>('readerStatus') }
  poll(): Promise<ReaderPoll> { return this.command<ReaderPoll>('readerPoll') }
  stop(): Promise<ReaderStatus> { return this.command<ReaderStatus>('readerStop') }
  overlaySettings(): Promise<ReaderStatus> { return this.command<ReaderStatus>('readerOverlaySettings') }
}
