import { describe, expect, it } from 'vitest'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { applyAck, applyConsumeDone, applyDeliver, applyDispatch, applyNack, eligibleConsumers } from './delivery'
import { createSimulation } from './index'
import type { ApplyResult, ConsumerSpec, EngineState, Message, SimEvent, Topology } from './types'

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
    const busy: EngineState = { ...state, unacked: { c1: [message('m1')] } }
    expect(eligibleConsumers(busy, 'q1')).toEqual([])
  })

  it('treats prefetch 0 as unlimited', () => {
    const state = createEngineState(topo([consumer({ id: 'c1', prefetch: 0 })]), 1)
    const busy: EngineState = { ...state, unacked: { c1: ['m1', 'm2', 'm3'].map((id) => message(id)) } }
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
    expect((next.unacked.c1 ?? []).map((m) => m.id)).toEqual(['m1'])
    expect(newEvents.map((e) => e.type)).toEqual(['deliver'])
  })

  it('does nothing when every consumer is at its prefetch ceiling', () => {
    const state = seedQueue(createEngineState(topo([consumer({ id: 'c1', prefetch: 1 })]), 1), 2)
    const busy: EngineState = { ...state, unacked: { c1: [message('m0')] } }
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
    const busy: EngineState = { ...state, unacked: { c1: [message('m0')] } }
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

  it('does not let a rejected low-priority message jump ahead of waiting high-priority ones on a priority queue', () => {
    const priorityTopo = topo([consumer({ id: 'c1' })])
    priorityTopo.queues = [{ ...priorityTopo.queues[0]!, maxPriority: 9 }]
    const base = createEngineState(priorityTopo, 1)
    const lowPriorityMessage = {
      id: 'm-low',
      body: 'x',
      routingKey: 'go',
      headers: {},
      priority: 0,
      publishedAt: 0,
      redeliveryCount: 0,
      deathTrail: [],
      persistent: false,
    }
    const state: EngineState = {
      ...base,
      queues: {
        q1: [
          { message: { ...lowPriorityMessage, id: 'm-high', priority: 9 }, enqueuedAt: 0 },
          { message: { ...lowPriorityMessage, id: 'm-mid', priority: 5 }, enqueuedAt: 0 },
        ],
      },
    }
    const { state: next } = applyNack(state, {
      at: 0,
      seq: 0,
      type: 'nack',
      payload: { message: lowPriorityMessage, consumerId: 'c1', messageId: 'm-low', queueId: 'q1', requeue: true },
    })
    expect(next.queues.q1!.map((q) => q.message.id)).toEqual(['m-high', 'm-mid', 'm-low'])
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

describe('a crash cancels the work it interrupted', () => {
  it('does not ack a message whose processing was interrupted by a crash', () => {
    // One manual-ack consumer, processingMs long enough that the crash lands mid-work.
    // Timings account for the full publish -> route -> enqueue -> dispatch -> deliver
    // pipeline: with TRAVEL_MS = 600, a message published at t=0 dispatches at t=1200
    // and is delivered (processing starts) at t=1800. processingMs=1000 means the
    // uninterrupted consumeDone would fire at t=2800, so a crash at t=2000 genuinely
    // lands mid-work rather than before delivery even happens.
    const sim = createSimulation({
      topology: topo([consumer({ id: 'c1', processingMs: 1000 })]),
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'job' }],
      failures: [
        { at: 2000, consumerId: 'c1', kind: 'crash' },
        { at: 3000, consumerId: 'c1', kind: 'recover' },
      ],
      seed: 1,
    })
    sim.advanceTo(20_000)
    const state = sim.snapshot()

    const acked = state.journal.filter((j) => j.type === 'ack').map((j) => j.messageId)
    // Exactly one ack: the redelivery after recovery. The interrupted attempt must
    // produce none, or the same message is confirmed twice.
    expect(acked).toEqual(['m1'])
    expect(state.metrics.acked).toBe(1)
  })

  it('hands work requeued by a crash to a healthy sibling consumer', () => {
    // The single most important thing competing consumers are for. c1 takes the
    // message and is still holding it when it dies; c2 is idle on the same queue
    // and must be offered the requeued message without waiting for c1 to recover.
    const sim = createSimulation({
      topology: topo([
        consumer({ id: 'c1', processingMs: 10_000 }),
        consumer({ id: 'c2', processingMs: 500 }),
      ]),
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'job' }],
      failures: [{ at: 3000, consumerId: 'c1', kind: 'crash' }],
      seed: 1,
    })
    sim.advanceTo(30_000)
    const state = sim.snapshot()

    expect(state.queues.q1).toHaveLength(0)
    expect(state.metrics.acked).toBe(1)
    expect(state.journal.filter((j) => j.type === 'ack').map((j) => j.nodeId)).toEqual(['c2'])
    // Nothing left to run: the sim drained because the work was done, not stalled.
    expect(sim.nextEventTime()).toBeUndefined()
  })

  it('drops a delivery whose consumer crashed while the message was still on the wire', () => {
    // The dispatch -> deliver window, not the deliver -> consumeDone one. With
    // TRAVEL_MS = 600 the message dispatches at t=1200 and lands at t=1800, so a
    // crash at t=1500 catches it mid-hop: applyConsumerCrash requeues it, and the
    // pending deliver must not also hand it to the crashed consumer. Without the
    // epoch guard on `deliver` the requeued copy is redelivered after recovery and
    // the same message is acked twice.
    const sim = createSimulation({
      topology: topo([consumer({ id: 'c1', processingMs: 1000 })]),
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'job' }],
      failures: [
        { at: 1500, consumerId: 'c1', kind: 'crash' },
        { at: 5000, consumerId: 'c1', kind: 'recover' },
      ],
      seed: 1,
    })
    sim.advanceTo(20_000)
    const state = sim.snapshot()

    const acked = state.journal.filter((j) => j.type === 'ack').map((j) => j.messageId)
    expect(new Set(acked).size).toBe(acked.length)
    expect(acked).toEqual(['m1'])
    expect(state.metrics.acked).toBe(1)
    // One real delivery, after recovery. The interrupted hop never arrived.
    expect(state.metrics.delivered).toBe(1)
    expect(state.journal.filter((j) => j.type === 'deliver')).toHaveLength(1)
    expect(state.queues.q1).toHaveLength(0)
  })

  it('leaves a mid-flight message queued and un-delivered when the consumer never recovers', () => {
    // Same window as above with no recover, so nothing later reuses the q1->c1 edge.
    // That makes both halves observable: the delivery must never land on the crashed
    // consumer, and the particle for the abandoned hop must not stay on the canvas.
    const sim = createSimulation({
      topology: topo([consumer({ id: 'c1', processingMs: 1000 })]),
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'job' }],
      failures: [{ at: 1500, consumerId: 'c1', kind: 'crash' }],
      seed: 1,
    })
    sim.advanceTo(20_000)
    const state = sim.snapshot()

    expect(state.metrics.delivered).toBe(0)
    expect(state.metrics.acked).toBe(0)
    // Requeued and waiting for a consumer that never comes back.
    expect(state.queues.q1).toHaveLength(1)
    expect(state.inFlight).toEqual([])
  })

  it('does not ack an auto-ack consumer whose work the crash destroyed', () => {
    // Same pipeline timing as above: delivery lands at t=1800, the stale consumeDone
    // would fire at t=2800, so a crash at t=2000 lands mid-work.
    const sim = createSimulation({
      topology: topo([consumer({ id: 'c1', processingMs: 1000, autoAck: true })]),
      script: [{ at: 0, publisherId: 'p1', exchangeId: 'ex', routingKey: 'go', body: 'job' }],
      failures: [{ at: 2000, consumerId: 'c1', kind: 'crash' }],
      seed: 1,
    })
    sim.advanceTo(20_000)
    const state = sim.snapshot()

    // Auto-ack removes the message from the broker at dispatch, so nothing is requeued
    // and nothing is redelivered: the work is simply gone. An ack here would claim the
    // message was handled.
    expect(state.metrics.acked).toBe(0)
    expect(state.queues.q1).toHaveLength(0)
  })
})
