import { describe, expect, it } from 'vitest'
import {
  applyConsumerCrash,
  applyConsumerRecover,
  buildReplyEvents,
  insertByPriority,
  requeueByPriority,
} from './advanced'
import { createEngineState } from './broker'
import type { EngineState, Message, QueuedMessage, Topology } from './types'

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

const entry = (id: string, priority: number): QueuedMessage => ({
  message: message(id, { priority }),
  enqueuedAt: 0,
})

const topology: Topology = {
  publishers: [{ id: 'p1', label: 'API', position: { x: 0, y: 0 } }],
  exchanges: [
    { id: 'ex', label: 'rpc', type: 'direct', position: { x: 200, y: 0 } },
    { id: 'replies', label: 'replies', type: 'direct', position: { x: 800, y: 0 } },
  ],
  queues: [{ id: 'q1', label: 'work', kind: 'classic', position: { x: 400, y: 0 } }],
  consumers: [
    {
      id: 'c1',
      label: 'worker',
      queueId: 'q1',
      prefetch: 1,
      autoAck: false,
      processingMs: 500,
      jitterMs: 0,
      nackRate: 0,
      requeueOnNack: true,
      position: { x: 600, y: 0 },
    },
  ],
  bindings: [],
}

describe('insertByPriority', () => {
  it('appends when the queue has no maxPriority', () => {
    const queue = [entry('m1', 0)]
    expect(insertByPriority(queue, entry('m2', 9), undefined).map((q) => q.message.id)).toEqual(['m1', 'm2'])
  })

  it('places a higher priority message ahead of lower ones', () => {
    const queue = [entry('m1', 1), entry('m2', 1)]
    expect(insertByPriority(queue, entry('m3', 5), 10).map((q) => q.message.id)).toEqual(['m3', 'm1', 'm2'])
  })

  it('keeps equal priorities in arrival order', () => {
    const queue = [entry('m1', 5), entry('m2', 5)]
    expect(insertByPriority(queue, entry('m3', 5), 10).map((q) => q.message.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('places a lower priority message behind higher ones', () => {
    const queue = [entry('m1', 9)]
    expect(insertByPriority(queue, entry('m2', 1), 10).map((q) => q.message.id)).toEqual(['m1', 'm2'])
  })
})

describe('requeueByPriority', () => {
  it('prepends when the queue has no maxPriority', () => {
    const queue = [entry('m1', 0), entry('m2', 0)]
    expect(requeueByPriority(queue, entry('m3', 0), undefined).map((q) => q.message.id)).toEqual(['m3', 'm1', 'm2'])
  })

  it('does not let a rejected low-priority message jump ahead of waiting high-priority ones', () => {
    const queue = [entry('m-high', 9), entry('m-mid', 5)]
    expect(requeueByPriority(queue, entry('m-low', 0), 9).map((q) => q.message.id)).toEqual([
      'm-high',
      'm-mid',
      'm-low',
    ])
  })

  it('returns the message to the head of its own priority band, ahead of equals', () => {
    const queue = [entry('m-high', 9), entry('m-peer', 5), entry('m-low', 0)]
    expect(requeueByPriority(queue, entry('m-back', 5), 9).map((q) => q.message.id)).toEqual([
      'm-high',
      'm-back',
      'm-peer',
      'm-low',
    ])
  })
})

describe('applyConsumerCrash', () => {
  it('requeues unacked messages at the head with an incremented redelivery count', () => {
    const base = createEngineState(topology, 1)
    const state: EngineState = {
      ...base,
      unacked: { c1: ['m1'] },
      queues: { q1: [entry('m2', 0)] },
    }
    const held = new Map([['m1', message('m1')]])
    const { state: next } = applyConsumerCrash(
      { ...state, journal: [] },
      { at: 0, seq: 0, type: 'consumerCrash', payload: { consumerId: 'c1', heldMessages: [...held.values()] } },
    )
    expect(next.crashed).toEqual(['c1'])
    expect(next.unacked.c1).toEqual([])
    expect(next.queues.q1!.map((q) => q.message.id)).toEqual(['m1', 'm2'])
    expect(next.queues.q1![0]!.message.redeliveryCount).toBe(1)
  })

  it('does not let a held low-priority message jump ahead of a waiting high-priority one on a priority queue', () => {
    const priorityTopology: Topology = {
      ...topology,
      queues: [{ ...topology.queues[0]!, maxPriority: 9 }],
    }
    const base = createEngineState(priorityTopology, 1)
    const state: EngineState = {
      ...base,
      unacked: { c1: ['m-low'] },
      queues: { q1: [entry('m-high', 9)] },
    }
    const held = [message('m-low', { priority: 0 })]
    const { state: next } = applyConsumerCrash(
      { ...state, journal: [] },
      { at: 0, seq: 0, type: 'consumerCrash', payload: { consumerId: 'c1', heldMessages: held } },
    )
    expect(next.queues.q1!.map((q) => q.message.id)).toEqual(['m-high', 'm-low'])
  })
})

describe('applyConsumerRecover', () => {
  it('clears the crashed flag and re-dispatches the queue', () => {
    const base = createEngineState(topology, 1)
    const { state: next, newEvents } = applyConsumerRecover(
      { ...base, crashed: ['c1'] },
      { at: 0, seq: 0, type: 'consumerRecover', payload: { consumerId: 'c1' } },
    )
    expect(next.crashed).toEqual([])
    expect(newEvents.map((e) => e.type)).toEqual(['dispatch'])
  })
})

describe('buildReplyEvents', () => {
  it('publishes a reply carrying the same correlationId', () => {
    const state = createEngineState(topology, 1)
    const request = message('m1', { correlationId: 'corr-1', replyTo: 'replies' })
    const [events] = buildReplyEvents(state, request, 'c1')
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('publish')
    expect(events[0]!.payload.correlationId).toBe('corr-1')
    expect(events[0]!.payload.exchangeId).toBe('replies')
  })

  it('produces nothing for a message with no replyTo', () => {
    const state = createEngineState(topology, 1)
    const [events] = buildReplyEvents(state, message('m1'), 'c1')
    expect(events).toEqual([])
  })
})
