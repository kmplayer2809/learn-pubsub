import { describe, expect, it } from 'vitest'
import { transactions } from './12-transactions'
import { lua } from './13-lua'
import { distributedLock } from './14-distributed-lock'
import { rateLimit } from './15-rate-limit'
import { createRedisSimulation } from '../engine'
import type { RedisLesson } from './types'

function run(lesson: RedisLesson) {
  return createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
}

describe('12 transactions', () => {
  it('runs the first EXEC and settles balance:1 at 102', () => {
    const sim = run(transactions)
    // EXEC is issued at 900ms; its effects land only after the 120ms command
    // travel (COMMAND_TRAVEL_MS) — the reply/state update happens at 1020, not 900.
    sim.advanceTo(1050)
    expect(sim.snapshot().keys['balance:1']!.value).toEqual({ type: 'string', value: '102' })
  })

  it('aborts the second EXEC after worker writes over the watched key, leaving worker\'s value untouched', () => {
    const sim = run(transactions)
    sim.advanceTo(transactions.durationMs)
    expect(sim.snapshot().keys['balance:1']!.value).toEqual({ type: 'string', value: '999' })
  })
})

describe('13 lua', () => {
  it('leaves seq:name at "second" after the first EVAL overwrites it', () => {
    const sim = run(lua)
    sim.advanceTo(600)
    expect(sim.snapshot().keys['seq:name']!.value).toEqual({ type: 'string', value: 'second' })
  })

  it('deletes seq:name once the compare-and-delete script finds a matching value', () => {
    const sim = run(lua)
    sim.advanceTo(lua.durationMs)
    expect(sim.snapshot().keys['seq:name']).toBeUndefined()
  })
})

describe('14 distributed lock', () => {
  it('keeps lock:job under app after worker fails to steal or unlock it', () => {
    const sim = run(distributedLock)
    sim.advanceTo(1000)
    expect(sim.snapshot().keys['lock:job']!.value).toEqual({ type: 'string', value: 'token-app' })
  })

  it('removes lock:job once app unlocks with the matching token', () => {
    const sim = run(distributedLock)
    sim.advanceTo(distributedLock.durationMs)
    expect(sim.snapshot().keys['lock:job']).toBeUndefined()
  })
})

describe('15 rate limit', () => {
  it('cuts req-0 out of the window and counts exactly the two survivors', () => {
    const sim = run(rateLimit)
    // ZCARD is issued at 1200ms; its reply lands 120ms later (COMMAND_TRAVEL_MS),
    // so the journal line only exists once we're past 1320.
    sim.advanceTo(1330)
    const line = sim.snapshot().journal.filter((e) => e.text.startsWith('ZCARD'))[0]!
    // "ratelimit:ip1" contains a colon, so formatCommand's NAMESPACED_TOKEN rule
    // leaves it unquoted, unlike a plain string argument.
    expect(line.text).toBe('ZCARD ratelimit:ip1 → (integer) 2')
  })

  it('counts three once req-3 joins and nothing new has fallen out of the window yet', () => {
    const sim = run(rateLimit)
    sim.advanceTo(rateLimit.durationMs)
    const lines = sim.snapshot().journal.filter((e) => e.text.startsWith('ZCARD'))
    expect(lines[1]!.text).toBe('ZCARD ratelimit:ip1 → (integer) 3')
  })
})
