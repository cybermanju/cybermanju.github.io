// CyberManju OS — Android voice call integration regressions.
// Exercises the real controller + AndroidVoiceAudio adapter with a typed native-command fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceCallController, type VoiceCallPorts } from '../../src/utils/voiceCall'
import { AndroidVoiceAudio, type AndroidVoiceCommand } from '../../src/utils/androidVoice'

type NativeEvent = { id: string; type: 'final' | 'end' | 'error' | 'spoken'; text?: string; error?: string }
type NativeCall = { action: string; payload?: Record<string, unknown> }

function fixture() {
  const commands: NativeCall[] = []
  const events: NativeEvent[] = []
  const command: AndroidVoiceCommand = async <T>(action: string, payload?: Record<string, unknown>) => {
    commands.push({ action, payload })
    return (action === 'poll' ? { events: events.splice(0) } : { ok: true }) as T
  }
  const audio = new AndroidVoiceAudio(command)
  const answers: Array<(text: string) => void> = []
  const ports: VoiceCallPorts = {
    listen: (final, failed) => audio.listen('pt-BR', final, failed),
    stopListening: () => audio.stopListening(),
    speak: (text, done, failed) => audio.speak(text, 'pt-BR', done, failed),
    stopSpeaking: () => audio.stopSpeaking(),
    send: vi.fn((_text, _signal) => new Promise<string>(resolve => answers.push(resolve))),
    changed: vi.fn(),
  }
  const call = new VoiceCallController(ports)
  const currentId = (action: string) => {
    const found = [...commands].reverse().find(entry => entry.action === action)
    expect(found).toBeDefined()
    return found!.payload!.id as string
  }
  const publish = (event: NativeEvent) => { events.push(event) }
  const turn = async () => { await vi.advanceTimersByTimeAsync(200) }
  return { call, ports, commands, answers, currentId, publish, turn }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('VoiceCallController + AndroidVoiceAudio real integration', () => {
  it('runs explicit start → native final → agent send → native spoken → next listen, half-duplex', async () => {
    const f = fixture()
    expect(f.commands).toHaveLength(0)
    f.call.start()
    expect(f.call.state).toBe('listening')
    expect(f.commands.map(c => c.action)).toEqual(['stopListening', 'stopSpeaking', 'listen'])
    const firstId = f.currentId('listen')
    f.publish({ id: firstId, type: 'final', text: ' Oi ' })
    await f.turn()
    expect(f.call.state).toBe('thinking')
    expect(f.ports.send).toHaveBeenCalledExactlyOnceWith('Oi', expect.any(AbortSignal))
    expect(f.commands.filter(c => c.action === 'poll')).toHaveLength(1)
    f.answers[0]('Olá!')
    await Promise.resolve(); await Promise.resolve()
    expect(f.call.state).toBe('speaking')
    expect(f.commands.map(c => c.action)).toEqual(['stopListening', 'stopSpeaking', 'listen', 'poll', 'stopListening', 'speak'])
    expect(f.commands.at(-1)!.payload).toMatchObject({ text: 'Olá!', lang: 'pt-BR' })
    const speakId = f.currentId('speak')
    f.publish({ id: speakId, type: 'spoken' })
    await f.turn()
    expect(f.call.state).toBe('listening')
    expect(f.commands.map(c => c.action)).toEqual(['stopListening', 'stopSpeaking', 'listen', 'poll', 'stopListening', 'speak', 'poll', 'listen'])
    expect(f.commands.filter(c => c.action === 'listen')).toHaveLength(2)
  })

  it('hang-up and mute invalidate delayed native finals; each new listen follows stop', async () => {
    const f = fixture(); f.call.start()
    const staleId = f.currentId('listen')
    f.call.end()
    f.publish({ id: staleId, type: 'final', text: 'after hangup' })
    await f.turn()
    expect(f.call.state).toBe('idle')
    expect(f.ports.send).not.toHaveBeenCalled()
    expect(f.commands.at(-1)!.action).toBe('stopSpeaking')

    f.call.start()
    const beforeMute = f.currentId('listen')
    f.call.setMuted(true)
    f.publish({ id: beforeMute, type: 'final', text: 'muted late' })
    await f.turn()
    expect(f.call.state).toBe('muted')
    expect(f.ports.send).not.toHaveBeenCalled()
    f.call.setMuted(false)
    expect(f.call.state).toBe('listening')
    const listens = f.commands.filter(c => c.action === 'listen')
    expect(listens).toHaveLength(3)
    for (const listen of listens.slice(1)) {
      const index = f.commands.indexOf(listen)
      expect(f.commands.slice(0, index).some(c => c.action === 'stopListening')).toBe(true)
    }
  })

  it('interrupt stops native speech before listening and rejects delayed spoken callback', async () => {
    const f = fixture(); f.call.start()
    f.publish({ id: f.currentId('listen'), type: 'final', text: 'question' }); await f.turn()
    f.answers[0]('answer'); await Promise.resolve(); await Promise.resolve()
    const spokenId = f.currentId('speak')
    f.call.interrupt()
    expect(f.call.state).toBe('listening')
    const actions = f.commands.map(c => c.action)
    const stopIndex = actions.lastIndexOf('stopSpeaking')
    const listenIndex = actions.lastIndexOf('listen')
    expect(stopIndex).toBeGreaterThan(-1); expect(stopIndex).toBeLessThan(listenIndex)
    f.publish({ id: spokenId, type: 'spoken' }); await f.turn()
    expect(f.call.state).toBe('listening')
    expect(f.commands.filter(c => c.action === 'listen')).toHaveLength(2)
    expect(f.ports.send).toHaveBeenCalledTimes(1)
  })

  it('native recognition error and timeout stop once without an automatic retry loop', async () => {
    const denied = fixture(); denied.call.start()
    denied.publish({ id: denied.currentId('listen'), type: 'error', error: 'microphone permission required' })
    await denied.turn()
    expect(denied.call.state).toBe('error')
    expect(denied.commands.filter(c => c.action === 'listen')).toHaveLength(1)
    const deniedCount = denied.commands.length
    await vi.advanceTimersByTimeAsync(2_000)
    expect(denied.commands).toHaveLength(deniedCount)

    const timeout = fixture(); timeout.call.start()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(timeout.call.state).toBe('error')
    expect(timeout.call.error).toContain('timed out')
    expect(timeout.commands.filter(c => c.action === 'listen')).toHaveLength(1)
    const timeoutCount = timeout.commands.length
    await vi.advanceTimersByTimeAsync(2_000)
    expect(timeout.commands).toHaveLength(timeoutCount)
  })
})
