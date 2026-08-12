import { describe, expect, it } from 'vitest'
import { createRng } from '../../../shell/kernel/rng'
import { evictionVictims, sizeOf } from './memory'
import type { RedisState } from './types'

function stateWith(keys: Record<string, { bytes: number; expiresAt?: number; lastAccessAt: number; hits: number }>, policy: RedisState['topology']['server']['evictionPolicy'], maxmemoryBytes = 100): RedisState {
  const entries = Object.entries(keys)
  return {
    now: 1000,
    seq: 0,
    rng: createRng(7),
    journal: [],
    topology: { clients: [], server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 }, maxmemoryBytes, evictionPolicy: policy } },
    keys: Object.fromEntries(entries.map(([k, v]) => [k, { value: { type: 'string' as const, value: 'x' }, createdAt: 0, ...v }])),
    keyOrder: entries.map(([k]) => k),
    metrics: { commands: 0, hits: 0, misses: 0, expired: 0, evicted: 0, keysCount: entries.length, memoryUsed: entries.reduce((n, [, v]) => n + v.bytes, 0) },
    inFlight: [],
    blocked: [],
    commandCounter: 0,
  }
}

describe('sizeOf', () => {
  it('counts key overhead, key name, and payload', () => {
    expect(sizeOf('a', { type: 'string', value: 'hello' })).toBe(16 + 1 + 5)
  })

  it('sums every field of a hash', () => {
    expect(sizeOf('h', { type: 'hash', value: { name: 'alice', city: 'hanoi' }, fieldOrder: ['name', 'city'] })).toBe(
      16 + 1 + 4 + 5 + 4 + 5,
    )
  })

  it('adds eight bytes per zset score', () => {
    expect(sizeOf('z', { type: 'zset', value: [{ member: 'ann', score: 10 }] })).toBe(16 + 1 + 3 + 8)
  })
})

describe('evictionVictims', () => {
  it('allkeys-lru evicts the least recently accessed key first', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 900, hits: 5 }, b: { bytes: 60, lastAccessAt: 100, hits: 5 } }, 'allkeys-lru')
    expect(evictionVictims(state, 20).keys).toEqual(['b'])
  })

  it('allkeys-lfu evicts the least frequently accessed key first', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 9 }, b: { bytes: 60, lastAccessAt: 900, hits: 1 } }, 'allkeys-lfu')
    expect(evictionVictims(state, 20).keys).toEqual(['b'])
  })

  it('volatile-lru ignores keys without a TTL', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 1 }, b: { bytes: 60, lastAccessAt: 900, hits: 1, expiresAt: 5000 } }, 'volatile-lru')
    expect(evictionVictims(state, 20).keys).toEqual(['b'])
  })

  it('volatile-ttl evicts the key that dies soonest', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 1, expiresAt: 9000 }, b: { bytes: 60, lastAccessAt: 900, hits: 1, expiresAt: 2000 } }, 'volatile-ttl')
    expect(evictionVictims(state, 20).keys).toEqual(['b'])
  })

  it('reports OOM under noeviction instead of evicting', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 1 } }, 'noeviction')
    const result = evictionVictims(state, 80)
    expect(result.oom).toBe(true)
    expect(result.keys).toEqual([])
  })

  it('reports OOM when a volatile policy has no key with a TTL to sacrifice', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 1 }, b: { bytes: 60, lastAccessAt: 900, hits: 1 } }, 'volatile-lru')
    const result = evictionVictims(state, 20)
    expect(result.oom).toBe(true)
    expect(result.keys).toEqual([])
  })

  it('evicts as many keys as it takes to fit, and no more', () => {
    const state = stateWith({ a: { bytes: 40, lastAccessAt: 100, hits: 1 }, b: { bytes: 40, lastAccessAt: 200, hits: 1 }, c: { bytes: 40, lastAccessAt: 300, hits: 1 } }, 'allkeys-lru', 100)
    expect(evictionVictims(state, 60).keys).toEqual(['a', 'b'])
  })

  it('allkeys-random is deterministic for a given rng state', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 1, hits: 1 }, b: { bytes: 60, lastAccessAt: 2, hits: 1 } }, 'allkeys-random')
    expect(evictionVictims(state, 20).keys).toEqual(evictionVictims(state, 20).keys)
  })
})
