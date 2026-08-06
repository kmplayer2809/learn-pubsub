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
  it('loses work on the auto-ack lane and recovers it on the manual lane', () => {
    const state = run('07-ack-modes')
    const autoAcks = state.journal.filter((j) => j.type === 'ack' && j.nodeId === 'auto').length
    const manualAcks = state.journal.filter((j) => j.type === 'ack' && j.nodeId === 'manual').length
    expect(manualAcks).toBeGreaterThan(autoAcks)
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
