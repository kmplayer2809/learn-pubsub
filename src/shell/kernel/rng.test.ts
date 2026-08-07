import { describe, expect, it } from 'vitest'
import { createRng, nextFloat, nextInt } from './rng'

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    const [x] = nextFloat(a)
    const [y] = nextFloat(b)
    expect(x).toBe(y)
  })

  it('does not mutate the input state', () => {
    const rng = createRng(7)
    const before = rng.s
    nextFloat(rng)
    expect(rng.s).toBe(before)
  })

  it('advances state so successive draws differ', () => {
    let rng = createRng(1)
    const [first, r1] = nextFloat(rng)
    rng = r1
    const [second] = nextFloat(rng)
    expect(first).not.toBe(second)
  })

  it('bounds nextInt to [0, maxExclusive)', () => {
    let rng = createRng(99)
    for (let i = 0; i < 200; i++) {
      const [n, next] = nextInt(rng, 5)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(5)
      rng = next
    }
  })
})
