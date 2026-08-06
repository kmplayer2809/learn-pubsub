import { describe, expect, it } from 'vitest'
import { createSimulation } from './index'
import type { ScriptedAction, Topology } from './index'

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'orders', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [{ id: 'q1', label: 'work', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers: [
    {
      id: 'c1',
      label: 'worker',
      queueId: 'q1',
      prefetch: 1,
      autoAck: false,
      processingMs: 400,
      jitterMs: 200,
      nackRate: 0.3,
      requeueOnNack: true,
      position: { x: 600, y: 0 },
    },
  ],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
  ],
}

const script: ScriptedAction[] = Array.from({ length: 6 }, (_, i) => ({
  at: i * 400,
  publisherId: 'p1',
  exchangeId: 'ex',
  routingKey: 'go',
  body: `job-${i}`,
}))

describe('createSimulation', () => {
  it('drains published messages through to acks', () => {
    const sim = createSimulation({ topology, script, seed: 7 })
    sim.advanceTo(30_000)
    const state = sim.snapshot()
    expect(state.metrics.published).toBe(6)
    expect(state.metrics.acked).toBe(6)
    expect(state.queues.q1).toHaveLength(0)
  })

  it('produces an identical journal for the same seed', () => {
    const a = createSimulation({ topology, script, seed: 7 })
    const b = createSimulation({ topology, script, seed: 7 })
    a.advanceTo(30_000)
    b.advanceTo(30_000)
    expect(JSON.stringify(a.snapshot().journal)).toBe(JSON.stringify(b.snapshot().journal))
  })

  it('produces a different journal for a different seed', () => {
    const a = createSimulation({ topology, script, seed: 7 })
    const b = createSimulation({ topology, script, seed: 8 })
    a.advanceTo(30_000)
    b.advanceTo(30_000)
    expect(JSON.stringify(a.snapshot().journal)).not.toBe(JSON.stringify(b.snapshot().journal))
  })

  it('reaches the same state by replay as by advancing directly', () => {
    const direct = createSimulation({ topology, script, seed: 7 })
    direct.advanceTo(3_000)

    const replayed = createSimulation({ topology, script, seed: 7 })
    replayed.advanceTo(30_000)
    replayed.reset()
    replayed.advanceTo(3_000)

    expect(JSON.stringify(replayed.snapshot())).toBe(JSON.stringify(direct.snapshot()))
  })

  it('advances exactly one timestamp per stepOnce', () => {
    const sim = createSimulation({ topology, script, seed: 7 })
    const first = sim.nextEventTime()
    sim.stepOnce()
    expect(sim.snapshot().now).toBe(first)
    expect(sim.nextEventTime()).toBeGreaterThan(first!)
  })

  it('caps the journal so a long run cannot grow without bound', () => {
    const busy: ScriptedAction[] = Array.from({ length: 4000 }, (_, i) => ({
      at: i * 10,
      publisherId: 'p1',
      exchangeId: 'ex',
      routingKey: 'go',
      body: `job-${i}`,
    }))
    const sim = createSimulation({ topology, script: busy, seed: 1 })
    sim.advanceTo(200_000)
    expect(sim.snapshot().journal.length).toBeLessThanOrEqual(5_000)
  })

  it('surfaces validation issues without running', () => {
    const broken: Topology = { ...topology, bindings: [] }
    const sim = createSimulation({ topology: broken, script, seed: 1 })
    expect(sim.issues.length).toBeGreaterThan(0)
  })
})
