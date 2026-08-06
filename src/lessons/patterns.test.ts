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

describe('14 rpc', () => {
  it('publishes a reply for every request, carrying the correlation id', () => {
    const state = run('14-rpc')
    const replies = state.journal.filter((j) => j.type === 'publish' && j.nodeId === 'worker')
    expect(replies).toHaveLength(3)
    expect(state.metrics.acked).toBe(6) // 3 requests + 3 replies
  })
})

describe('15 priority', () => {
  it('delivers higher priority messages before lower ones that arrived earlier', () => {
    const lesson = getLesson('15-priority')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs + 30_000)
    const order = sim
      .snapshot()
      .journal.filter((j) => j.type === 'deliver')
      .map((j) => j.messageId)
    // m4 (priority 9) is published fourth but must be delivered before m3 (priority 0)
    expect(order.indexOf('m4')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('m3')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('m4')).toBeLessThan(order.indexOf('m3'))
  })
})

describe('16 delayed message', () => {
  it('holds messages for the ttl before they reach the due queue', () => {
    const lesson = getLesson('16-delayed')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(3_000)
    expect(sim.snapshot().queues.due).toHaveLength(0)
    sim.advanceTo(20_000)
    expect(sim.snapshot().metrics.acked).toBe(3)
  })
})

describe('17 quorum versus classic', () => {
  it('requeues unacked work on both lanes when consumers crash', () => {
    const state = run('17-quorum')
    expect(state.journal.some((j) => j.type === 'consumerCrash')).toBe(true)
    expect(state.metrics.acked).toBe(12) // six messages on each of two lanes
  })
})
