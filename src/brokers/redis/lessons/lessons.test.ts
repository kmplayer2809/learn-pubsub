import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from '../engine'
import { LESSONS, REDIS_LESSON_GROUPS } from './registry'

describe.each(LESSONS.map((l) => [l.id, l] as const))('%s', (_id, lesson) => {
  const start = () =>
    createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })

  it('validates without a fatal issue', () => {
    expect(start().issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('runs deterministically', () => {
    const run = () => {
      const sim = start()
      sim.advanceTo(lesson.durationMs)
      return sim.snapshot().journal
    }
    expect(run()).toEqual(run())
  })

  it('replies to every command it scripts', () => {
    const sim = start()
    sim.advanceTo(lesson.durationMs)
    // Every scripted command is counted once at issue time, including one that
    // errors and including a BLPOP that parks — so a mismatch here means a
    // command never dispatched at all, not merely that it replied oddly.
    expect(sim.snapshot().metrics.commands).toBe(lesson.script.length)
  })

  it('leaves nothing animating by the time it ends', () => {
    const sim = start()
    sim.advanceTo(lesson.durationMs)
    expect(sim.snapshot().inFlight).toEqual([])
  })

  it('journals every command it scripts, with nothing left parked', () => {
    // `metrics.commands` counts a BLPOP the instant it parks, so it cannot tell a
    // lesson that resolves its blocked client from one that ends with a worker
    // still waiting — and a lesson whose last frame is a silently parked client
    // teaches the wrong thing. A command only earns its journal line once it
    // actually resolved, so demanding the full set of ids is the check
    // `metrics.commands` cannot make.
    //
    // Filtering on `messageId` rather than counting the whole journal is the
    // point: the journal also carries background lines the script did not ask
    // for — `activeExpire` when the cycle reaps a key, `evict` when a write
    // needs the room — and those legitimately outnumber the script in any
    // lesson about TTLs. Only the per-command lines carry a `cmd-N` id.
    const sim = start()
    sim.advanceTo(lesson.durationMs)
    const state = sim.snapshot()
    expect(state.blocked).toEqual([])
    //
    // Sorted, not in journal order: a BLPOP that parks resolves only once a
    // later push wakes it, so its line legitimately lands after the line of the
    // command that woke it. What matters is that every id shows up exactly
    // once — the order it shows up in is the lesson's own business.
    const replied = state.journal.map((e) => e.messageId).filter((id) => id !== undefined)
    expect(replied.toSorted()).toEqual(lesson.script.map((_, index) => `cmd-${index}`).toSorted())
  })

  it('places every narrative step and checkpoint inside the run', () => {
    for (const step of lesson.narrative) expect(step.at).toBeLessThanOrEqual(lesson.durationMs)
    for (const check of lesson.checkpoints ?? []) expect(check.at).toBeLessThanOrEqual(lesson.durationMs)
  })

  it('highlights only node ids that exist', () => {
    const ids = new Set([...lesson.topology.clients.map((c) => c.id), lesson.topology.server.id])
    for (const step of lesson.narrative) for (const id of step.highlight ?? []) expect(ids.has(id)).toBe(true)
  })

  it('scripts every command from a client the topology declares', () => {
    const ids = new Set(lesson.topology.clients.map((c) => c.id))
    for (const command of lesson.script) expect(ids.has(command.clientId)).toBe(true)
  })

  it('points every checkpoint answerIndex at a real option', () => {
    for (const check of lesson.checkpoints ?? []) {
      expect(check.answerIndex).toBeGreaterThanOrEqual(0)
      expect(check.answerIndex).toBeLessThan(check.options.length)
    }
  })

  it('files itself under a group the registry declares', () => {
    expect(REDIS_LESSON_GROUPS.map((g) => g.id)).toContain(lesson.group)
  })
})

it('ships eleven lessons with unique ids, in the order the sidebar renders them', () => {
  expect(LESSONS).toHaveLength(11)
  expect(new Set(LESSONS.map((l) => l.id)).size).toBe(11)
  expect(LESSONS.map((l) => l.id)).toEqual([
    '01-strings',
    '02-hash',
    '03-list',
    '04-set',
    '05-zset',
    '06-ttl',
    '07-scan',
    '08-cache-aside',
    '09-write-through',
    '10-stampede',
    '11-eviction',
  ])
})
