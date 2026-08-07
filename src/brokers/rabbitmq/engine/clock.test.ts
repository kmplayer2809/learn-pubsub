import { describe, expect, it } from 'vitest'
import { createScheduler, peekTime, popDue, push, pushAll } from './clock'
import type { SimEvent } from './types'

const ev = (at: number, seq: number, type: SimEvent['type'] = 'publish'): SimEvent => ({
  at,
  seq,
  type,
  payload: {},
})

describe('scheduler', () => {
  it('returns undefined time when empty', () => {
    expect(peekTime(createScheduler())).toBeUndefined()
  })

  it('pops events in time order regardless of insertion order', () => {
    let s = createScheduler()
    s = push(s, ev(300, 1))
    s = push(s, ev(100, 2))
    s = push(s, ev(200, 3))
    const [due] = popDue(s, 1000)
    expect(due.map((e) => e.at)).toEqual([100, 200, 300])
  })

  it('breaks ties by seq so equal timestamps stay deterministic', () => {
    let s = createScheduler()
    s = push(s, ev(100, 9))
    s = push(s, ev(100, 2))
    s = push(s, ev(100, 5))
    const [due] = popDue(s, 100)
    expect(due.map((e) => e.seq)).toEqual([2, 5, 9])
  })

  it('leaves future events in the scheduler', () => {
    let s = createScheduler()
    s = push(s, ev(100, 1))
    s = push(s, ev(500, 2))
    const [due, rest] = popDue(s, 100)
    expect(due).toHaveLength(1)
    expect(peekTime(rest)).toBe(500)
  })

  it('does not mutate the scheduler it is given', () => {
    const s = createScheduler()
    const pushed = push(s, ev(10, 1))
    expect(peekTime(s)).toBeUndefined()
    expect(peekTime(pushed)).toBe(10)
  })

  it('pushAll keeps ordering across a batch pushed at once', () => {
    const s = pushAll(createScheduler(), [ev(300, 1), ev(100, 2), ev(300, 0), ev(200, 3)])
    const [due] = popDue(s, 1000)
    expect(due.map((e) => [e.at, e.seq])).toEqual([
      [100, 2],
      [200, 3],
      [300, 0],
      [300, 1],
    ])
  })

  it('pushAll on an empty batch returns an equivalent scheduler', () => {
    const s = pushAll(createScheduler(), [ev(50, 1)])
    expect(peekTime(pushAll(s, []))).toBe(50)
  })
})
