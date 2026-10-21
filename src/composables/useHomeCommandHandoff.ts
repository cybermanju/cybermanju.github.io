// CyberManju OS — Home command handoff (src/composables/useHomeCommandHandoff.ts).
// Role: Deliver explicitly staged home inputs to the existing AI and cybsh panels in memory.
// Exports: stageHomeCommand, subscribeHomeCommand, HomeCommandTarget.
// Integrates: Vue-panel consumers through a private module-local queue; no global events or transport calls.
// Contracts: Values are delivered once to a mounted consumer or queued until lazy panel creation; never executed here.
export type HomeCommandTarget = 'agent' | 'terminal'

export interface HomeCommandHandoff {
  readonly id: number
  readonly target: HomeCommandTarget
  readonly text: string
}

type Receiver = (handoff: HomeCommandHandoff) => void

const pending: Record<HomeCommandTarget, HomeCommandHandoff[]> = {
  agent: [],
  terminal: [],
}
const receivers: Partial<Record<HomeCommandTarget, Receiver>> = {}
let nextId = 0

function deliver(target: HomeCommandTarget, receiver: Receiver) {
  const queue = pending[target]
  while (queue.length) {
    const handoff = queue.shift()!
    receiver(handoff)
  }
}

/** Stage text for an existing panel. A mounted panel receives it immediately; otherwise it waits in memory. */
export function stageHomeCommand(target: HomeCommandTarget, text: string): HomeCommandHandoff | null {
  const value = text.trim()
  if (!value) return null

  const handoff: HomeCommandHandoff = { id: ++nextId, target, text: value }
  const receiver = receivers[target]
  if (receiver) receiver(handoff)
  else pending[target].push(handoff)
  return handoff
}

/** Subscribe one existing panel instance and drain any handoffs queued before its lazy creation. */
export function subscribeHomeCommand(target: HomeCommandTarget, receiver: Receiver): () => void {
  receivers[target] = receiver
  deliver(target, receiver)
  return () => {
    if (receivers[target] === receiver) delete receivers[target]
  }
}
