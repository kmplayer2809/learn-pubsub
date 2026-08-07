import { describe, expect, it } from 'vitest'
import { createSimulation, MAX_JOURNAL } from './index'
import type { SimulationOptions } from './index'
import type { Topology } from './types'

const crashTopology: Topology = {
  publishers: [{ id: 'p1', label: 'P', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'X', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [{ id: 'q1', label: 'Q', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers: [
    {
      id: 'c1',
      label: 'C',
      queueId: 'q1',
      prefetch: 1,
      autoAck: false,
      // Long enough that the manual-ack consumer is still holding the message
      // unacked when the scripted crash fires at t=2000.
      processingMs: 100_000,
      jitterMs: 0,
      nackRate: 0,
      requeueOnNack: true,
      position: { x: 600, y: 0 },
    },
  ],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
  ],
}

describe('createSimulation runaway guard', () => {
  it('halts a non-zero-TTL dead-letter cycle instead of running forever', () => {
    const cycle: Topology = {
      publishers: [{ id: 'p1', label: 'P', position: { x: 0, y: 0 } }],
      exchanges: [{ id: 'ex', label: 'X', type: 'direct', position: { x: 200, y: 0 } }],
      queues: [
        {
          id: 'q1',
          label: 'Q',
          kind: 'classic',
          messageTtlMs: 10,
          deadLetterExchange: 'ex',
          position: { x: 400, y: 0 },
        },
      ],
      consumers: [],
      bindings: [
        { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
      ],
    }
    const sim = createSimulation({
      topology: cycle,
      seed: 1,
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'loop' }],
      maxEvents: 2000,
    })
    // The cycle round-trips in 2*TRAVEL_MS + messageTtlMs = 1210ms of virtual time
    // at ~4 events per lap, so reaching the real 200_000 ceiling costs ~60.5M ms of
    // virtual time and ~3 seconds of wall clock on every suite run. The property
    // under test is that the guard halts a cycle that would otherwise never stop,
    // not the specific value of the default constant, so the ceiling is lowered
    // here and the target time raised far past it.
    sim.advanceTo(70_000_000)
    const snap = sim.snapshot()
    expect(snap.halted).toBeDefined()
    expect(snap.halted!.reason).toContain('event ceiling')
    expect(snap.halted!.reason).toContain('2000')
    expect(snap.journal.length).toBeLessThanOrEqual(MAX_JOURNAL)
  })
})

describe('createSimulation replay determinism', () => {
  it('produces the same journal whether advanced in one jump or many', () => {
    const options: SimulationOptions = {
      topology: crashTopology,
      seed: 1,
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'PAYLOAD' }],
      failures: [{ at: 2000, consumerId: 'c1', kind: 'crash' }],
    }
    const oneJump = createSimulation(options)
    oneJump.advanceTo(5000)

    const manyJumps = createSimulation(options)
    for (let t = 100; t <= 5000; t += 100) manyJumps.advanceTo(t)

    const a = oneJump.snapshot().journal.map((e) => `${e.at}:${e.type}`)
    expect(a).toEqual(manyJumps.snapshot().journal.map((e) => `${e.at}:${e.type}`))
    const times = oneJump.snapshot().journal.map((e) => e.at)
    expect([...times].sort((x, y) => x - y)).toEqual(times)
  })

  it('requeues the real message on crash, not a blank placeholder', () => {
    const sim = createSimulation({
      topology: crashTopology,
      seed: 1,
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'IMPORTANT' }],
      failures: [{ at: 2000, consumerId: 'c1', kind: 'crash' }],
    })
    sim.advanceTo(1999)
    expect(sim.snapshot().unacked.c1).toHaveLength(1)

    sim.advanceTo(5000)
    const requeued = sim.snapshot().queues.q1 ?? []
    expect(requeued).toHaveLength(1)
    expect(requeued[0]!.message.body).toBe('IMPORTANT')
    expect(requeued[0]!.message.routingKey).toBe('go')
    expect(requeued[0]!.message.redeliveryCount).toBe(1)
  })
})
