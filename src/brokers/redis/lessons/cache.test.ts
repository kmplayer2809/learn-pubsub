import { describe, expect, it } from 'vitest'
import { cacheAside } from './08-cache-aside'
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
