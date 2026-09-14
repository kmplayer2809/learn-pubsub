import { describe, expect, it } from 'vitest'
import { BROKERS } from '../../brokers/registry'

/**
 * Every lesson quizzes the reader, basic or advanced alike — that is a product rule, not a
 * per-broker choice, so it is enforced here across `BROKERS` rather than in each broker's
 * own `lessons.test.ts`. A broker added later is covered the moment it is registered.
 *
 * Three checkpoints minimum: two comprehension beats while the run is still playing, and
 * one wrap-up at `durationMs`. The wrap-up sits exactly at `durationMs` because the transport
 * halts there — `CheckpointSection` reveals a card once `now >= at`, so a later `at` would
 * be unreachable and a slightly earlier one would fire before the lesson finished.
 */
describe.each(BROKERS.map((b) => [b.id, b] as const))('%s: every lesson quizzes the reader', (
  _brokerId,
  broker,
) => {
  it.each(broker.lessons.map((l) => [l.id, l] as const))('%s', (_id, lesson) => {
    const checkpoints = lesson.checkpoints ?? []
    expect(checkpoints.length, `${lesson.id} needs two mid-run beats and a wrap-up checkpoint`)
      .toBeGreaterThanOrEqual(3)

    const last = checkpoints[checkpoints.length - 1]!
    expect(last.at, `${lesson.id} wrap-up checkpoint must land on durationMs`).toBe(
      lesson.durationMs,
    )

    // Two checkpoints sharing an `at` would surface together and read as one wall of
    // questions instead of beats spread through the run.
    const times = checkpoints.map((c) => c.at)
    expect(new Set(times).size, `${lesson.id} has checkpoints sharing an 'at'`).toBe(times.length)

    // A quiz whose options are all correct-looking duplicates teaches nothing.
    for (const cp of checkpoints) {
      expect(cp.options.length, `${lesson.id} @${cp.at} needs at least 3 options`)
        .toBeGreaterThanOrEqual(3)
      expect(new Set(cp.options).size, `${lesson.id} @${cp.at} has duplicate options`)
        .toBe(cp.options.length)
    }
  })
})
