import { describe, expect, it } from 'vitest'
import { BROKERS, DEFAULT_BROKER_ID, getBroker } from './registry'

describe('broker registry', () => {
  it('lists RabbitMQ', () => {
    expect(BROKERS.map((b) => b.id)).toContain('rabbitmq')
  })

  it('gives every broker a unique id', () => {
    expect(new Set(BROKERS.map((b) => b.id)).size).toBe(BROKERS.length)
  })

  it('resolves a broker by id and falls back to the default for an unknown one', () => {
    expect(getBroker('rabbitmq').label).toBe('RabbitMQ')
    expect(getBroker('nope').id).toBe(DEFAULT_BROKER_ID)
  })

  it("points every broker's defaultLessonId at a lesson it actually ships", () => {
    for (const broker of BROKERS) {
      expect(broker.lessons.map((l) => l.id)).toContain(broker.defaultLessonId)
    }
  })

  it('declares a group for every lesson it ships', () => {
    for (const broker of BROKERS) {
      const groups = new Set(broker.lessonGroups.map((g) => g.id))
      for (const lesson of broker.lessons) expect(groups.has(lesson.group)).toBe(true)
    }
  })
})
