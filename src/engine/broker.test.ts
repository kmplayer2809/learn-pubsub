import { describe, expect, it } from 'vitest'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import type { SimEvent, Topology } from './types'

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [{ id: 'ex', label: 'orders', type: 'direct', position: { x: 200, y: 0 } }],
  queues: [
    { id: 'q1', label: 'pay', kind: 'classic', position: { x: 400, y: 0 } },
    { id: 'q2', label: 'ship', kind: 'classic', position: { x: 400, y: 100 } },
  ],
  consumers: [],
  bindings: [
    { id: 'b1', exchangeId: 'ex', destinationId: 'q1', destinationKind: 'queue', routingKey: 'pay' },
    { id: 'b2', exchangeId: 'ex', destinationId: 'q2', destinationKind: 'queue', routingKey: 'ship' },
  ],
}

const publishEvent = (routingKey: string): SimEvent => ({
  at: 0,
  seq: 0,
  type: 'publish',
  payload: { publisherId: 'p1', exchangeId: 'ex', routingKey, body: 'order-1', headers: {} },
})

describe('applyPublish', () => {
  it('mints a message, counts it, and schedules a route event', () => {
    const state = createEngineState(topology, 1)
    const { state: next, newEvents } = applyPublish(state, publishEvent('pay'))
    expect(next.metrics.published).toBe(1)
    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]!.type).toBe('route')
  })

  it('adds an in-flight particle on the publisher-to-exchange edge', () => {
    const state = createEngineState(topology, 1)
    const { state: next } = applyPublish(state, publishEvent('pay'))
    expect(next.inFlight).toHaveLength(1)
    expect(next.inFlight[0]!.edgeId).toBe('p1->ex')
  })

  it('does not mutate the state it is given', () => {
    const state = createEngineState(topology, 1)
    applyPublish(state, publishEvent('pay'))
    expect(state.metrics.published).toBe(0)
    expect(state.inFlight).toHaveLength(0)
  })
})

describe('applyRoute', () => {
  it('schedules one enqueue per matching binding', () => {
    const state = createEngineState(topology, 1)
    const published = applyPublish(state, publishEvent('pay'))
    const routeEvent = published.newEvents[0]!
    const { newEvents } = applyRoute(published.state, routeEvent)
    expect(newEvents.map((e) => e.type)).toEqual(['enqueue'])
    expect(newEvents[0]!.payload.queueId).toBe('q1')
  })

  it('drops an unroutable message and records it', () => {
    const state = createEngineState(topology, 1)
    const published = applyPublish(state, publishEvent('nowhere'))
    const { state: next, newEvents } = applyRoute(published.state, published.newEvents[0]!)
    expect(newEvents).toEqual([])
    expect(next.metrics.dropped).toBe(1)
    expect(next.journal.some((j) => j.text.includes('unroutable'))).toBe(true)
  })
})

describe('applyEnqueue', () => {
  it('appends the message to the queue and clears its in-flight particle', () => {
    const state = createEngineState(topology, 1)
    const published = applyPublish(state, publishEvent('pay'))
    const routed = applyRoute(published.state, published.newEvents[0]!)
    const enqueued = applyEnqueue(routed.state, routed.newEvents[0]!)
    expect(enqueued.state.queues.q1).toHaveLength(1)
    expect(enqueued.state.inFlight).toHaveLength(0)
    expect(enqueued.newEvents.map((e) => e.type)).toEqual(['dispatch'])
  })
})
