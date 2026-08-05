import { describe, expect, it } from 'vitest'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { applyAck, applyConsumeDone, applyDeliver, applyDispatch, applyNack, eligibleConsumers } from './delivery'
import type { ApplyResult, ConsumerSpec, EngineState, SimEvent, Topology } from './types'

const consumer = (over: Partial<ConsumerSpec> & { id: string }): ConsumerSpec => ({
  label: over.id,
  queueId: 'q1',
  prefetch: 1,
  autoAck: false,
  processingMs: 1000,
  jitterMs: 0,
  nackRate: 0,
  requeueOnNack: true,
  position: { x: 600, y: 0 },
  ...over,
})

const topo = (consumers: ConsumerSpec[]): Topology => ({
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'orders', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [{ id: 'q1', label: 'work', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers,
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'go' },
  ],
})

/** Publishes n messages straight into q1, bypassing travel time. */
function seedQueue(state: EngineState, n: number): EngineState {
  let s = state
  for (let i = 0; i < n; i++) {
    const pub: SimEvent = {
      at: 0,
      seq: 0,
      type: 'publish',
      payload: { publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: `job-${i}`, headers: {} },
    }
    const published: ApplyResult = applyPublish(s, pub)
    const routed = applyRoute(published.state, published.newEvents[0]!)
    s = applyEnqueue(routed.state, routed.newEvents[0]!).state
  }
  return s
}

describe('eligibleConsumers', () => {
  it('excludes consumers at their prefetch ceiling', () => {
    const state = createEngineState(topo([consumer({ id: 'c1', prefetch: 1 })]), 1)
    const busy: EngineState = { ...state, unacked: { c1: ['m1'] } }
    expect(eligibleConsumers(busy, 'q1')).toEqual([])
  })

  it('treats prefetch 0 as unlimited', () => {
    const state = createEngineState(topo([consumer({ id: 'c1', prefetch: 0 })]), 1)
    const busy: EngineState = { ...state, unacked: { c1: ['m1', 'm2', 'm3'] } }
    expect(eligibleConsumers(busy, 'q1').map((c) => c.id)).toEqual(['c1'])
  })

  it('excludes crashed consumers', () => {
    const state = createEngineState(topo([consumer({ id: 'c1' })]), 1)
    expect(eligibleConsumers({ ...state, crashed: ['c1'] }, 'q1')).toEqual([])
  })
})

describe('applyDispatch', () => {
  it('removes the head message and schedules a deliver', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1' })]), 1), 1)
    const { state: next, newEvents } = applyDispatch(state, {
      at: state.now,
      seq: 0,
      type: 'dispatch',
      payload: { queueId: 'q1' },
    })
    expect(next.queues.q1).toHaveLength(0)
    expect(next.unacked.c1).toEqual(['m1'])
    expect(newEvents.map((e) => e.type)).toEqual(['deliver'])
  })

  it('does nothing when every consumer is at its prefetch ceiling', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1', prefetch: 1 })]), 1), 2)
    const busy: EngineState = { ...state, unacked: { c1: ['m0'] } }
    const { state: next, newEvents } = applyDispatch(busy, {
      at: 0,
      seq: 0,
      type: 'dispatch',
      payload: { queueId: 'q1' },
    })
    expect(next.queues.q1).toHaveLength(2)
    expect(newEvents).toEqual([])
  })

  it('rotates across idle consumers on back-to-back dispatches, before any delivery lands', () => {
    // prefetch 0 means nobody ever becomes ineligible, so only the cursor can
    // spread the load. No deliver event is applied between dispatches here —
    // that is the real event order, and the bug this guards against.
    const state = seedQueue(
      createEngineState(
        topo([
          consumer({ id: 'c1', prefetch: 0 }),
          consumer({ id: 'c2', prefetch: 0 }),
          consumer({ id: 'c3', prefetch: 0 }),
        ]),
        1,
      ),
      6,
    )
    const dispatch: SimEvent = { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } }
    let current = state
    for (let i = 0; i < 6; i++) {
      current = applyDispatch(current, dispatch).state
    }
    expect(current.unacked.c1).toHaveLength(2)
    expect(current.unacked.c2).toHaveLength(2)
    expect(current.unacked.c3).toHaveLength(2)
  })

  it('never advances the cursor when no consumer is eligible', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1', prefetch: 1 })]), 1), 2)
    const busy: EngineState = { ...state, unacked: { c1: ['m0'] } }
    const { state: next } = applyDispatch(busy, {
      at: 0,
      seq: 0,
      type: 'dispatch',
      payload: { queueId: 'q1' },
    })
    expect(next.roundRobin.q1).toBe(busy.roundRobin.q1)
  })
})

describe('applyDeliver and completion', () => {
  it('schedules consumeDone at now + processingMs', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1', processingMs: 800 })]), 1), 1)
    const dispatched = applyDispatch(state, { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } })
    const deliverEvent = dispatched.newEvents[0]!
    const delivered = applyDeliver({ ...dispatched.state, now: deliverEvent.at }, deliverEvent)
    expect(delivered.newEvents[0]!.type).toBe('consumeDone')
    expect(delivered.newEvents[0]!.at).toBe(deliverEvent.at + 800)
    expect(delivered.state.metrics.delivered).toBe(1)
  })
})

describe('applyAck', () => {
  it('clears the unacked slot and re-dispatches the queue', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1' })]), 1), 2)
    const dispatched = applyDispatch(state, { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } })
    const { state: next, newEvents } = applyAck(dispatched.state, {
      at: 0,
      seq: 0,
      type: 'ack',
      payload: { consumerId: 'c1', messageId: 'm1', queueId: 'q1' },
    })
    expect(next.unacked.c1).toEqual([])
    expect(next.metrics.acked).toBe(1)
    expect(newEvents.map((e) => e.type)).toEqual(['dispatch'])
  })
})

describe('applyNack', () => {
  it('requeues at the head with an incremented redelivery count', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1' })]), 1), 2)
    const dispatched = applyDispatch(state, { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } })
    const inFlightMessage = (dispatched.newEvents[0]!.payload as { message: { id: string } }).message
    expect(inFlightMessage.id).toBe('m1')
    const { state: next } = applyNack(dispatched.state, {
      at: 0,
      seq: 0,
      type: 'nack',
      payload: { message: inFlightMessage, consumerId: 'c1', messageId: 'm1', queueId: 'q1', requeue: true },
    })
    expect(next.queues.q1![0]!.message.id).toBe('m1')
    expect(next.queues.q1![0]!.message.redeliveryCount).toBe(1)
    expect(next.metrics.nacked).toBe(1)
  })
})

describe('applyConsumeDone', () => {
  it('never produces a nack for an auto-ack consumer, even at nackRate 1', () => {
    const state = seedQueue(
      createEngineState(topo([consumer({ id: 'c1', autoAck: true, nackRate: 1 })]), 1),
      1,
    )
    const dispatched = applyDispatch(state, { at: 0, seq: 0, type: 'dispatch', payload: { queueId: 'q1' } })
    const deliverEvent = dispatched.newEvents[0]!
    const delivered = applyDeliver({ ...dispatched.state, now: deliverEvent.at }, deliverEvent)
    const doneEvent = delivered.newEvents[0]!
    const { newEvents } = applyConsumeDone({ ...delivered.state, now: doneEvent.at }, doneEvent)
    expect(newEvents.map((e) => e.type)).toEqual(['ack'])
  })
})
