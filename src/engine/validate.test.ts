import { describe, expect, it } from 'vitest'
import { TRAVEL_MS } from './broker'
import { validateTopology } from './validate'
import type { Topology } from './types'

const base: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'main', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [{ id: 'q1', label: 'work', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers: [],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
  ],
}

describe('validateTopology', () => {
  it('accepts a well-formed topology', () => {
    expect(validateTopology(base)).toEqual([])
  })

  it('flags a binding pointing at a missing destination', () => {
    const broken: Topology = {
      ...base,
      bindings: [{ ...base.bindings[0]!, destinationId: 'ghost' }],
    }
    const issues = validateTopology(broken)
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('ghost'))).toBe(true)
  })

  it('flags a dead-letter exchange that does not exist', () => {
    const broken: Topology = {
      ...base,
      queues: [{ ...base.queues[0]!, deadLetterExchange: 'nope' }],
    }
    expect(validateTopology(broken).some((i) => i.message.includes('nope'))).toBe(true)
  })

  it('flags a dead-letter cycle whose ttl is shorter than one routing hop, not only a ttl of exactly 0', () => {
    const looping = (messageTtlMs: number): Topology => ({
      ...base,
      queues: [{ ...base.queues[0]!, messageTtlMs, deadLetterExchange: 'ex' }],
      bindings: [
        { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
      ],
    })

    // A ttl of 1 loops exactly as hard as a ttl of 0 and used to produce no issue
    // at all — the run just cycled until the event ceiling halted it, with nothing
    // telling the user why. TRAVEL_MS is the cost of one hop, so anything under it
    // re-expires faster than the message can leave.
    for (const ttl of [0, 1, TRAVEL_MS - 1]) {
      const issues = validateTopology(looping(ttl))
      expect(issues.some((i) => i.code === 'short-ttl-dead-letter-cycle')).toBe(true)
      expect(issues.some((i) => i.message.toLowerCase().includes('cycle'))).toBe(true)
    }

    // At or above one hop the pattern is a legitimate retry-with-backoff loop.
    expect(
      validateTopology(looping(TRAVEL_MS)).some((i) => i.code === 'short-ttl-dead-letter-cycle'),
    ).toBe(false)
  })

  it('leaves a queue with a short ttl alone when nothing routes back into it', () => {
    // A short TTL is only a problem when the dead-letter exchange feeds the same
    // queue again. Dead-lettering somewhere else is an ordinary expiry pattern.
    const noCycle: Topology = {
      ...base,
      exchanges: [...base.exchanges, { id: 'dlx', label: 'dlx', type: 'fanout', position: { x: 200, y: 200 } }],
      queues: [
        { ...base.queues[0]!, messageTtlMs: 1, deadLetterExchange: 'dlx' },
        { id: 'dead', label: 'dead', kind: 'classic', position: { x: 400, y: 200 } },
      ],
      bindings: [
        ...base.bindings,
        { id: 'b2', exchangeId: 'dlx', destinationId: 'dead', destinationKind: 'queue' },
      ],
    }
    expect(validateTopology(noCycle).some((i) => i.code === 'short-ttl-dead-letter-cycle')).toBe(false)
  })

  it('warns about a queue no message can reach', () => {
    const orphan: Topology = {
      ...base,
      queues: [...base.queues, { id: 'q2', label: 'orphan', kind: 'classic', position: { x: 400, y: 100 } }],
    }
    const issues = validateTopology(orphan)
    expect(issues.some((i) => i.severity === 'warning' && i.nodeId === 'q2')).toBe(true)
  })

  it('warns about a consumer attached to a queue that does not exist', () => {
    const orphan: Topology = {
      ...base,
      consumers: [
        {
          id: 'c1',
          label: 'worker',
          queueId: 'ghost',
          prefetch: 1,
          autoAck: false,
          processingMs: 500,
          jitterMs: 0,
          nackRate: 0,
          requeueOnNack: true,
          position: { x: 600, y: 0 },
        },
      ],
    }
    expect(validateTopology(orphan).some((i) => i.severity === 'error' && i.nodeId === 'c1')).toBe(true)
  })
})
