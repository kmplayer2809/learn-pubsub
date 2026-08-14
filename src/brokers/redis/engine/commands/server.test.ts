import { describe, expect, it } from 'vitest'
import { handlers } from './server'
import { handlers as stringHandlers } from './string'
import { emptyState } from '../testState'
import type { RedisState } from '../types'

function withServer(overrides: Partial<RedisState['topology']['server']>): RedisState {
  const state = emptyState()
  return { ...state, topology: { ...state.topology, server: { ...state.topology.server, ...overrides } } }
}

describe('CONFIG', () => {
  it('SET maxmemory-policy replaces the policy the eviction path will read', () => {
    const result = handlers.CONFIG({
      state: withServer({ evictionPolicy: 'noeviction' }),
      clientId: 'c1',
      args: ['SET', 'maxmemory-policy', 'volatile-lru'],
      commandId: 'cmd-0',
    })
    expect(result.reply).toEqual({ kind: 'status', value: 'OK' })
    expect(result.state.topology.server.evictionPolicy).toBe('volatile-lru')
  })

  it('SET maxmemory replaces the byte budget', () => {
    const result = handlers.CONFIG({
      state: emptyState(),
      clientId: 'c1',
      args: ['SET', 'maxmemory', '200'],
      commandId: 'cmd-0',
    })
    expect(result.reply).toEqual({ kind: 'status', value: 'OK' })
    expect(result.state.topology.server.maxmemoryBytes).toBe(200)
  })

  it('leaves the caller\'s state untouched: the topology is replaced, not mutated', () => {
    // The whole engine is copy-on-write, and `topology` is the one part of state
    // that came in from outside the simulation — a lesson object the shell reuses
    // across runs. Mutating it here would make a second run of the same lesson
    // start with the first run's CONFIG already applied.
    const before = withServer({ evictionPolicy: 'allkeys-lru' })
    const result = handlers.CONFIG({ state: before, clientId: 'c1', args: ['SET', 'maxmemory-policy', 'volatile-ttl'], commandId: 'cmd-0' })
    expect(before.topology.server.evictionPolicy).toBe('allkeys-lru')
    expect(result.state.topology.server.evictionPolicy).toBe('volatile-ttl')
    expect(result.state.topology.server).not.toBe(before.topology.server)
  })

  it('GET maxmemory-policy reports the current policy, defaulting to noeviction', () => {
    expect(handlers.CONFIG({ state: emptyState(), clientId: 'c1', args: ['GET', 'maxmemory-policy'], commandId: 'cmd-0' }).reply).toEqual({
      kind: 'array',
      value: ['maxmemory-policy', 'noeviction'],
    })
    expect(
      handlers.CONFIG({
        state: withServer({ evictionPolicy: 'allkeys-lfu' }),
        clientId: 'c1',
        args: ['GET', 'maxmemory-policy'],
        commandId: 'cmd-0',
      }).reply,
    ).toEqual({ kind: 'array', value: ['maxmemory-policy', 'allkeys-lfu'] })
  })

  it('GET maxmemory reports 0 when no limit is set, matching real Redis', () => {
    expect(handlers.CONFIG({ state: emptyState(), clientId: 'c1', args: ['GET', 'maxmemory'], commandId: 'cmd-0' }).reply).toEqual({
      kind: 'array',
      value: ['maxmemory', '0'],
    })
  })

  it('rejects a policy name that is not a real policy, and changes nothing', () => {
    const before = withServer({ evictionPolicy: 'allkeys-lru' })
    const result = handlers.CONFIG({ state: before, clientId: 'c1', args: ['SET', 'maxmemory-policy', 'allkeys-mru'], commandId: 'cmd-0' })
    expect(result.reply.kind).toBe('error')
    expect(result.state.topology.server.evictionPolicy).toBe('allkeys-lru')
  })

  it('rejects an unknown parameter and an unknown subcommand', () => {
    expect(handlers.CONFIG({ state: emptyState(), clientId: 'c1', args: ['SET', 'appendonly', 'yes'], commandId: 'cmd-0' }).reply.kind).toBe('error')
    expect(handlers.CONFIG({ state: emptyState(), clientId: 'c1', args: ['REWRITE'], commandId: 'cmd-0' }).reply.kind).toBe('error')
  })

  it('takes effect on the very next write: switching to volatile-lru with no TTLs turns writes into OOM', () => {
    // The point of the whole command, and lesson 11's load-bearing claim. Three
    // 8-byte values under a 200-byte budget: sizeOf is `16 + key.length + payload`,
    // so `a`/`b`/`c` cost 25 each and the fourth write would reach 100 — nowhere
    // near the limit, so the budget is dropped to 60 in the same breath to force
    // the decision. Under allkeys-lru a victim exists; under volatile-lru, with
    // not one key carrying a TTL, nothing is eligible and the write must be
    // refused rather than silently succeeding over budget.
    let state = emptyState()
    for (const key of ['a', 'b', 'c']) {
      state = stringHandlers.SET({ state, clientId: 'c1', args: [key, 'vvvvvvvv'], commandId: 'cmd-0' }).state
    }
    state = handlers.CONFIG({ state, clientId: 'c1', args: ['SET', 'maxmemory', '60'], commandId: 'cmd-0' }).state
    state = handlers.CONFIG({ state, clientId: 'c1', args: ['SET', 'maxmemory-policy', 'volatile-lru'], commandId: 'cmd-0' }).state

    const refused = stringHandlers.SET({ state, clientId: 'c1', args: ['d', 'vvvvvvvv'], commandId: 'cmd-0' })
    expect(refused.reply.kind).toBe('error')
    expect(refused.state.metrics.evicted).toBe(0)

    const allowed = stringHandlers.SET({
      state: handlers.CONFIG({ state, clientId: 'c1', args: ['SET', 'maxmemory-policy', 'allkeys-lru'], commandId: 'cmd-0' }).state,
      clientId: 'c1',
      args: ['d', 'vvvvvvvv'],
      commandId: 'cmd-0',
    })
    expect(allowed.reply).toEqual({ kind: 'status', value: 'OK' })
    expect(allowed.state.metrics.evicted).toBeGreaterThan(0)
  })
})

describe('INFO', () => {
  it('reports live counters under their real Redis field names', () => {
    let state = emptyState()
    state = stringHandlers.SET({ state, clientId: 'c1', args: ['user:1', 'alice'], commandId: 'cmd-0' }).state
    state = stringHandlers.GET({ state, clientId: 'c1', args: ['user:1'], commandId: 'cmd-0' }).state
    state = stringHandlers.GET({ state, clientId: 'c1', args: ['user:2'], commandId: 'cmd-0' }).state

    const reply = handlers.INFO({ state, clientId: 'c1', args: [], commandId: 'cmd-0' }).reply
    expect(reply.kind).toBe('status')
    const text = reply.kind === 'status' ? reply.value : ''
    expect(text).toContain('keyspace_hits:1')
    expect(text).toContain('keyspace_misses:1')
    expect(text).toContain('expired_keys:0')
    expect(text).toContain('evicted_keys:0')
    expect(text).toContain(`used_memory:${state.metrics.memoryUsed}`)
    expect(text).toContain('db0:keys=1')
  })

  it('reports maxmemory 0 and the effective policy when no limit is configured', () => {
    const text = (() => {
      const reply = handlers.INFO({ state: emptyState(), clientId: 'c1', args: [], commandId: 'cmd-0' }).reply
      return reply.kind === 'status' ? reply.value : ''
    })()
    expect(text).toContain('maxmemory:0')
    expect(text).toContain('maxmemory_policy:noeviction')
  })

  it('is a pure read: it returns the same state object it was given', () => {
    const state = emptyState()
    expect(handlers.INFO({ state, clientId: 'c1', args: [], commandId: 'cmd-0' }).state).toBe(state)
  })
})
