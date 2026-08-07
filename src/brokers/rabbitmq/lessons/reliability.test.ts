import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { getLesson } from './registry'

function run(id: string) {
  const lesson = getLesson(id)!
  const sim = createSimulation({
    topology: lesson.topology,
    script: lesson.script,
    failures: lesson.failures,
    seed: lesson.seed,
  })
  sim.advanceTo(lesson.durationMs + 30_000)
  return sim.snapshot()
}

describe('07 ack modes', () => {
  it('recovers the interrupted message on the manual lane and loses it on the auto lane', () => {
    const state = run('07-ack-modes')
    const acksBy = (id: string) =>
      state.journal.filter((j) => j.type === 'ack' && j.nodeId === id).map((j) => j.messageId)

    const manual = acksBy('manual')
    const auto = acksBy('auto')

    // The whole point of manual ack: every message is confirmed, and confirmed once.
    // A duplicate here means a crash failed to cancel the work it interrupted.
    expect(new Set(manual).size).toBe(manual.length)
    expect(manual.length).toBeGreaterThan(auto.length)
    // The auto lane was crashed for most of the run and cannot have confirmed
    // everything the manual lane did.
    expect(auto.length).toBeLessThan(4)
  })
})

describe('08 prefetch', () => {
  it('drains the greedy queue immediately while the fair queue holds depth', () => {
    const lesson = getLesson('08-prefetch')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(3_000)
    const state = sim.snapshot()
    expect(state.unacked.greedy!.length).toBeGreaterThan(1)
    expect(state.unacked['fair-a']!.length).toBeLessThanOrEqual(1)
  })
})

describe('09 nack and requeue', () => {
  it('redelivers rejected messages and eventually acks them all', () => {
    const state = run('09-nack-requeue')
    expect(state.metrics.nacked).toBeGreaterThan(0)
    expect(state.metrics.acked).toBe(5)
    expect(state.journal.some((j) => j.text.includes('redelivered'))).toBe(true)
  })
})

describe('10 durability and confirms', () => {
  it('confirms every publish and marks exactly one message transient', () => {
    const lesson = getLesson('10-confirms')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs + 30_000)
    const state = sim.snapshot()
    expect(state.metrics.confirmed).toBe(4)
    expect(state.metrics.acked).toBe(4)
    expect(lesson.script.filter((a) => a.persistent !== true)).toHaveLength(1)
  })
})

describe('11 dlx', () => {
  it('routes rejected messages to the dead-letter queue', () => {
    const state = run('11-dlx')
    expect(state.metrics.deadLettered).toBeGreaterThan(0)
    expect(state.journal.some((j) => j.type === 'deadLetter')).toBe(true)
  })
})

describe('12 ttl and max-length', () => {
  it('dead-letters on both overflow and expiry', () => {
    const state = run('12-ttl-maxlen')
    expect(state.journal.some((j) => j.text.includes('maxlen'))).toBe(true)
    expect(state.journal.some((j) => j.text.includes('expired'))).toBe(true)
    expect(state.metrics.expired).toBeGreaterThan(0)
  })
})

describe('13 retry with backoff', () => {
  it('sends failures through the delay queue and back to the main queue', () => {
    // The old version asserted only that more than one deadLetter happened and that
    // the run did not halt — it never checked that anything came back, which is the
    // entire retry loop the test is named after.
    const state = run('13-retry-backoff')
    expect(state.halted).toBeUndefined()

    const enqueuesIn = (queueId: string) =>
      state.journal.filter((j) => j.type === 'enqueue' && j.nodeId === queueId)

    const visits = new Map<string, number>()
    for (const entry of enqueuesIn('work')) {
      visits.set(entry.messageId!, (visits.get(entry.messageId!) ?? 0) + 1)
    }
    // Four orders are published; a message entering `work` more than once got there
    // by completing the work -> retry-ex -> retry-1s -> main-ex -> work round trip.
    const returned = [...visits.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    expect(returned.length).toBeGreaterThan(0)

    for (const id of returned) {
      // Rejected out of `work`...
      expect(
        state.journal.some(
          (j) => j.type === 'deadLetter' && j.messageId === id && j.text.includes('rejected'),
        ),
      ).toBe(true)
      // ...parked in the delay queue...
      expect(enqueuesIn('retry-1s').some((j) => j.messageId === id)).toBe(true)
      // ...and released by its TTL, not by a consumer (retry-1s has none).
      expect(
        state.journal.some(
          (j) => j.type === 'deadLetter' && j.messageId === id && j.text.includes('expired'),
        ),
      ).toBe(true)
    }

    // Every order that made it out is confirmed exactly once, and nothing is lost:
    // an order not yet acked when the window closes is still going round the loop,
    // which is the lesson's own closing point (nothing stops a retry but luck).
    const acked = state.journal.filter((j) => j.type === 'ack').map((j) => j.messageId)
    expect(new Set(acked).size).toBe(acked.length)
    expect(acked.length).toBeGreaterThanOrEqual(3)

    const published = state.journal.filter((j) => j.type === 'publish').map((j) => j.messageId)
    expect(published).toHaveLength(4)
    for (const id of published.filter((p) => !acked.includes(p))) {
      expect(returned).toContain(id)
    }
  })
})
