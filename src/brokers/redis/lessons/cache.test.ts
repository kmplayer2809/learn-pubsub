import { describe, expect, it } from 'vitest'
import { cacheAside } from './08-cache-aside'
import { writeThrough } from './09-write-through'
import { stampede } from './10-stampede'
import { eviction } from './11-eviction'
import { createRedisSimulation } from '../engine'

function run(lesson: { topology: Parameters<typeof createRedisSimulation>[0]['topology']; script: Parameters<typeof createRedisSimulation>[0]['script']; seed: number }) {
  return createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
}

describe('08 cache-aside', () => {
  it('counts exactly the four GETs as hits or misses, never the writes', () => {
    const sim = run(cacheAside)
    sim.advanceTo(20_000)
    const state = sim.snapshot()
    expect(state.metrics.hits).toBe(3)
    expect(state.metrics.misses).toBe(2)
  })

  it('journals the whole cache-aside round trip exactly as scripted', () => {
    const sim = run(cacheAside)
    sim.advanceTo(20_000)
    const lines = sim.snapshot().journal.map((e) => e.text)
    expect(lines).toEqual([
      'GET product:7 → (nil)',
      'SET product:7 "Bàn phím|450000" "EX" 30 → OK',
      'GET product:7 → "Bàn phím|450000"',
      'GET product:7 → "Bàn phím|450000"',
      'SET product:7 "Bàn phím|399000" "EX" 30 → OK',
      'GET product:7 → "Bàn phím|399000"',
      'DEL product:7 → (integer) 1',
      'GET product:7 → (nil)',
    ])
  })
})

describe('09 write-through và write-behind', () => {
  it('holds exactly one element in the writeback list for the window between the applied LPUSH and the applied RPOP', () => {
    const sim = run(writeThrough)

    // LPUSH at scripted `at: 6200` is applied at 6320 (COMMAND_TRAVEL_MS is 120), not
    // at 6200 itself — asserting any earlier would read an empty keyspace and pass
    // for the wrong reason.
    sim.advanceTo(6400)
    expect(sim.snapshot().keys['writeback']!.value).toEqual({ type: 'list', value: ['order:2'] })

    // Comfortably inside the window, well after the LPUSH applied and well before
    // the RPOP (scripted at 9000, applied at 9120) does.
    sim.advanceTo(8900)
    expect(sim.snapshot().keys['writeback']!.value).toEqual({ type: 'list', value: ['order:2'] })

    // One instant after the RPOP applied: the list is now empty, and an empty list
    // is deleted rather than left behind as `{ type: 'list', value: [] }`.
    sim.advanceTo(9200)
    expect(sim.snapshot().keys['writeback']).toBeUndefined()
  })

  it('serves order:2 from the cache before the database has ever seen it', () => {
    const sim = run(writeThrough)
    // GET order:2 is scripted at 7000, applied at 7120 — well after the write-behind
    // SET (applied 6120) but long before the database's own SET (scripted 9500).
    sim.advanceTo(7200)
    const journal = sim.snapshot().journal
    expect(journal[journal.length - 1]!.text).toBe('GET order:2 → "pending"')
  })
})

describe('10 cache stampede', () => {
  it('lets exactly one of three concurrent SETNX calls win the rebuild lock', () => {
    const sim = run(stampede)
    // All three SETNX replies land by 7000+120=7120, 7100+120=7220, 7200+120=7320.
    sim.advanceTo(7400)
    const lines = sim.snapshot().journal.filter((e) => e.text.startsWith('SETNX')).map((e) => e.text)
    expect(lines).toEqual([
      'SETNX lock:hot:key 1 → (integer) 1',
      'SETNX lock:hot:key 1 → (integer) 0',
      'SETNX lock:hot:key 1 → (integer) 0',
    ])
  })

  it('counts all three simultaneous readers as misses once the key has expired', () => {
    const sim = run(stampede)
    // hot:key is set with EX 4 at `at: 0` (applied 120, expiresAt 4120). The active
    // expire cycle (every 100ms) removes it by t=4200, well before any of the three
    // GETs (applied at 5120, 5220, 5320) run — so every one of them misses.
    expect(sim.snapshot().metrics.misses).toBe(0)
    sim.advanceTo(5400)
    expect(sim.snapshot().metrics.misses).toBe(3)
  })
})

describe('11 maxmemory và eviction policy', () => {
  it('refuses SET e with OOM under volatile-lru when no key carries a TTL, without touching metrics.evicted', () => {
    const sim = run(eviction)
    // SET e is scripted at 8000, applied at 8120 — after CONFIG SET switched the
    // policy to volatile-lru (scripted 7000, applied 7120) but before EXPIRE a
    // (scripted 10000) gives any key a TTL.
    sim.advanceTo(8200)
    const state = sim.snapshot()
    expect(state.metrics.evicted).toBe(1) // only `b`, evicted earlier under allkeys-lru
    const journal = state.journal
    expect(journal[journal.length - 1]!.text).toBe("SET \"e\" \"eeeeeeee\" → (error) OOM command not allowed when used memory > 'maxmemory'.")
  })

  it('accepts SET f once EXPIRE a makes a a volatile-lru candidate, evicting a', () => {
    const sim = run(eviction)
    // SET f is scripted at 11000, applied at 11120 — after EXPIRE a (scripted 10000,
    // applied 10120) gives `a` the only TTL in the keyspace.
    sim.advanceTo(11_200)
    const state = sim.snapshot()
    expect(state.keys['a']).toBeUndefined()
    expect(state.metrics.evicted).toBe(2) // `b` earlier, now `a`
    const journal = state.journal
    expect(journal[journal.length - 1]!.text).toBe('SET "f" "ffffffff" → OK')
  })

  it('pins the two KEYS * journal entries so the eviction victims are proven, not inferred', () => {
    const sim = run(eviction)
    sim.advanceTo(24_000)
    const keysLines = sim.snapshot().journal.filter((e) => e.text.startsWith('KEYS')).map((e) => e.text)
    expect(keysLines).toEqual([
      // b is gone (evicted for d under allkeys-lru): a, c, d survive.
      'KEYS "*" → 1) "a" 2) "c" 3) "d"',
      // a is gone too (evicted for f under volatile-lru, the only TTL-bearing key): c, d, f survive.
      'KEYS "*" → 1) "c" 2) "d" 3) "f"',
    ])
  })
})
