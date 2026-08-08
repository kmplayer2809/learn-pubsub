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

  it('keeps first-in-first-out order inside one priority band', () => {
    // The cross-band claim above is only half the lesson; the narrative spends a
    // whole step on the within-band claim, and nothing asserted it. Priorities are
    // 0,0,0,9,0,5,0,9, so m1 m2 m3 m5 m7 all sit in band 0. m1 leaves before the
    // queue can reorder anything; the remaining four must be delivered in exactly
    // the order they were published.
    const lesson = getLesson('15-priority')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs + 30_000)
    const order = sim
      .snapshot()
      .journal.filter((j) => j.type === 'deliver')
      .map((j) => j.messageId)

    const band0 = ['m2', 'm3', 'm5', 'm7']
    expect(order.filter((id) => band0.includes(id!))).toEqual(band0)
    // And the whole band really does sit behind every higher-priority message.
    expect(order.indexOf('m2')).toBeGreaterThan(order.indexOf('m6')) // m6 is priority 5
  })
})

describe('16 delayed message', () => {
  it('holds every message in the delay queue for its full ttl before it reaches due', () => {
    // The old assertion was `queues.due` empty at t=3000, which is true even if TTL
    // is entirely broken as long as nothing routed there — it never asserted the
    // delay, the one thing this lesson is about.
    //
    // The arithmetic, with TRAVEL_MS = 600 and messageTtlMs = 5000: publish at 0 ->
    // route at 600 -> enqueue in delay-5s at 1200 -> ttlExpire at 6200 -> route to
    // main-ex at 6800 -> enqueue in due at 7400.
    const lesson = getLesson('16-delayed')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })

    sim.advanceTo(3_000)
    const midway = sim.snapshot()
    expect(midway.queues['delay-5s']).toHaveLength(3)
    expect(midway.journal.some((j) => j.type === 'enqueue' && j.nodeId === 'due')).toBe(false)

    sim.advanceTo(lesson.durationMs + 30_000)
    const state = sim.snapshot()
    // `due` has a consumer, so it drains as fast as it fills — the journal, not the
    // queue depth, is where the arrival times are observable.
    const arrivals = state.journal
      .filter((j) => j.type === 'enqueue' && j.nodeId === 'due')
      .map((j) => j.at)
    expect(arrivals).toEqual([7400, 7900, 8400])
    expect(state.queues['delay-5s']).toHaveLength(0)
    expect(state.metrics.expired).toBe(3)
    expect(state.metrics.acked).toBe(3)
  })
})

describe('17 quorum versus classic', () => {
  it('requeues unacked work identically on both lanes when consumers crash', () => {
    // A total of 12 acks stays green if one lane regresses and the other picks up
    // the slack, and cannot tell 12 distinct acks from 10 distinct plus 2 duplicates
    // — which is exactly what a missing crash-epoch guard produces. The lesson's
    // actual claim is that the two lanes behave identically, so assert that.
    const state = run('17-quorum')
    expect(state.journal.some((j) => j.type === 'consumerCrash')).toBe(true)

    const acksBy = (id: string) =>
      state.journal.filter((j) => j.type === 'ack' && j.nodeId === id).map((j) => j.messageId)
    const classic = acksBy('classic-consumer')
    const quorum = acksBy('quorum-consumer')

    // Every message is confirmed, and confirmed once, on each lane.
    expect(new Set(classic).size).toBe(classic.length)
    expect(new Set(quorum).size).toBe(quorum.length)
    expect(classic).toHaveLength(6)
    expect(quorum).toHaveLength(6)

    // fanout-ex copies one message to both queues, so both lanes handle the same
    // six ids. Identical sets is the claim the whole lesson rests on.
    expect([...classic].sort()).toEqual([...quorum].sort())
    expect(state.metrics.acked).toBe(12)
  })
})
