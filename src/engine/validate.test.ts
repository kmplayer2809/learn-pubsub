import { describe, expect, it } from 'vitest'
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

  it('flags a zero-ttl dead-letter cycle that would never advance time', () => {
    const looping: Topology = {
      ...base,
      queues: [{ ...base.queues[0]!, messageTtlMs: 0, deadLetterExchange: 'ex' }],
      bindings: [
        { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
      ],
    }
    const issues = validateTopology(looping)
    expect(issues.some((i) => i.message.toLowerCase().includes('cycle'))).toBe(true)
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
