import { describe, expect, it } from 'vitest'
import { progressOf } from './geometry'
import type { InFlight, Message } from '../../../brokers/rabbitmq/engine'

const message: Message = {
  id: 'm1',
  body: '',
  routingKey: '',
  headers: {},
  priority: 0,
  publishedAt: 0,
  redeliveryCount: 0,
  deathTrail: [],
  persistent: false,
}

const flight = (fromT: number, toT: number): InFlight => ({
  message,
  edgeId: 'a->b',
  fromT,
  toT,
  tone: 'sky',
})

describe('progressOf', () => {
  it('is 0 at the start of travel', () => {
    expect(progressOf(flight(1000, 1600), 1000)).toBe(0)
  })

  it('is 0.5 at the midpoint', () => {
    expect(progressOf(flight(1000, 1600), 1300)).toBeCloseTo(0.5)
  })

  it('is 1 at the end', () => {
    expect(progressOf(flight(1000, 1600), 1600)).toBe(1)
  })

  it('clamps before the start and after the end', () => {
    expect(progressOf(flight(1000, 1600), 500)).toBe(0)
    expect(progressOf(flight(1000, 1600), 9000)).toBe(1)
  })

  it('returns 1 for a zero-length interval instead of dividing by zero', () => {
    expect(progressOf(flight(1000, 1000), 1000)).toBe(1)
  })
})
