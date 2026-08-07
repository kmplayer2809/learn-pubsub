import { describe, expect, it } from 'vitest'
import { createRng } from './rng'
import type { InFlight, KernelState } from './types'

describe('kernel types', () => {
  it('lets a broker state satisfy KernelState while adding its own fields', () => {
    interface MyState extends KernelState {
      keys: string[]
    }
    const state: MyState = {
      now: 0,
      seq: 0,
      rng: createRng(1),
      journal: [{ at: 0, type: 'command', text: 'SET a 1 -> OK' }],
      keys: ['a'],
    }
    expect(state.journal[0]!.text).toBe('SET a 1 -> OK')
  })

  it('describes a flight without naming any broker concept', () => {
    const flight: InFlight = {
      message: { id: 'm1', solid: true },
      edgeId: 'a->b',
      fromT: 0,
      toT: 100,
      tone: 'sky',
    }
    expect(flight.message.label ?? flight.message.id).toBe('m1')
  })
})
