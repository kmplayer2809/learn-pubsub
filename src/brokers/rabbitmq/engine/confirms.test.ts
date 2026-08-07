import { describe, expect, it } from 'vitest'
import { createSimulation } from './index'
import type { Topology } from './types'

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'p1', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'ex', type: 'direct', position: { x: 1, y: 0 } }],
  queues: [
    { id: 'durable-q', label: 'durable-q', kind: 'classic', durable: true, position: { x: 2, y: 0 } },
    { id: 'transient-q', label: 'transient-q', kind: 'classic', position: { x: 2, y: 1 } },
  ],
  consumers: [],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'durable-q', destinationKind: 'queue', routingKey: 'd' },
    { id: 'b2', exchangeId: 'ex', destinationId: 'transient-q', destinationKind: 'queue', routingKey: 't' },
  ],
}

function confirmAt(routingKey: string, persistent: boolean): number {
  const sim = createSimulation({
    topology,
    script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey, body: 'x', persistent }],
    seed: 1,
  })
  sim.advanceTo(10_000)
  const entry = sim.snapshot().journal.find((j) => j.type === 'confirm')
  if (!entry) throw new Error('no confirm was journalled')
  return entry.at
}

describe('publisher confirms', () => {
  it('confirms every published message exactly once, even fanned out', () => {
    const sim = createSimulation({
      topology: { ...topology, exchanges: [{ ...topology.exchanges[0]!, type: 'fanout' }] },
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'd', body: 'x' }],
      seed: 1,
    })
    sim.advanceTo(10_000)
    const state = sim.snapshot()
    // Fanout puts this message in both queues. RabbitMQ confirms the publish, not the
    // copies, so two enqueues must still produce one confirm.
    expect(state.journal.filter((j) => j.type === 'confirm')).toHaveLength(1)
    expect(state.metrics.confirmed).toBe(1)
  })

  it('confirms an unroutable message', () => {
    const sim = createSimulation({
      topology,
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'nobody', body: 'x' }],
      seed: 1,
    })
    sim.advanceTo(10_000)
    expect(sim.snapshot().metrics.confirmed).toBe(1)
    expect(sim.snapshot().metrics.dropped).toBe(1)
  })

  it('takes longer to confirm a persistent message into a durable queue', () => {
    // The whole point of the lesson: the disk write is visible on the clock.
    expect(confirmAt('d', true)).toBeGreaterThan(confirmAt('d', false))
  })

  it('does not pay the disk cost when only one half of the pair is durable', () => {
    // persistent message, transient queue: nothing is written, so nothing is slower.
    expect(confirmAt('t', true)).toBe(confirmAt('t', false))
  })
})
