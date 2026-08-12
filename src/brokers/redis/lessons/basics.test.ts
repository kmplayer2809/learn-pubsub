import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from '../engine'
// `livesAt` is not re-exported by the engine barrel (`engine/index.ts`) — only
// `engine/keyspace.ts` exports it directly. The engine is off-limits to edit,
// so this imports the deeper path rather than adding a re-export.
import { livesAt } from '../engine/keyspace'
import type { RedisLesson } from './types'
import { strings } from './01-strings'
import { hash } from './02-hash'
import { list } from './03-list'
import { set } from './04-set'
import { zset } from './05-zset'
import { ttl } from './06-ttl'

function run(lesson: RedisLesson, upTo: number) {
  const sim = createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
  sim.advanceTo(upTo)
  return sim.snapshot()
}

describe('01 strings', () => {
  it('counts INCR to 2 and counts exactly the one genuine miss (GET user:2), not the writes that also touch a missing key', () => {
    // keyspace_hits/misses move on the read path only (readKey's `intent`).
    // SET user:1 and both INCR page:views calls go through readKey with
    // intent 'write', so none of them count as a miss even though the first
    // SET and the first INCR each look up a key that isn't there yet. Only
    // `GET user:2` is a read against a key that never exists.
    const state = run(strings, 10_000)
    expect(state.keys['page:views']!.value).toEqual({ type: 'string', value: '2' })
    expect(state.metrics.misses).toBe(1)
  })
})

describe('02 hash', () => {
  it('keeps HGETALL in insertion order after HDEL, with the removed field gone and logins where it was created, not sorted', () => {
    // fieldOrder after HSET is ['name', 'city']; HINCRBY appends 'logins' ->
    // ['name', 'city', 'logins']; HDEL 'city' splices it out -> ['name',
    // 'logins']. HGETALL flattens fieldOrder, never Object.entries (which
    // would sort a numeric-looking field name ahead of insertion order).
    const state = run(hash, 9000)
    const lines = state.journal.map((e) => e.text)
    expect(lines[lines.length - 1]).toBe('HGETALL user:1 → 1) "name" 2) "alice" 3) "logins" 4) "1"')
  })
})

describe('03 list', () => {
  it('blocks the worker on BLPOP until a later push wakes it, then removes the empty key', () => {
    // BLPOP is scripted at 8000, applying (and, since jobs is empty by then,
    // parking) at 8000 + COMMAND_TRAVEL_MS = 8120 — well before 8500.
    const midway = run(list, 8500)
    expect(midway.blocked).toHaveLength(1)
    expect(midway.blocked[0]!.clientId).toBe('worker')

    const settled = run(list, 12_000)
    expect(settled.blocked).toEqual([])
    expect(settled.keys['jobs']).toBeUndefined()
    // Full array, not toContain: a stray extra line here (e.g. a spurious
    // nil parked-then-immediately-woken entry) would slip past a subset check.
    expect(settled.journal.map((e) => e.text)).toEqual([
      'LPUSH "jobs" "a" → (integer) 1',
      'LPUSH "jobs" "b" → (integer) 2',
      'LPUSH "jobs" "c" → (integer) 3',
      'RPOP "jobs" → "a"',
      'LPOP "jobs" → "c"',
      'LRANGE "jobs" 0 -1 → 1) "b"',
      'RPOP "jobs" → "b"',
      'LPUSH "jobs" "d" → (integer) 1',
      'BLPOP "jobs" 10 → 1) "jobs" 2) "d"',
    ])
  })
})

describe('04 set', () => {
  it('intersects online:mon and online:tue in the first set\'s insertion order, both keys colon-namespaced so unquoted', () => {
    const state = run(set, 8000)
    const lines = state.journal.map((e) => e.text)
    expect(lines).toContain('SINTER online:mon online:tue → 1) "bob" 2) "cat"')
  })
})

describe('05 zset', () => {
  it('lists ann first with score 300 in the second ZREVRANGE, after ZINCRBY overtakes bob', () => {
    const state = run(zset, 8500)
    const lines = state.journal.map((e) => e.text)
    // 'board' and 'WITHSCORES' are plain words (no colon), so formatCommand
    // quotes both; '0' and '2' are bare integers, unquoted.
    expect(lines).toContain(
      'ZREVRANGE "board" 0 2 "WITHSCORES" → 1) "ann" 2) "300" 3) "bob" 4) "250" 5) "cat" 6) "175"',
    )
  })
})

describe('06 ttl', () => {
  it('leaves an expired key present-but-dead until lazy read or the active cycle actually removes it', () => {
    // SET session:2 is scripted at 200, applies at 200 + 120 = 320, and
    // `EX 3` gives expiresAt = 320 + 3000 = 3320. At t=3500 that deadline has
    // passed, but nothing has touched the key yet (the active cycle's first
    // pass is scheduled at exactly activeExpireEveryMs = 5000, per this
    // lesson's server override), so the record is still sitting in state.
    const beforeActivePass = run(ttl, 3500)
    expect(beforeActivePass.keys['session:2']).toBeDefined()
    expect(livesAt(beforeActivePass, 'session:2', 3500)).toBe(false)

    // By 5000ms the active cycle has run once: session:1 was already removed
    // lazily by the GET at 4000 (applies 4120), and session:2 — still dead
    // and still present — is exactly what that first pass sweeps.
    const afterActivePass = run(ttl, 5000)
    expect(afterActivePass.keys['session:2']).toBeUndefined()
    expect(afterActivePass.metrics.expired).toBe(2)
  })
})
