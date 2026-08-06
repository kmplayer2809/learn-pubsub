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
    const state = run('13-retry-backoff')
    const trail = state.journal.filter((j) => j.type === 'deadLetter')
    expect(trail.length).toBeGreaterThan(1)
    expect(state.halted).toBeUndefined()
  })
})
