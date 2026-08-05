import { describe, expect, it } from 'vitest'
import { matchBinding, matchTopic, resolveDestinations } from './index'
import type { BindingSpec, Message } from '../types'

const msg = (routingKey: string, headers: Record<string, string> = {}): Message => ({
  id: 'm1',
  body: 'x',
  routingKey,
  headers,
  priority: 0,
  publishedAt: 0,
  redeliveryCount: 0,
  deathTrail: [],
  persistent: false,
})

const bind = (over: Partial<BindingSpec>): BindingSpec => ({
  id: 'b1',
  exchangeId: 'ex',
  destinationId: 'q1',
  destinationKind: 'queue',
  ...over,
})

describe('topic pattern matching', () => {
  it('matches * against exactly one word', () => {
    expect(matchTopic('order.*.created', 'order.eu.created')).toBe(true)
    expect(matchTopic('order.*.created', 'order.created')).toBe(false)
    expect(matchTopic('order.*.created', 'order.eu.west.created')).toBe(false)
  })

  it('matches # against zero or more words', () => {
    expect(matchTopic('order.#', 'order')).toBe(true)
    expect(matchTopic('order.#', 'order.eu.west.created')).toBe(true)
    expect(matchTopic('#', 'anything.at.all')).toBe(true)
  })

  it('matches literal patterns exactly', () => {
    expect(matchTopic('order.created', 'order.created')).toBe(true)
    expect(matchTopic('order.created', 'order.updated')).toBe(false)
  })
})

describe('matchBinding', () => {
  it('direct requires an exact routing key', () => {
    expect(matchBinding('direct', bind({ routingKey: 'pay' }), msg('pay'))).toBe(true)
    expect(matchBinding('direct', bind({ routingKey: 'pay' }), msg('ship'))).toBe(false)
  })

  it('fanout ignores the routing key', () => {
    expect(matchBinding('fanout', bind({ routingKey: 'ignored' }), msg('anything'))).toBe(true)
  })

  it('headers with x-match all requires every header to match', () => {
    const b = bind({ headers: { format: 'pdf', kind: 'report' }, xMatch: 'all' })
    expect(matchBinding('headers', b, msg('', { format: 'pdf', kind: 'report' }))).toBe(true)
    expect(matchBinding('headers', b, msg('', { format: 'pdf' }))).toBe(false)
  })

  it('headers with x-match any requires one header to match', () => {
    const b = bind({ headers: { format: 'pdf', kind: 'report' }, xMatch: 'any' })
    expect(matchBinding('headers', b, msg('', { format: 'pdf' }))).toBe(true)
    expect(matchBinding('headers', b, msg('', { format: 'csv' }))).toBe(false)
  })
})

describe('resolveDestinations', () => {
  it('returns every matching binding so fanout hits all queues', () => {
    const bindings = [
      bind({ id: 'b1', destinationId: 'q1' }),
      bind({ id: 'b2', destinationId: 'q2' }),
    ]
    expect(resolveDestinations('fanout', bindings, msg('x')).map((b) => b.destinationId)).toEqual([
      'q1',
      'q2',
    ])
  })

  it('deduplicates a queue bound twice to the same exchange', () => {
    const bindings = [
      bind({ id: 'b1', destinationId: 'q1', routingKey: 'a' }),
      bind({ id: 'b2', destinationId: 'q1', routingKey: 'b' }),
    ]
    const hits = resolveDestinations('topic', bindings, msg('a'))
    expect(hits).toHaveLength(1)
  })

  it('returns an empty array when nothing matches', () => {
    expect(resolveDestinations('direct', [bind({ routingKey: 'a' })], msg('z'))).toEqual([])
  })
})
