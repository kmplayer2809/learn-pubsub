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
  sim.advanceTo(lesson.durationMs + 20_000)
  return sim.snapshot()
}

describe('02 direct exchange', () => {
  it('delivers each key only to its bound queues and drops the unroutable one', () => {
    const state = run('02-direct')
    expect(state.metrics.dropped).toBe(1)
    expect(state.metrics.acked).toBe(6) // 2 payment x 2 queues + 2 shipping x 1 queue
  })
})

describe('03 fanout exchange', () => {
  it('copies every message to all three queues', () => {
    const state = run('03-fanout')
    expect(state.metrics.published).toBe(3)
    expect(state.metrics.acked).toBe(9)
    expect(state.metrics.dropped).toBe(0)
  })
})

describe('04 topic exchange', () => {
  it('matches * as one word and # as zero or more', () => {
    const state = run('04-topic')
    // order.eu.created -> eu-orders, all-orders, created-only  (3)
    // order.us.created -> all-orders, created-only             (2)
    // order.eu.cancelled -> eu-orders, all-orders              (2)
    // payment.eu.created -> created-only                       (1)
    // order -> all-orders                                      (1)
    expect(state.metrics.acked).toBe(9)
    expect(state.metrics.dropped).toBe(0)
  })
})

describe('05 headers exchange', () => {
  it('honours x-match all versus any and drops an unmatched message', () => {
    // `acked > 0` was true no matter which x-match mode the exchange applied, so it
    // could not distinguish `all` from `any` — the lesson. Per-queue counts can:
    //
    //   m1 {format: pdf, kind: report} -> pdf-reports (all: both match),
    //                                     anything-pdf (any: format),
    //                                     csv-or-report (any: kind)
    //   m2 {format: pdf}              -> anything-pdf only; pdf-reports requires
    //                                    BOTH headers, so `all` must reject it
    //   m3 {format: csv}              -> csv-or-report only
    //   m4 {kind: invoice}            -> nothing, dropped
    const state = run('05-headers')
    const ackedBy = (id: string) =>
      state.journal.filter((j) => j.type === 'ack' && j.nodeId === id).map((j) => j.messageId)

    // The whole point of `all`: exactly one message carries both headers.
    expect(ackedBy('c-pdf-reports')).toEqual(['m1'])
    // `any` on a single header takes both pdf messages.
    expect(ackedBy('c-anything-pdf')).toEqual(['m1', 'm2'])
    // `any` across two criteria takes a match on either one.
    expect(ackedBy('c-csv-or-report')).toEqual(['m1', 'm3'])

    expect(state.metrics.dropped).toBe(1)
    expect(state.metrics.acked).toBe(5)
  })
})

describe('06 competing consumers', () => {
  it('splits nine messages across three consumers without duplication', () => {
    const state = run('06-competing-consumers')
    expect(state.metrics.published).toBe(9)
    expect(state.metrics.acked).toBe(9)
  })

  it('gives the fast consumer more work than the slow one', () => {
    const lesson = getLesson('06-competing-consumers')!
    const sim = createSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs + 20_000)
    const journal = sim.snapshot().journal
    const acksBy = (id: string) => journal.filter((j) => j.type === 'ack' && j.nodeId === id).length
    expect(acksBy('fast')).toBeGreaterThan(acksBy('slow'))
  })
})
