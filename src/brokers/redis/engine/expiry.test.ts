import { describe, expect, it } from 'vitest'
import { writeKey } from './keyspace'
import { applyActiveExpire } from './expiry'
import { emptyState } from './testState'
import type { RedisState } from './types'

function withKeys(count: number, expiresAt: number): RedisState {
  let state = emptyState()
  for (let i = 0; i < count; i++) {
    state = writeKey(state, `k${i}`, { type: 'string', value: 'v' }, { expiresAt }).state
  }
  return state
}

const tick = { at: 0, seq: 0, type: 'activeExpire' as const, payload: {} }

describe('applyActiveExpire', () => {
  it('removes keys already past their deadline and counts them as expired', () => {
    const state = { ...withKeys(3, 100), now: 500 }
    const result = applyActiveExpire(state, { ...tick, at: 500 })
    expect(result.state.metrics.expired).toBe(3)
    expect(result.state.keyOrder).toEqual([])
  })

  it('leaves keys that are still alive', () => {
    const state = { ...withKeys(3, 9000), now: 500 }
    expect(applyActiveExpire(state, { ...tick, at: 500 }).state.keyOrder).toHaveLength(3)
  })

  it('samples at most ACTIVE_EXPIRE_SAMPLE keys per pass, so a big keyspace drains over several passes', () => {
    const state = { ...withKeys(50, 100), now: 500 }
    const result = applyActiveExpire(state, { ...tick, at: 500 })
    expect(result.state.metrics.expired).toBe(20)
    expect(result.state.keyOrder).toHaveLength(30)
  })

  it('schedules the next pass at the configured interval', () => {
    const base = withKeys(1, 9000)
    const state: RedisState = { ...base, now: 500, topology: { ...base.topology, server: { ...base.topology.server, activeExpireEveryMs: 250 } } }
    const [next] = applyActiveExpire(state, { ...tick, at: 500 }).newEvents
    expect(next).toMatchObject({ at: 750, type: 'activeExpire' })
  })

  it('defaults the interval to 100ms, matching Redis', () => {
    const state = { ...withKeys(1, 9000), now: 0 }
    expect(applyActiveExpire(state, tick).newEvents[0]!.at).toBe(100)
  })

  it('is deterministic: the same state expires the same keys', () => {
    const state = { ...withKeys(50, 100), now: 500 }
    const a = applyActiveExpire(state, { ...tick, at: 500 })
    const b = applyActiveExpire(state, { ...tick, at: 500 })
    expect(a.state.keyOrder).toEqual(b.state.keyOrder)
  })
})
