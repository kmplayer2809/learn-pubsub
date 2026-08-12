import { describe, expect, it } from 'vitest'
import { cacheAside } from './08-cache-aside'
import { writeThrough } from './09-write-through'
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
