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

  it('flags a self-returning dead-letter cycle at every ttl, not only short ones', () => {
    const looping = (messageTtlMs: number): Topology => ({
      ...base,
      queues: [{ ...base.queues[0]!, messageTtlMs, deadLetterExchange: 'ex' }],
      bindings: [
        { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
      ],
    })

    // The TTL only sets how fast this cycles, never whether it does. An earlier
    // version gated on `ttl < TRAVEL_MS`, reasoning that a short TTL re-expires the
    // message "before it has finished moving" — but the timer starts at enqueue,
    // which is already after the travel. TRAVEL_MS and TRAVEL_MS * 10 loop exactly
    // as hard as 0, and used to pass silently.
    for (const ttl of [0, 1, TRAVEL_MS - 1, TRAVEL_MS, TRAVEL_MS * 10]) {
      const issues = validateTopology(looping(ttl))
      expect(issues.some((i) => i.code === 'self-dead-letter-cycle')).toBe(true)
    }

    // No TTL means nothing ever expires, so the message just waits: not a cycle.
    expect(
      validateTopology({
        ...base,
        queues: [{ ...base.queues[0]!, deadLetterExchange: 'ex' }],
        bindings: [
          { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
        ],
      }).some((i) => i.code === 'self-dead-letter-cycle'),
    ).toBe(false)
  })

  it('leaves lesson 13-style retry-with-backoff alone: the cycle is longer than one queue', () => {
    // work -> retry-ex -> retry-1s -(ttl)-> main-ex -> work is a real cycle, but no
    // queue's OWN dead-letter exchange routes back into it. This guard is deliberately
    // narrow enough not to flag the pattern lesson 13 exists to teach.
    const retry: Topology = {
      ...base,
      exchanges: [
        { id: 'main-ex', label: 'main-ex', type: 'direct', position: { x: 0, y: 0 } },
        { id: 'retry-ex', label: 'retry-ex', type: 'direct', position: { x: 100, y: 0 } },
      ],
      queues: [
        { id: 'work', label: 'work', kind: 'classic', position: { x: 200, y: 0 }, deadLetterExchange: 'retry-ex' },
        { id: 'retry-1s', label: 'retry-1s', kind: 'classic', position: { x: 300, y: 0 }, messageTtlMs: 1000, deadLetterExchange: 'main-ex' },
      ],
      bindings: [
        { id: 'b1', exchangeId: 'main-ex', destinationId: 'work', destinationKind: 'queue', routingKey: 'order' },
        { id: 'b2', exchangeId: 'retry-ex', destinationId: 'retry-1s', destinationKind: 'queue', routingKey: 'order' },
      ],
    }
    expect(validateTopology(retry).some((i) => i.code === 'self-dead-letter-cycle')).toBe(false)
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
    expect(validateTopology(noCycle).some((i) => i.code === 'self-dead-letter-cycle')).toBe(false)
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
