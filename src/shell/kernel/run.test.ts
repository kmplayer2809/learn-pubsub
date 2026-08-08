import { describe, expect, it } from 'vitest'
import { createRng } from './rng'
import { createKernel } from './run'
import type { KernelState, SimEvent } from './types'

type TickType = 'tick'

interface CounterState extends KernelState {
  count: number
}

function base(): CounterState {
  return { now: 0, seq: 0, rng: createRng(1), journal: [], count: 0 }
}

/** Each tick counts once and schedules the next one 10ms later, forever. */
const reducers = {
  tick: (state: CounterState, event: SimEvent<TickType>) => ({
    state: { ...state, count: state.count + 1, journal: [...state.journal, { at: event.at, type: 'tick', text: 'tick' }] },
    newEvents: [{ at: event.at + 10, seq: state.count + 1, type: 'tick' as const, payload: {} }],
  }),
}

describe('createKernel', () => {
  it('applies every event due at or before the target time', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
    })
    sim.advanceTo(25)
    expect(sim.snapshot().count).toBe(3) // 0, 10, 20
    expect(sim.snapshot().now).toBe(25)
  })

  it('stepOnce advances exactly to the next event time', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
    })
    sim.stepOnce()
    sim.stepOnce()
    expect(sim.snapshot().now).toBe(10)
    expect(sim.snapshot().count).toBe(2)
  })

  it('halts with a reason once the event ceiling is reached', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
      maxEvents: 5,
    })
    sim.advanceTo(10_000)
    expect(sim.snapshot().halted?.reason).toContain('event ceiling of 5')
    expect(sim.snapshot().count).toBe(5)
  })

  it('never dispatches when validation was fatal', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
      fatal: true,
    })
    sim.advanceTo(1000)
    expect(sim.snapshot().count).toBe(0)
  })

  it('reset returns to the seeded state and replays identically', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
    })
    sim.advanceTo(50)
    const first = sim.snapshot().count
    sim.reset()
    sim.advanceTo(50)
    expect(sim.snapshot().count).toBe(first)
  })

  it('caps the journal at MAX_JOURNAL entries', () => {
    const sim = createKernel<CounterState, TickType>({
      createState: base,
      seedEvents: () => [{ at: 0, seq: 0, type: 'tick', payload: {} }],
      reducers,
      maxEvents: 6000,
    })
    sim.advanceTo(100_000)
    expect(sim.snapshot().journal.length).toBeLessThanOrEqual(5000)
  })
})
