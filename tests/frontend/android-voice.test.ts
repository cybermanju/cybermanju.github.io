// CyberManju OS — Android voice bridge tests (tests/frontend/android-voice.test.ts).
// Role: Verify native audio event lifetimes and device-only IPC ordering.
// Exports: Vitest suite.
// Integrates: AndroidVoiceAudio and mocked Tauri core IPC.
// Contracts: stale callbacks never resume capture; no REST fallback; bounded active polling.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const runtime = vi.hoisted(() => ({ android: true, native: true, invoke: vi.fn() }))
vi.mock('@/composables/useTauri', () => ({ isAndroidApp: () => runtime.android, isTauri: () => runtime.native }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: runtime.invoke }))
import { androidVoiceCommand, AndroidVoiceAudio, type AndroidVoiceCommand } from '../../src/utils/androidVoice'

beforeEach(() => { vi.useFakeTimers(); runtime.android = true; runtime.native = true; runtime.invoke.mockReset() })
afterEach(() => { vi.useRealTimers() })
function fixture() {
  const commands: Array<{ action: string; payload?: Record<string, unknown> }> = []
  let events: Array<Record<string, string>> = []
  const command: AndroidVoiceCommand = async <T>(action: string, payload?: Record<string, unknown>) => {
    commands.push({ action, payload })
    return (action === 'poll' ? { events: events.splice(0) } : { ok: true }) as T
  }
  return { audio: new AndroidVoiceAudio(command), commands, events }
}

describe('Android voice audio adapter', () => {
  it('delivers only the matching final once and stops polling', async () => {
    const { audio, commands, events } = fixture()
    const final = vi.fn(); const failed = vi.fn()
    audio.listen('pt-BR', final, failed)
    const id = commands[0].payload!.id as string
    events.push({ id: 'old', type: 'final', text: 'ignore' }, { id, type: 'final', text: 'Olá' }, { id, type: 'final', text: 'duplicate' })
    await vi.advanceTimersByTimeAsync(200)
    expect(final).toHaveBeenCalledExactlyOnceWith('Olá')
    expect(failed).not.toHaveBeenCalled()
    const count = commands.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(commands).toHaveLength(count)
  })
  it('ignores late finals and errors after explicit stop', async () => {
    const { audio, commands, events } = fixture()
    const final = vi.fn(); const failed = vi.fn()
    audio.listen('en-US', final, failed)
    const id = commands[0].payload!.id as string
    await Promise.resolve()
    audio.stopListening()
    events.push({ id, type: 'final', text: 'late' }, { id, type: 'error', error: 'late error' })
    await vi.advanceTimersByTimeAsync(500)
    expect(final).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled()
    expect(commands.at(-1)?.action).toBe('stopListening')
  })
  it('propagates denied microphone permission without restarting', async () => {
    const { audio, commands, events } = fixture()
    const failed = vi.fn()
    audio.listen('pt-BR', vi.fn(), failed)
    events.push({ id: commands[0].payload!.id as string, type: 'error', error: 'auth: microphone permission required' })
    await vi.advanceTimersByTimeAsync(500)
    expect(failed).toHaveBeenCalledExactlyOnceWith('auth: microphone permission required')
    expect(commands.filter(c => c.action === 'listen')).toHaveLength(1)
  })
  it('finishes output only for the matching utterance', async () => {
    const { audio, commands, events } = fixture()
    const done = vi.fn(); const failed = vi.fn()
    audio.speak('Resposta', 'pt-BR', done, failed)
    events.push({ id: commands[0].payload!.id as string, type: 'spoken' })
    await vi.advanceTimersByTimeAsync(200)
    expect(done).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled()
  })
  it('stops a silent turn rather than creating a hot restart loop', async () => {
    const { audio, commands, events } = fixture()
    const failed = vi.fn()
    audio.listen('en-US', vi.fn(), failed)
    events.push({ id: commands[0].payload!.id as string, type: 'end' })
    await vi.advanceTimersByTimeAsync(500)
    expect(failed).toHaveBeenCalledOnce()
    expect(commands.filter(c => c.action === 'listen')).toHaveLength(1)
  })
  it('cannot deliver a poll already in flight after stop and a new turn', async () => {
    let finish: ((value: unknown) => void) | undefined
    let currentId = ''
    const command: AndroidVoiceCommand = <T>(action: string, payload?: Record<string, unknown>) => {
      if (action === 'listen') currentId = payload!.id as string
      return (action === 'poll' ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ok: true })) as Promise<T>
    }
    const audio = new AndroidVoiceAudio(command); const old = vi.fn(); const next = vi.fn()
    audio.listen('en-US', old, vi.fn())
    const oldId = currentId
    await vi.advanceTimersByTimeAsync(160)
    audio.stopListening(); audio.listen('en-US', next, vi.fn())
    finish!({ events: [{ id: oldId, type: 'final', text: 'stale' }] })
    await Promise.resolve(); await Promise.resolve()
    expect(old).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled()
    audio.stopListening()
  })
  it('bounds a recognizer that never returns a result', async () => {
    const { audio, commands } = fixture()
    const failed = vi.fn()
    audio.listen('pt-BR', vi.fn(), failed)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('timed out'))
    expect(commands.at(-1)?.action).toBe('stopListening')
    const count = commands.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(commands).toHaveLength(count)
  })
  it('stops native speech on output failure before the caller can start another turn', async () => {
    const { audio, commands, events } = fixture()
    const done = vi.fn()
    const failed = vi.fn(() => audio.listen('pt-BR', vi.fn(), vi.fn()))
    audio.speak('Resposta', 'pt-BR', done, failed)
    events.push({ id: commands[0].payload!.id as string, type: 'error', error: 'output unavailable' })
    await vi.advanceTimersByTimeAsync(200)
    expect(done).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledExactlyOnceWith('output unavailable')
    const actions = commands.map(c => c.action)
    expect(actions.indexOf('stopSpeaking')).toBeLessThan(actions.indexOf('listen'))
    audio.stopListening()
  })
})

describe('Android voice IPC boundary', () => {
  it('refuses web/desktop without invoking native IPC', async () => {
    runtime.android = false
    await expect(androidVoiceCommand('notifications')).rejects.toThrow('unsupported:')
    expect(runtime.invoke).not.toHaveBeenCalled()
    runtime.android = true; runtime.native = false
    await expect(androidVoiceCommand('status')).rejects.toThrow('unsupported:')
    expect(runtime.invoke).not.toHaveBeenCalled()
  })
  it('orders stop before listen and does not poison the queue after a refusal', async () => {
    runtime.invoke.mockRejectedValueOnce(new Error('old stop failed')).mockResolvedValueOnce({ ok: true })
    const stop = androidVoiceCommand('stop').catch(() => undefined)
    const listen = androidVoiceCommand('listen', { id: 'next', lang: 'pt-BR' })
    await Promise.all([stop, listen])
    expect(runtime.invoke.mock.calls.map(c => c[1].action)).toEqual(['stop', 'listen'])
    expect(runtime.invoke.mock.calls.every(c => c[0] === 'android_voice_command')).toBe(true)
  })
})
