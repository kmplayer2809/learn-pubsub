import { describe, expect, it } from 'vitest'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { applyTtlExpire, deadLetter, effectiveTtl } from './dlx'
import type { EngineState, Message, QueueSpec, SimEvent, Topology } from './types'

const queue = (over: Partial<QueueSpec> & { id: string }): QueueSpec => ({
  label: over.id,
  kind: 'classic',
  position: { x: 400, y: 0 },
  ...over,
})

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [
    { id: 'ex', label: 'main', type: 'direct', position: { x: 200, y: 0 } },
    { id: 'dlx', label: 'dlx', type: 'fanout', position: { x: 200, y: 200 } },
  ],
  queues: [
    queue({ id: 'q1', messageTtlMs: 2000, maxLength: 2, deadLetterExchange: 'dlx' }),
    queue({ id: 'dead', position: { x: 400, y: 200 } }),
    queue({ id: 'nodlx' }),
  ],
  consumers: [],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
    { id: 'b2', exchangeId: 'dlx', destinationId: 'dead', destinationKind: 'queue' },
  ],
}

const message = (id: string, over: Partial<Message> = {}): Message => ({
  id,
  body: 'x',
  routingKey: 'go',
  headers: {},
  priority: 0,
  publishedAt: 0,
  redeliveryCount: 0,
  deathTrail: [],
  persistent: false,
  ...over,
})

function publishInto(state: EngineState, body: string): EngineState {
  const pub: SimEvent = {
    at: state.now,
    seq: 0,
    type: 'publish',
    payload: { publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body, headers: {} },
  }
  const published = applyPublish(state, pub)
  const routed = applyRoute(published.state, published.newEvents[0]!)
  return applyEnqueue(routed.state, routed.newEvents[0]!).state
}

describe('effectiveTtl', () => {
  it('uses the queue ttl when the message has none', () => {
    expect(effectiveTtl(queue({ id: 'q', messageTtlMs: 5000 }), message('m1'))).toBe(5000)
  })

  it('uses the smaller of queue and message expiry', () => {
    expect(effectiveTtl(queue({ id: 'q', messageTtlMs: 5000 }), message('m1', { expirationMs: 1000 }))).toBe(1000)
  })

  it('returns undefined when neither is set', () => {
    expect(effectiveTtl(queue({ id: 'q' }), message('m1'))).toBeUndefined()
  })
})

describe('deadLetter', () => {
  it('records the source queue in the death trail and republishes to the dlx', () => {
    const state = createEngineState(topology, 1)
    const { state: next, newEvents } = deadLetter(state, message('m1'), 'q1', 'expired')
    expect(next.metrics.deadLettered).toBe(1)
    expect(newEvents.map((e) => e.type)).toEqual(['route'])
    const carried = newEvents[0]!.payload.message as Message
    expect(carried.deathTrail).toEqual(['q1'])
    expect(carried.redeliveryCount).toBe(0)
  })

  it('drops the message when the queue has no dead-letter exchange', () => {
    const state = createEngineState(topology, 1)
    const { state: next, newEvents } = deadLetter(state, message('m1'), 'nodlx', 'rejected')
    expect(newEvents).toEqual([])
    expect(next.metrics.dropped).toBe(1)
  })
})

describe('max-length overflow', () => {
  it('dead-letters the oldest message when the queue is full', () => {
    let state = createEngineState(topology, 1)
    state = publishInto(state, 'a')
    state = publishInto(state, 'b')
    state = publishInto(state, 'c')
    expect(state.queues.q1).toHaveLength(2)
    expect(state.queues.q1!.map((q) => q.message.body)).toEqual(['b', 'c'])
    expect(state.metrics.deadLettered).toBe(1)
  })
})

describe('applyTtlExpire', () => {
  it('dead-letters a message still sitting in the queue', () => {
    let state = createEngineState(topology, 1)
    state = publishInto(state, 'a')
    const entry = state.queues.q1![0]!
    const { state: next } = applyTtlExpire({ ...state, now: 2000 }, {
      at: 2000,
      seq: 0,
      type: 'ttlExpire',
      payload: { messageId: entry.message.id, queueId: 'q1', enqueuedAt: entry.enqueuedAt },
    })
    expect(next.queues.q1).toHaveLength(0)
    expect(next.metrics.expired).toBe(1)
  })

  it('is a no-op when the message already left the queue', () => {
    const state = createEngineState(topology, 1)
    const { state: next, newEvents } = applyTtlExpire(state, {
      at: 2000,
      seq: 0,
      type: 'ttlExpire',
      payload: { messageId: 'gone', queueId: 'q1', enqueuedAt: 0 },
    })
    expect(newEvents).toEqual([])
    expect(next.metrics.expired).toBe(0)
  })

  it('removes only the enqueue it matched when the queue holds two copies of one id', () => {
    // An exchange-to-exchange diamond legitimately lands the same message id in one
    // queue twice, as a real broker would. The lookup already keys on enqueuedAt;
    // the removal must too, or the second copy vanishes with no dead-letter line
    // and no metric — silent message loss.
    let state = createEngineState(topology, 1)
    state = publishInto(state, 'a')
    const first = state.queues.q1![0]!
    const second = { message: first.message, enqueuedAt: first.enqueuedAt + 100 }
    const twice: EngineState = { ...state, queues: { ...state.queues, q1: [first, second] } }

    const { state: next } = applyTtlExpire({ ...twice, now: 2000 }, {
      at: 2000,
      seq: 0,
      type: 'ttlExpire',
      payload: { messageId: first.message.id, queueId: 'q1', enqueuedAt: first.enqueuedAt },
    })

    expect(next.queues.q1).toHaveLength(1)
    expect(next.queues.q1![0]!.enqueuedAt).toBe(second.enqueuedAt)
    expect(next.metrics.expired).toBe(1)
  })

  it('ignores a stale TTL from a previous stay after the message cycles back', () => {
    let state = createEngineState(topology, 1)
    state = publishInto(state, 'a')
    const firstEntry = state.queues.q1![0]!

    // The message leaves and re-enters the queue later, keeping its id but
    // taking a new enqueuedAt. The TTL scheduled for the first stay must not
    // touch this second one.
    const requeued = {
      message: firstEntry.message,
      enqueuedAt: firstEntry.enqueuedAt + 5000,
    }
    const cycled: EngineState = { ...state, queues: { ...state.queues, q1: [requeued] } }

    const { state: next, newEvents } = applyTtlExpire({ ...cycled, now: 7000 }, {
      at: 7000,
      seq: 0,
      type: 'ttlExpire',
      payload: {
        messageId: firstEntry.message.id,
        queueId: 'q1',
        enqueuedAt: firstEntry.enqueuedAt,
      },
    })

    expect(next.queues.q1).toHaveLength(1)
    expect(next.metrics.expired).toBe(0)
    expect(newEvents).toEqual([])
  })
})
