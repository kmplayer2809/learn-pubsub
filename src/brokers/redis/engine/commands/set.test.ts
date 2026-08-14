import { describe, expect, it } from 'vitest'
import { writeKey } from '../keyspace'
import { emptyState } from '../testState'
import { HANDLERS } from './index'

const run = (state = emptyState(), name: string, args: string[]) =>
  HANDLERS[name as keyof typeof HANDLERS]({ state, clientId: 'c1', args, commandId: 'cmd-0' })

describe('SADD / SMEMBERS / SISMEMBER / SCARD', () => {
  it('SADD counts only the new, distinct members — duplicates within one call collapse', () => {
    const result = run(emptyState(), 'SADD', ['s', 'a', 'b', 'a'])
    expect(result.reply).toEqual({ kind: 'integer', value: 2 })
  })

  it('SMEMBERS returns members in insertion order — real Redis makes no such guarantee, this engine fixes one for determinism', () => {
    const set = run(emptyState(), 'SADD', ['s', 'a', 'b'])
    expect(run(set.state, 'SMEMBERS', ['s']).reply).toEqual({ kind: 'array', value: ['a', 'b'] })
  })

  it('SISMEMBER is 1 for a present member, 0 for an absent one', () => {
    const set = run(emptyState(), 'SADD', ['s', 'a'])
    expect(run(set.state, 'SISMEMBER', ['s', 'a']).reply).toEqual({ kind: 'integer', value: 1 })
    expect(run(set.state, 'SISMEMBER', ['s', 'nope']).reply).toEqual({ kind: 'integer', value: 0 })
  })

  it('SCARD on a missing key is 0', () => {
    expect(run(emptyState(), 'SCARD', ['nope']).reply).toEqual({ kind: 'integer', value: 0 })
  })

  it('SADD on a string key is WRONGTYPE', () => {
    const stringState = writeKey(emptyState(), 's', { type: 'string', value: 'x' }).state
    expect(run(stringState, 'SADD', ['s', 'a']).reply.kind).toBe('error')
  })
})

describe('SREM', () => {
  it('removing the last member deletes the key', () => {
    const set = run(emptyState(), 'SADD', ['s', 'a'])
    const rem = run(set.state, 'SREM', ['s', 'a'])
    expect(rem.reply).toEqual({ kind: 'integer', value: 1 })
    expect(rem.state.keys['s']).toBeUndefined()
  })

  it('leaves remaining members and the key alone', () => {
    const set = run(emptyState(), 'SADD', ['s', 'a', 'b'])
    const rem = run(set.state, 'SREM', ['s', 'a'])
    expect(run(rem.state, 'SMEMBERS', ['s']).reply).toEqual({ kind: 'array', value: ['b'] })
  })
})

describe('SINTER', () => {
  it('returns members present in every set, ordered by the first set', () => {
    const s1 = run(emptyState(), 'SADD', ['s1', 'a', 'b', 'c'])
    const s2 = run(s1.state, 'SADD', ['s2', 'c', 'a'])
    expect(run(s2.state, 'SINTER', ['s1', 's2']).reply).toEqual({ kind: 'array', value: ['a', 'c'] })
  })

  it('a missing key makes the whole intersection empty', () => {
    const s1 = run(emptyState(), 'SADD', ['s1', 'a', 'b'])
    expect(run(s1.state, 'SINTER', ['s1', 'nope']).reply).toEqual({ kind: 'array', value: [] })
  })
})
