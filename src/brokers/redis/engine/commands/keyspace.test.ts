import { describe, expect, it } from 'vitest'
import { writeKey } from '../keyspace'
import { emptyState } from '../testState'
import { HANDLERS } from './index'

const run = (state: ReturnType<typeof emptyState>, name: string, args: string[]) =>
  HANDLERS[name as keyof typeof HANDLERS]({ state, clientId: 'c1', args, commandId: 'cmd-0' })

describe('EXPIRE / TTL / PERSIST', () => {
  it('EXPIRE on an existing key returns 1 and stamps the deadline', () => {
    const set = run(emptyState(), 'SET', ['k', 'v'])
    const expire = run({ ...set.state, now: 1000 }, 'EXPIRE', ['k', '30'])
    expect(expire.reply).toEqual({ kind: 'integer', value: 1 })
    expect(expire.state.keys['k']!.expiresAt).toBe(31_000)
  })

  it('EXPIRE on a missing key returns 0', () => {
    expect(run(emptyState(), 'EXPIRE', ['k', '30']).reply).toEqual({ kind: 'integer', value: 0 })
  })

  it('TTL reports remaining seconds, -1 without a TTL, -2 when the key is gone', () => {
    const set = run(emptyState(), 'SET', ['k', 'v'])
    expect(run(set.state, 'TTL', ['k']).reply).toEqual({ kind: 'integer', value: -1 })
    const expire = run(set.state, 'EXPIRE', ['k', '30'])
    expect(run({ ...expire.state, now: 10_000 }, 'TTL', ['k']).reply).toEqual({ kind: 'integer', value: 20 })
    expect(run(emptyState(), 'TTL', ['nope']).reply).toEqual({ kind: 'integer', value: -2 })
  })

  it('PERSIST removes the TTL and returns 1 only when there was one', () => {
    const set = run(emptyState(), 'SET', ['k', 'v', 'EX', '30'])
    const persisted = run(set.state, 'PERSIST', ['k'])
    expect(persisted.reply).toEqual({ kind: 'integer', value: 1 })
    expect(persisted.state.keys['k']!.expiresAt).toBeUndefined()
    expect(run(persisted.state, 'PERSIST', ['k']).reply).toEqual({ kind: 'integer', value: 0 })
  })
})

describe('SCAN / KEYS', () => {
  it('KEYS matches a glob and returns every match at once', () => {
    let state = emptyState()
    for (const k of ['user:1', 'user:2', 'session:9']) state = run(state, 'SET', [k, 'v']).state
    expect(run(state, 'KEYS', ['user:*']).reply).toEqual({ kind: 'array', value: ['user:1', 'user:2'] })
  })

  it('SCAN returns a cursor and a page, and terminates with cursor 0', () => {
    let state = emptyState()
    for (const k of ['a', 'b', 'c']) state = run(state, 'SET', [k, 'v']).state
    const first = run(state, 'SCAN', ['0', 'COUNT', '2'])
    expect(first.reply).toEqual({ kind: 'array', value: ['2', 'a', 'b'] })
    const second = run(state, 'SCAN', ['2', 'COUNT', '2'])
    expect(second.reply).toEqual({ kind: 'array', value: ['0', 'c'] })
  })

  it('SCAN skips a key that has already expired', () => {
    let state = run(emptyState(), 'SET', ['dead', 'v', 'EX', '1']).state
    state = run(state, 'SET', ['alive', 'v']).state
    const page = run({ ...state, now: 5000 }, 'SCAN', ['0', 'COUNT', '10'])
    expect(page.reply).toEqual({ kind: 'array', value: ['0', 'alive'] })
  })
})

describe('EXISTS / TYPE / DBSIZE', () => {
  it('EXISTS counts only live keys', () => {
    const set = run(emptyState(), 'SET', ['k', 'v', 'EX', '1'])
    expect(run(set.state, 'EXISTS', ['k']).reply).toEqual({ kind: 'integer', value: 1 })
    expect(run({ ...set.state, now: 5000 }, 'EXISTS', ['k']).reply).toEqual({ kind: 'integer', value: 0 })
  })

  it('TYPE names the value type, or none', () => {
    // LPUSH belongs to commands/list.ts, a later task in this plan — dispatching
    // through HANDLERS.LPUSH here would throw. Build the list key directly.
    const listState = writeKey(emptyState(), 'k', { type: 'list', value: ['a'] }).state
    expect(run(listState, 'TYPE', ['k']).reply).toEqual({ kind: 'status', value: 'list' })
    expect(run(emptyState(), 'TYPE', ['nope']).reply).toEqual({ kind: 'status', value: 'none' })
  })

  it('DBSIZE counts live keys only', () => {
    let state = run(emptyState(), 'SET', ['a', 'v']).state
    state = run(state, 'SET', ['b', 'v', 'EX', '1']).state
    expect(run({ ...state, now: 5000 }, 'DBSIZE', []).reply).toEqual({ kind: 'integer', value: 1 })
  })
})
