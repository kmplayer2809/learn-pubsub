import { describe, expect, it } from 'vitest'
import { createRng } from '../../../shell/kernel/rng'
import type { RedisState } from './types'

describe('RedisState', () => {
  it('satisfies KernelState and keeps its own keyspace', () => {
    const state: RedisState = {
      now: 0,
      seq: 0,
      rng: createRng(1),
      journal: [],
      topology: { clients: [], server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } } },
      keys: { 'user:1': { value: { type: 'string', value: 'alice' }, lastAccessAt: 0, hits: 0, createdAt: 0, bytes: 12 } },
      keyOrder: ['user:1'],
      metrics: { commands: 0, hits: 0, misses: 0, expired: 0, evicted: 0, keysCount: 1, memoryUsed: 12 },
      inFlight: [],
      blocked: [],
      commandCounter: 0,
    }
    expect(state.keys['user:1']!.value.type).toBe('string')
    expect(state.keyOrder).toEqual(['user:1'])
  })
})
