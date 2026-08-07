import { describe, expect, it } from 'vitest'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { createSimulation } from './index'
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

  it('puts the rewritten message on the wire, not the pre-death one', () => {
    // The in-flight panel reads routingKey, priority and redeliveryCount straight off
    // InFlight.message — there is nowhere else to look them up while a message is on
    // the wire. Animating the pre-death copy showed stale values for the whole 600ms
    // hop, exactly when a learner is watching to see what dead-lettering changed.
    const rekeying: Topology = {
      ...topology,
      queues: topology.queues.map((q) =>
        q.id === 'q1' ? { ...q, deadLetterRoutingKey: 'dead-key' } : q,
      ),
    }
    const state = createEngineState(rekeying, 1)
    const original = message('m1', { routingKey: 'go', redeliveryCount: 3 })
    const { state: next, newEvents } = deadLetter(state, original, 'q1', 'expired')

    const flight = next.inFlight.find((f) => f.edgeId === 'q1->dlx')!
    const carried = newEvents[0]!.payload.message as Message
    expect(flight.message).toEqual(carried)
    expect(flight.message.routingKey).toBe('dead-key')
    expect(flight.message.redeliveryCount).toBe(0)
    expect(flight.message.headers['x-death-reason']).toBe('expired')
    // The id is untouched, so clearInFlight still finds this hop on arrival.
    expect(flight.message.id).toBe(original.id)
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

  it('expires each message on its own timer, not only the one at the head of the queue', () => {
    // A real classic queue only checks expiry at its head, so a short-TTL message
    // sitting behind a long-TTL one waits for the head to leave — head-of-line
    // blocking. This engine schedules an independent ttlExpire per enqueue
    // (broker.ts applyEnqueue), so position in the queue does not affect when a
    // message expires. Lesson 16's narrative and checkpoint say exactly this, and
    // used to claim the opposite; this test is what makes that claim checkable.
    const slow = message('slow', { expirationMs: 9000 })
    const fast = message('fast', { expirationMs: 1000 })
    const enqueue = (m: Message, at: number): SimEvent => ({
      at,
      seq: 0,
      type: 'enqueue',
      payload: { message: m, queueId: 'q1', fromId: 'ex' },
    })

    const base = createEngineState(topology, 1)
    const first = applyEnqueue({ ...base, now: 0 }, enqueue(slow, 0))
    const second = applyEnqueue({ ...first.state, now: 100 }, enqueue(fast, 100))

    // q1 declares messageTtlMs 2000, and effectiveTtl takes the smaller of the two,
    // so `slow` expires at 2000 while `fast` carries its own 1000 and expires at 1100.
    const ttlEvents = [...first.newEvents, ...second.newEvents].filter((e) => e.type === 'ttlExpire')
    expect(ttlEvents.map((e) => `${e.payload.messageId}@${e.at}`)).toEqual(['slow@2000', 'fast@1100'])

    // The message behind the head leaves first, while the head is still queued.
    const expired = applyTtlExpire({ ...second.state, now: 1100 }, {
      at: 1100,
      seq: 0,
      type: 'ttlExpire',
      payload: { messageId: 'fast', queueId: 'q1', enqueuedAt: 100 },
    })
    expect(expired.state.queues.q1!.map((q) => q.message.id)).toEqual(['slow'])
    expect(expired.state.metrics.deadLettered).toBe(1)
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

  it('expires both copies when a symmetric fan-in enqueues one message twice at the same instant', () => {
    // `(id, enqueuedAt)` is NOT unique. Two exchange-to-exchange paths of equal
    // length deliver the same message to the same queue in the same millisecond,
    // so both copies share both fields. Each gets its own ttlExpire, and removing
    // by the pair destroyed both on the first event while dead-lettering and
    // counting only one — the second copy vanished with no journal line and no
    // metric. This runs the whole engine rather than poking reducers, because the
    // equal timestamps are the thing under test and only the engine produces them.
    const topology: Topology = {
      publishers: [{ id: 'p1', label: 'P', position: { x: 0, y: 0 } }],
      exchanges: [
        { id: 'root', label: 'root', type: 'direct', position: { x: 100, y: 0 } },
        { id: 'a', label: 'a', type: 'fanout', position: { x: 200, y: 0 } },
        { id: 'b', label: 'b', type: 'fanout', position: { x: 200, y: 100 } },
        { id: 'dlx', label: 'dlx', type: 'fanout', position: { x: 400, y: 0 } },
      ],
      queues: [
        queue({ id: 'q1', messageTtlMs: 2000, deadLetterExchange: 'dlx' }),
        queue({ id: 'dead' }),
      ],
      consumers: [],
      bindings: [
        { id: 'r-a', exchangeId: 'root', destinationId: 'a', destinationKind: 'exchange', routingKey: 'k' },
        { id: 'r-b', exchangeId: 'root', destinationId: 'b', destinationKind: 'exchange', routingKey: 'k' },
        { id: 'a-q', exchangeId: 'a', destinationId: 'q1', destinationKind: 'queue', routingKey: '' },
        { id: 'b-q', exchangeId: 'b', destinationId: 'q1', destinationKind: 'queue', routingKey: '' },
        { id: 'd-q', exchangeId: 'dlx', destinationId: 'dead', destinationKind: 'queue', routingKey: '' },
      ],
    }
    const sim = createSimulation({
      topology,
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'root', routingKey: 'k', body: 'x' }],
      seed: 1,
    })

    // Both copies really do land in the same millisecond — if this ever stops being
    // true the test below still passes but no longer tests anything, so pin it.
    sim.advanceTo(1900)
    const queued = sim.snapshot().queues.q1!
    expect(queued).toHaveLength(2)
    expect(queued[0]!.enqueuedAt).toBe(queued[1]!.enqueuedAt)

    sim.advanceTo(30_000)
    const final = sim.snapshot()
    expect(final.metrics.expired).toBe(2)
    expect(final.metrics.deadLettered).toBe(2)
    expect(final.queues.q1).toHaveLength(0)
    expect(final.queues.dead).toHaveLength(2)
  })
})
