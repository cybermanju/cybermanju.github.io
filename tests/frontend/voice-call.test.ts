// CyberManju OS — VozPonte call tests (tests/frontend/voice-call.test.ts).
// Role: verify half-duplex, cancellation and failure contracts without a microphone.
// Exports: Vitest suite.
// Integrates: voiceCall controller with deterministic speech/agent ports.
// Contracts: no send after hang-up; no microphone while TTS; no permission auto-approval.
import { describe, expect, it, vi } from 'vitest'
import { VoiceCallController, speechText, type VoiceCallPorts } from '../../src/utils/voiceCall'

function fixture() {
  let final!: (text: string) => void
  let recognitionError!: (message: string) => void
  let spokenEnd!: () => void
  let spokenError!: (message: string) => void
  let resolve!: (text: string) => void
  let reject!: (error: Error) => void
  const ports: VoiceCallPorts = {
    listen: vi.fn((onFinal, onError) => { final = onFinal; recognitionError = onError }),
    stopListening: vi.fn(),
    speak: vi.fn((_text, done, failed) => { spokenEnd = done; spokenError = failed }),
    stopSpeaking: vi.fn(),
    send: vi.fn(() => new Promise<string>((yes, no) => { resolve = yes; reject = no })),
    changed: vi.fn(),
  }
  const call = new VoiceCallController(ports)
  return { call, ports, final: (s: string) => final(s), recognitionError: (s: string) => recognitionError(s), spokenEnd: () => spokenEnd(), spokenError: (s: string) => spokenError(s), resolve: (s: string) => resolve(s), reject: (e: Error) => reject(e) }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

describe('VozPonte foreground voice call', () => {
  it('requires start and cycles listening → thinking → speaking → listening', async () => {
    const f = fixture()
    expect(f.ports.listen).not.toHaveBeenCalled()
    f.call.start()
    expect(f.call.state).toBe('listening')
    f.final(' Olá ')
    expect(f.call.state).toBe('thinking')
    expect(f.ports.send).toHaveBeenCalledWith('Olá', expect.any(AbortSignal))
    f.resolve('Olá!')
    await flush()
    expect(f.call.state).toBe('speaking')
    expect(f.ports.listen).toHaveBeenCalledTimes(1)
    f.spokenEnd()
    expect(f.call.state).toBe('listening')
    expect(f.ports.listen).toHaveBeenCalledTimes(2)
  })
  it('ignores empty finals, duplicates, and echo while waiting/speaking', async () => {
    const f = fixture(); f.call.start(); f.final(' ')
    expect(f.ports.send).not.toHaveBeenCalled()
    f.final('test'); f.final('test'); f.resolve('answer'); await flush(); f.final('answer')
    expect(f.ports.send).toHaveBeenCalledTimes(1)
  })
  it('hang-up aborts the local wait and discards late replies and recognition', async () => {
    const f = fixture(); f.call.start(); f.final('test')
    const signal = vi.mocked(f.ports.send).mock.calls[0][1]
    f.call.end(); f.final('late'); f.resolve('late response'); await flush()
    expect(signal.aborted).toBe(true)
    expect(f.call.state).toBe('idle')
    expect(f.ports.speak).not.toHaveBeenCalled()
  })
  it('muting ignores late finals and resumes only after explicit unmute', () => {
    const f = fixture(); f.call.start(); f.call.setMuted(true); f.final('late')
    expect(f.call.state).toBe('muted'); expect(f.ports.send).not.toHaveBeenCalled()
    f.call.setMuted(false); expect(f.call.state).toBe('listening')
  })
  it('invalidates a previous recognizer across mute/unmute', () => {
    const f = fixture(); f.call.start()
    const staleFinal = vi.mocked(f.ports.listen).mock.calls[0][0]
    f.call.setMuted(true); f.call.setMuted(false); staleFinal('stale')
    expect(f.ports.send).not.toHaveBeenCalled()
    f.final('new'); expect(f.ports.send).toHaveBeenCalledTimes(1)
  })
  it('mute during a reply prevents microphone restart', async () => {
    const f = fixture(); f.call.start(); f.final('test'); f.call.setMuted(true)
    f.resolve('answer'); await flush(); f.spokenEnd()
    expect(f.call.state).toBe('muted'); expect(f.ports.listen).toHaveBeenCalledTimes(1)
  })
  it('interruption invalidates old TTS callbacks', async () => {
    const f = fixture(); f.call.start(); f.final('test'); f.resolve('answer'); await flush()
    f.call.interrupt(); f.spokenEnd()
    expect(f.call.state).toBe('listening'); expect(f.ports.listen).toHaveBeenCalledTimes(2)
  })
  it('recognition, network and speech failures stop rather than auto-retry', async () => {
    const a = fixture(); a.call.start(); a.recognitionError('not-allowed')
    expect(a.call.state).toBe('error'); expect(a.call.active).toBe(false)
    const b = fixture(); b.call.start(); b.final('test'); b.reject(new Error('network')); await flush()
    expect(b.call.error).toBe('network')
    const c = fixture(); c.call.start(); c.final('test'); c.resolve('answer'); await flush(); c.spokenError('output failed')
    expect(c.call.state).toBe('error')
  })
  it('does not revive an old generation after starting another call', async () => {
    const f = fixture(); f.call.start(); f.final('test'); f.call.end(); f.call.start(); f.resolve('old'); await flush()
    expect(f.call.state).toBe('listening'); expect(f.ports.speak).not.toHaveBeenCalled()
  })
  it('resumes listening for an empty response without starting TTS', async () => {
    const f = fixture(); f.call.start(); f.final('test'); f.resolve(''); await flush()
    expect(f.call.state).toBe('listening'); expect(f.ports.speak).not.toHaveBeenCalled()
  })
  it('rejects previous-turn recognizer callbacks after the microphone resumes', async () => {
    const f = fixture(); f.call.start()
    const [oldFinal, oldError] = vi.mocked(f.ports.listen).mock.calls[0]
    f.final('first'); f.resolve('answer'); await flush(); f.spokenEnd()
    oldFinal('late duplicate'); oldError('late recognizer failure')
    expect(f.call.state).toBe('listening')
    expect(f.ports.send).toHaveBeenCalledTimes(1)
    f.final('second')
    expect(f.ports.send).toHaveBeenLastCalledWith('second', expect.any(AbortSignal))
  })
  it('rejects previous-turn TTS completion/errors during the next spoken reply', async () => {
    const f = fixture(); f.call.start(); f.final('first'); f.resolve('first answer'); await flush()
    const [, oldDone, oldError] = vi.mocked(f.ports.speak).mock.calls[0]
    f.spokenEnd(); f.final('second'); f.resolve('second answer'); await flush()
    oldDone(); oldError('late output failure')
    expect(f.call.state).toBe('speaking')
    expect(f.ports.listen).toHaveBeenCalledTimes(2)
    f.spokenEnd()
    expect(f.call.state).toBe('listening')
  })
  it('omits fenced code, URLs and markdown from bounded speech', () => {
    expect(speechText('**Oi** [doc](https://a.test)\n```js\nsecret()\n``` https://x.test')).toBe('Oi doc [code in chat]')
    expect(speechText('a'.repeat(7000))).toHaveLength(6000)
  })
})
