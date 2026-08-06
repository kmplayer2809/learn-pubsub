import { describe, expect, it } from 'vitest'
import { createSimulation, MAX_JOURNAL } from './index'
import type { Topology } from './types'

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
    })
    // This cycle round-trips in 2*TRAVEL_MS (1200ms) + messageTtlMs (10ms) = 1210ms
    // of virtual time and produces ~4 processed events per round trip, so one
    // simulated hour (60*60*1000ms, ~11,900 events) is nowhere near enough virtual
    // time to reach MAX_EVENTS_PER_RUN (200,000) — confirmed empirically. Advancing
    // to 70,000,000ms virtual time (still cheap: the guard stops dispatching the
    // instant the ceiling is hit, regardless of how far past it the target is)
    // reliably crosses the ~60.5M ms threshold where the ceiling trips.
    sim.advanceTo(70_000_000)
    const snap = sim.snapshot()
    expect(snap.halted).toBeDefined()
    expect(snap.halted!.reason).toContain('event ceiling')
    expect(snap.journal.length).toBeLessThanOrEqual(MAX_JOURNAL)
  })
})
