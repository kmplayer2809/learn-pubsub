import { describe, expect, it } from 'vitest'
import { sample, shuffle } from './shuffle'

const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

describe('shuffle', () => {
  // The point of seeding through the kernel rng rather than Math.random: the order is
  // reproducible, so a failing quiz screenshot can be reproduced from its seed.
  it('produces the same order for the same seed', () => {
    expect(shuffle(items, 42)).toEqual(shuffle(items, 42))
  })

  it('produces a different order for a different seed', () => {
    expect(shuffle(items, 42)).not.toEqual(shuffle(items, 43))
  })

  it('keeps every element exactly once', () => {
    const out = shuffle(items, 7)
    expect(out).toHaveLength(items.length)
    expect([...out].sort()).toEqual([...items].sort())
  })

  it('does not mutate the input', () => {
    const input = [...items]
    shuffle(input, 7)
    expect(input).toEqual(items)
  })

  it('handles empty and single-element inputs', () => {
    expect(shuffle([], 1)).toEqual([])
    expect(shuffle(['only'], 1)).toEqual(['only'])
  })
})

describe('sample', () => {
  it('takes the requested number of elements', () => {
    expect(sample(items, 3, 42)).toHaveLength(3)
  })

  it('takes a prefix of the shuffle for the same seed', () => {
    expect(sample(items, 3, 42)).toEqual(shuffle(items, 42).slice(0, 3))
  })

  // The exam asks for 20 questions; a broker whose bank is smaller must still produce an
  // exam rather than a padded or empty one.
  it('returns everything when count exceeds the pool', () => {
    expect(sample(items, 99, 42)).toHaveLength(items.length)
  })
})
