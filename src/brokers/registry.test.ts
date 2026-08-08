import { describe, expect, it } from 'vitest'
import { BROKERS, DEFAULT_BROKER_ID, getBroker } from './registry'
import { BROKER_CATALOG } from './catalog'

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

  it('every broker replays every lesson it ships identically from the same seed', () => {
    // Determinism is the product's core contract: two runs from the same seed must
    // produce byte-for-byte the same journal, or the "rewind by replaying" trick that
    // `useSimulation.ts` relies on for scrubbing would silently drift.
    //
    // This used to check only `defaultLessonId`, which passes vacuously for RabbitMQ:
    // its default, 01-hello-world, has jitterMs: 0 and nackRate: 0, so it never draws
    // from the seeded RNG at all. Checking every shipped lesson instead means the gate
    // actually exercises randomness wherever a lesson uses it (e.g. 09-nack-requeue).
    for (const broker of BROKERS) {
      for (const lesson of broker.lessons) {
        const run = () => {
          const sim = broker.createSimulation({
            topology: lesson.topology,
            script: lesson.script,
            seed: 1,
          })
          sim.advanceTo(60_000)
          return sim.snapshot().journal
        }
        expect(run(), `${broker.id}/${lesson.id} replayed to a different journal from the same seed`).toEqual(
          run(),
        )
      }
    }
  })

  it('agrees with the broker catalog in both directions', () => {
    for (const entry of BROKER_CATALOG) {
      const module = BROKERS.find((b) => b.id === entry.id)
      expect(module, `catalog entry ${entry.id} has no matching module in BROKERS`).toBeDefined()
      expect(module!.label).toBe(entry.label)
      expect(module!.defaultLessonId).toBe(entry.defaultLessonId)
    }
    for (const module of BROKERS) {
      const entry = BROKER_CATALOG.find((b) => b.id === module.id)
      expect(entry, `module ${module.id} has no matching entry in BROKER_CATALOG`).toBeDefined()
      expect(entry!.label).toBe(module.label)
      expect(entry!.defaultLessonId).toBe(module.defaultLessonId)
    }
  })
})
