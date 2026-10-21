// CyberManju OS — Home command handoff tests (tests/frontend/home-command-handoff.test.ts).
// Role: Verify staged home text is delivered once to the intended existing panel, whether mounted or lazy-created.
// Exports: none.
// Integrates: Vitest, src/composables/useHomeCommandHandoff.ts.
// Contracts: Staging never implies execution; queues are in-memory and target-isolated.
import { afterEach, describe, expect, it } from 'vitest'
import {
  stageHomeCommand,
  subscribeHomeCommand,
  type HomeCommandHandoff,
  type HomeCommandTarget,
} from '../../src/composables/useHomeCommandHandoff'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function listen(target: HomeCommandTarget, receive: (handoff: HomeCommandHandoff) => void) {
  const stop = subscribeHomeCommand(target, receive)
  cleanups.push(stop)
  return stop
}

describe('home command handoff', () => {
  it('queues drafts until a lazy panel subscribes, then delivers them once in order', () => {
    expect(stageHomeCommand('agent', '  first request  ')?.text).toBe('first request')
    expect(stageHomeCommand('agent', 'second request')?.text).toBe('second request')
    const received: string[] = []

    listen('agent', ({ text }) => received.push(text))
    expect(received).toEqual(['first request', 'second request'])
    expect(stageHomeCommand('agent', 'third request')?.text).toBe('third request')
    expect(received).toEqual(['first request', 'second request', 'third request'])

    const later: string[] = []
    listen('agent', ({ text }) => later.push(text))
    expect(later).toEqual([])
  })

  it('delivers directly to a mounted panel and does not cross panel targets', () => {
    const terminal: string[] = []
    listen('terminal', ({ text }) => terminal.push(text))
    stageHomeCommand('agent', 'explain this')
    stageHomeCommand('terminal', 'cybsh status')
    expect(terminal).toEqual(['cybsh status'])

    const agent: string[] = []
    listen('agent', ({ text }) => agent.push(text))
    expect(agent).toEqual(['explain this'])
  })

  it('ignores empty input and retains undelivered drafts after unsubscribe', () => {
    expect(stageHomeCommand('terminal', ' \n ')).toBeNull()
    const first: string[] = []
    const stop = listen('terminal', ({ text }) => first.push(text))
    stageHomeCommand('terminal', 'pwd')
    stop()
    expect(first).toEqual(['pwd'])

    stageHomeCommand('terminal', 'help')
    const later: string[] = []
    listen('terminal', ({ text }) => later.push(text))
    expect(later).toEqual(['help'])
  })
})
