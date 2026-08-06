import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { LESSONS, LESSON_GROUPS } from './registry'

/** Runs a lesson to completion and returns a compact, comparable journal. */
export function runLesson(id: string): string[] {
  const lesson = LESSONS.find((l) => l.id === id)
  if (!lesson) throw new Error(`unknown lesson ${id}`)
  const sim = createSimulation({
    topology: lesson.topology,
    script: lesson.script,
    failures: lesson.failures,
    seed: lesson.seed,
  })
  sim.advanceTo(lesson.durationMs + 20_000)
  return sim.snapshot().journal.map((j) => `${j.at} ${j.type} ${j.text}`)
}

describe('every lesson', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s has a valid topology', (_id, lesson) => {
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    const errors = sim.issues.filter((i) => i.severity === 'error')
    expect(errors).toEqual([])
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s runs deterministically', (id) => {
    expect(runLesson(id)).toEqual(runLesson(id))
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s confirms every publish', (_id, lesson) => {
    // Lesson 10 teaches that a confirm is the broker answering every publish, so
    // any lesson where the two counters disagree contradicts it in the metrics
    // panel. 14-rpc did: its three replies are published by a consumer rather
    // than a publisher, and the confirm hop test used to require a publisher id.
    const sim = createSimulation({
      topology: lesson.topology,
      script: lesson.script,
      failures: lesson.failures,
      seed: lesson.seed,
    })
    sim.advanceTo(lesson.durationMs + 30_000)
    const { published, confirmed } = sim.snapshot().metrics
    expect(published).toBeGreaterThan(0)
    expect(confirmed).toBe(published)
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s narrative stays inside its duration', (_id, lesson) => {
    for (const step of lesson.narrative) {
      expect(step.at).toBeLessThanOrEqual(lesson.durationMs)
    }
    for (const checkpoint of lesson.checkpoints ?? []) {
      expect(checkpoint.at).toBeLessThanOrEqual(lesson.durationMs)
      expect(checkpoint.options[checkpoint.answerIndex]).toBeTypeOf('string')
    }
  })

  // Lessons 2-17 arrive across three later tasks written by separate authors.
  // These guards exist so a malformed lesson fails here rather than silently
  // misbehaving in the UI.
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s has an ordered, non-empty narrative', (_id, lesson) => {
    expect(lesson.narrative.length).toBeGreaterThan(0)
    const times = lesson.narrative.map((s) => s.at)
    // The inspector advances through steps as virtual time crosses each `at`,
    // so an out-of-order narrative would skip or repeat explanations.
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('has no duplicate lesson ids', () => {
    // A duplicate id makes getLesson() silently return the first match and
    // collides React keys in the sidebar, showing two entries that open the
    // same lesson.
    expect([...new Set(LESSONS.map((l) => l.id))]).toHaveLength(LESSONS.length)
  })

  it('every lesson belongs to a declared group', () => {
    const known = new Set(LESSON_GROUPS.map((g) => g.id))
    for (const lesson of LESSONS) expect(known.has(lesson.group)).toBe(true)
  })
})

describe('lesson 01 hello world', () => {
  it('delivers and acks all four messages', () => {
    const sim = createSimulation({
      topology: LESSONS[0]!.topology,
      script: LESSONS[0]!.script,
      seed: LESSONS[0]!.seed,
    })
    sim.advanceTo(30_000)
    const state = sim.snapshot()
    expect(state.metrics.published).toBe(4)
    expect(state.metrics.acked).toBe(4)
    expect(state.metrics.dropped).toBe(0)
  })

  it('never holds more than one unacked message at prefetch 1', () => {
    const sim = createSimulation({
      topology: LESSONS[0]!.topology,
      script: LESSONS[0]!.script,
      seed: LESSONS[0]!.seed,
    })
    let peak = 0
    for (let t = 0; t <= 30_000; t += 100) {
      sim.advanceTo(t)
      peak = Math.max(peak, sim.snapshot().unacked.c1?.length ?? 0)
    }
    expect(peak).toBe(1)
  })

  it('golden journal: produces the expected sequence of broker events', () => {
    const journal = runLesson('01-hello-world')

    // Meaningful regression net: pin down the actual event choreography, not
    // just "a journal exists". If a later engine change reorders delivery,
    // drops an ack, or silently changes routing, this snapshot moves and CI
    // fails. Update the snapshot deliberately when the change is intended.
    expect(journal).toMatchSnapshot()

    // Belt-and-suspenders on top of the snapshot: assert the event shape a
    // human would expect from "publish 4, one at a time, prefetch 1" so the
    // test still means something even before anyone has looked at the
    // snapshot file.
    expect(journal.filter((line) => line.includes(' publish '))).toHaveLength(4)
    expect(journal.filter((line) => line.includes(' deliver '))).toHaveLength(4)
    expect(journal.filter((line) => line.includes(' ack '))).toHaveLength(4)
    expect(journal.some((line) => line.includes('m1'))).toBe(true)
    expect(journal.some((line) => line.includes('m4'))).toBe(true)

    // Ordering: the very first journal line is the first publish at t=0, and
    // the very last is the final ack, both anchoring the lesson's shape.
    expect(journal[0]).toMatch(/^0 publish /)
    expect(journal[journal.length - 1]).toMatch(/ ack /)
  })
})
