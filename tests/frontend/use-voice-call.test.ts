// CyberManju OS — push-to-talk adapter tests (tests/frontend/use-voice-call.test.ts).
// Role: verify browser release semantics and native capability reporting without real audio.
// Exports: Vitest suite.
// Integrates: useVoiceCall, Web Speech API fakes and a custom Vue renderer.
// Contracts: no capture on mount; stop preserves final callbacks; native abort is not advertised as PTT.
import { createRenderer } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  enabled: false,
  listen: vi.fn(),
  stopListening: vi.fn(),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
}))

vi.mock('@/utils/androidVoice', () => ({
  AndroidVoiceAudio: class {
    listen(...args: unknown[]) { native.listen(...args) }
    stopListening() { native.stopListening() }
    speak(...args: unknown[]) { native.speak(...args) }
    stopSpeaking() { native.stopSpeaking() }
  },
  isNativeAndroid: () => native.enabled,
}))

import { useVoiceCall } from '@/composables/useVoiceCall'

type HostNode = { type: string; children: HostNode[]; parent?: HostNode; text?: string }
const renderer = createRenderer<HostNode, HostNode>({
  createElement: type => ({ type, children: [] }),
  createText: text => ({ type: '#text', text, children: [] }),
  createComment: text => ({ type: '#comment', text, children: [] }),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text },
  patchProp: () => undefined,
  insert: (node, parent, anchor) => {
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove: node => {
    if (!node.parent) return
    const index = node.parent.children.indexOf(node)
    if (index >= 0) node.parent.children.splice(index, 1)
    node.parent = undefined
  },
  parentNode: node => node.parent ?? null,
  nextSibling: node => {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null
  },
})

class FakeRecognition {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  stopped = false
  aborted = false
  constructor() { FakeRecognition.instances.push(this) }
  start() { this.started = true }
  stop() { this.stopped = true }
  abort() { this.aborted = true }
}

class FakeUtterance {
  lang = ''
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  constructor(readonly text: string) {}
}

let app: ReturnType<typeof renderer.createApp> | undefined
let speech: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }

function mountVoice() {
  let voice: ReturnType<typeof useVoiceCall> | undefined
  app = renderer.createApp({
    setup() {
      voice = useVoiceCall(async () => 'response', () => 'pt-BR')
      return () => null
    },
  })
  app.mount({ type: 'root', children: [] })
  return voice!
}

beforeEach(() => {
  native.enabled = false
  vi.clearAllMocks()
  FakeRecognition.instances = []
  speech = { speak: vi.fn(), cancel: vi.fn() }
  vi.stubGlobal('window', { SpeechRecognition: FakeRecognition, speechSynthesis: speech })
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
})

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useVoiceCall push-to-talk adapter', () => {
  it('does not advertise or start a hold when synthesis is missing', () => {
    vi.stubGlobal('window', { SpeechRecognition: FakeRecognition })
    const voice = mountVoice()
    expect(voice.supported).toBe(false)
    expect(voice.pushToTalkSupported).toBe(false)
    voice.startHold()
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('reports browser support and calls stop without aborting before a delayed final', async () => {
    const voice = mountVoice()
    expect(voice.pushToTalkSupported).toBe(true)
    expect(FakeRecognition.instances).toHaveLength(0)
    voice.startHold()
    const rec = FakeRecognition.instances[0]
    expect(rec.started).toBe(true)
    voice.finishHold()
    expect(rec.stopped).toBe(true)
    expect(rec.aborted).toBe(false)
    const lateEnd = rec.onend!
    rec.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'question' } }] })
    await Promise.resolve(); await Promise.resolve()
    expect(voice.state.value).toBe('speaking')
    expect(speech.speak).toHaveBeenCalledOnce()
    lateEnd()
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('treats a no-speech end as terminal and never restarts after release', () => {
    const voice = mountVoice()
    voice.startHold()
    const rec = FakeRecognition.instances[0]
    voice.finishHold()
    rec.onend!()
    expect(voice.state.value).toBe('error')
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('watchdog aborts capture when the engine never emits its final or end callback', () => {
    vi.useFakeTimers()
    const voice = mountVoice()
    voice.startHold()
    const rec = FakeRecognition.instances[0]
    voice.finishHold()
    vi.advanceTimersByTime(2_000)
    expect(voice.state.value).toBe('error')
    expect(rec.aborted).toBe(true)
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('does not advertise native Android abort-based capture as push-to-talk', () => {
    native.enabled = true
    const voice = mountVoice()
    expect(voice.supported).toBe(true)
    expect(voice.pushToTalkSupported).toBe(false)
    voice.startHold()
    expect(native.listen).not.toHaveBeenCalled()
    expect(voice.state.value).toBe('idle')
  })
})
