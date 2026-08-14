import { describe, expect, it } from 'vitest'
import { writeKey } from '../keyspace'
import { emptyState } from '../testState'
import { HANDLERS } from './index'

const run = (state = emptyState(), name: string, args: string[]) =>
  HANDLERS[name as keyof typeof HANDLERS]({ state, clientId: 'c1', args, commandId: 'cmd-0' })

describe('SET / GET', () => {
  it('SET replies OK and GET returns the value', () => {
    const set = run(emptyState(), 'SET', ['user:1', 'alice'])
    expect(set.reply).toEqual({ kind: 'status', value: 'OK' })
    expect(run(set.state, 'GET', ['user:1']).reply).toEqual({ kind: 'bulk', value: 'alice' })
  })

  it('GET on a missing key is nil, not an error', () => {
    expect(run(emptyState(), 'GET', ['nope']).reply).toEqual({ kind: 'nil' })
  })

  it('SET ... EX sets a TTL in seconds', () => {
    const set = run(emptyState(), 'SET', ['k', 'v', 'EX', '60'])
    expect(set.state.keys['k']!.expiresAt).toBe(60_000)
  })

  it('SET ... KEEPTTL preserves the existing TTL', () => {
    const first = run(emptyState(), 'SET', ['k', 'v', 'EX', '60'])
    const second = run(first.state, 'SET', ['k', 'v2', 'KEEPTTL'])
    expect(second.state.keys['k']!.expiresAt).toBe(60_000)
  })

  it('SET on a key of another type replaces it wholesale', () => {
    // LPUSH belongs to commands/list.ts, a later task in this plan — dispatching
    // through HANDLERS.LPUSH here would throw (no such handler yet). Build the
    // non-string key directly through writeKey instead; what this test actually
    // exercises is SET overwriting regardless of the existing value's type.
    const listState = writeKey(emptyState(), 'k', { type: 'list', value: ['a'] }).state
    const set = run(listState, 'SET', ['k', 'v'])
    expect(set.state.keys['k']!.value).toEqual({ type: 'string', value: 'v' })
  })

  it('SET refused for lack of memory replies with an OOM error', () => {
    const base = emptyState()
    base.topology = { ...base.topology, server: { ...base.topology.server, maxmemoryBytes: 10, evictionPolicy: 'noeviction' } }
    expect(run(base, 'SET', ['k', 'aaaaaaaaaaaa']).reply.kind).toBe('error')
  })
})

describe('INCR', () => {
  it('creates the key at 1 when it does not exist', () => {
    expect(run(emptyState(), 'INCR', ['n']).reply).toEqual({ kind: 'integer', value: 1 })
  })

  it('increments an existing integer string', () => {
    const first = run(emptyState(), 'SET', ['n', '41'])
    expect(run(first.state, 'INCR', ['n']).reply).toEqual({ kind: 'integer', value: 42 })
  })

  it('errors on a value that is not an integer', () => {
    const first = run(emptyState(), 'SET', ['n', 'alice'])
    expect(run(first.state, 'INCR', ['n']).reply).toEqual({
      kind: 'error',
      value: 'ERR value is not an integer or out of range',
    })
  })

  it('errors on a key holding the wrong type', () => {
    // See the note above: LPUSH isn't implemented until a later task.
    const listState = writeKey(emptyState(), 'n', { type: 'list', value: ['a'] }).state
    expect(run(listState, 'INCR', ['n']).reply.kind).toBe('error')
  })
})

describe('DEL / SETNX', () => {
  it('DEL returns how many keys it removed', () => {
    const set = run(emptyState(), 'SET', ['a', '1'])
    expect(run(set.state, 'DEL', ['a', 'b']).reply).toEqual({ kind: 'integer', value: 1 })
  })

  it('SETNX refuses to overwrite', () => {
    const set = run(emptyState(), 'SET', ['a', 'first'])
    const nx = run(set.state, 'SETNX', ['a', 'second'])
    expect(nx.reply).toEqual({ kind: 'integer', value: 0 })
    expect(nx.state.keys['a']!.value).toEqual({ type: 'string', value: 'first' })
  })
})
