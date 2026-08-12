import { describe, expect, it } from 'vitest'
import { writeKey } from '../keyspace'
import { emptyState } from '../testState'
import { HANDLERS } from './index'

const run = (state = emptyState(), name: string, args: string[]) =>
  HANDLERS[name as keyof typeof HANDLERS]({ state, clientId: 'c1', args })

describe('HSET / HGET / HGETALL', () => {
  it('HSET on a missing key creates the hash and counts the new field', () => {
    const result = run(emptyState(), 'HSET', ['h', 'field', 'alice'])
    expect(result.reply).toEqual({ kind: 'integer', value: 1 })
    expect(result.state.keys['h']!.value).toEqual({ type: 'hash', value: { field: 'alice' }, fieldOrder: ['field'] })
  })

  it('HSET on an existing field updates the value and counts zero new fields', () => {
    const first = run(emptyState(), 'HSET', ['h', 'field', 'alice'])
    const second = run(first.state, 'HSET', ['h', 'field', 'bob'])
    expect(second.reply).toEqual({ kind: 'integer', value: 0 })
    expect(second.state.keys['h']!.value).toEqual({ type: 'hash', value: { field: 'bob' }, fieldOrder: ['field'] })
  })

  it('HSET with multiple field/value pairs counts every new field', () => {
    const result = run(emptyState(), 'HSET', ['h', 'a', '1', 'b', '2'])
    expect(result.reply).toEqual({ kind: 'integer', value: 2 })
  })

  it('HGET on a missing field is nil', () => {
    const set = run(emptyState(), 'HSET', ['h', 'a', '1'])
    expect(run(set.state, 'HGET', ['h', 'missing']).reply).toEqual({ kind: 'nil' })
  })

  it('HGETALL returns fields in insertion order, flattened', () => {
    const set = run(emptyState(), 'HSET', ['h', 'a', '1', 'b', '2'])
    expect(run(set.state, 'HGETALL', ['h']).reply).toEqual({ kind: 'array', value: ['a', '1', 'b', '2'] })
  })

  // Regression: `a`/`b` above are not integer-like, so they cannot fail this
  // way. Plain-object key enumeration sorts all-digit string keys ascending
  // ahead of insertion order, which is exactly the bug `fieldOrder` exists to
  // prevent — fields set "2", "0", "1" must still come back in that order.
  it('HGETALL returns all-digit field names in insertion order, not numeric order', () => {
    const first = run(emptyState(), 'HSET', ['h', '2', 'v2'])
    const second = run(first.state, 'HSET', ['h', '0', 'v0'])
    const third = run(second.state, 'HSET', ['h', '1', 'v1'])
    expect(run(third.state, 'HGETALL', ['h']).reply).toEqual({
      kind: 'array',
      value: ['2', 'v2', '0', 'v0', '1', 'v1'],
    })
  })

  it('HGETALL on a missing key is an empty array', () => {
    expect(run(emptyState(), 'HGETALL', ['nope']).reply).toEqual({ kind: 'array', value: [] })
  })

  it('HGET on a string key is WRONGTYPE', () => {
    const stringState = writeKey(emptyState(), 'h', { type: 'string', value: 'x' }).state
    expect(run(stringState, 'HGET', ['h', 'a']).reply.kind).toBe('error')
  })
})

describe('HINCRBY', () => {
  it('creates the field at the increment when it does not exist', () => {
    const result = run(emptyState(), 'HINCRBY', ['h', 'n', '5'])
    expect(result.reply).toEqual({ kind: 'integer', value: 5 })
  })

  it('adds to an existing integer field', () => {
    const set = run(emptyState(), 'HSET', ['h', 'n', '10'])
    expect(run(set.state, 'HINCRBY', ['h', 'n', '5']).reply).toEqual({ kind: 'integer', value: 15 })
  })

  it('errors on a field that is not an integer', () => {
    const set = run(emptyState(), 'HSET', ['h', 'n', 'alice'])
    expect(run(set.state, 'HINCRBY', ['h', 'n', '5']).reply).toEqual({
      kind: 'error',
      value: 'ERR hash value is not an integer',
    })
  })

  it('errors on a key holding the wrong type', () => {
    const stringState = writeKey(emptyState(), 'h', { type: 'string', value: 'x' }).state
    expect(run(stringState, 'HINCRBY', ['h', 'n', '5']).reply.kind).toBe('error')
  })
})

describe('HDEL', () => {
  it('removes the given field and counts how many actually existed', () => {
    const set = run(emptyState(), 'HSET', ['h', 'a', '1', 'b', '2'])
    const del = run(set.state, 'HDEL', ['h', 'a', 'missing'])
    expect(del.reply).toEqual({ kind: 'integer', value: 1 })
    expect(del.state.keys['h']!.value).toEqual({ type: 'hash', value: { b: '2' }, fieldOrder: ['b'] })
  })

  it('deletes the key outright once the last field is removed', () => {
    const set = run(emptyState(), 'HSET', ['h', 'a', '1'])
    const del = run(set.state, 'HDEL', ['h', 'a'])
    expect(del.reply).toEqual({ kind: 'integer', value: 1 })
    expect(del.state.keys['h']).toBeUndefined()
  })

  it('HDEL on a missing key replies 0', () => {
    expect(run(emptyState(), 'HDEL', ['nope', 'a']).reply).toEqual({ kind: 'integer', value: 0 })
  })
})

describe('fieldOrder invariant', () => {
  // fieldOrder is a second structure that has to track `value`'s keys by
  // hand — every mutating path (a brand-new HSET field, an overwriting HSET,
  // HINCRBY creating a field, HDEL removing one) has its own chance to forget
  // to touch it. Asserting the two stay in lockstep after a mixed sequence
  // catches a handler that updates `value` but not `fieldOrder` (or vice
  // versa) — a bug this same class of dual-structure invariant already
  // produced once on this branch (keys/keyOrder self-eviction). Comparing
  // sorted arrays, not `toEqual` on the array directly: Object.keys reorders
  // all-digit keys numerically, so this checks set-equality (same members,
  // no duplicates, none missing), not a specific order.
  it('contains exactly the keys of value, no duplicates, none missing, after HSET/HSET-overwrite/HINCRBY/HDEL', () => {
    const a = run(emptyState(), 'HSET', ['h', '2', 'x']) // new field "2"
    const b = run(a.state, 'HSET', ['h', '0', 'y']) // new field "0"
    const c = run(b.state, 'HSET', ['h', '2', 'z']) // overwrite "2", no new field
    const d = run(c.state, 'HINCRBY', ['h', '1', '5']) // new field "1", created by HINCRBY
    const e = run(d.state, 'HDEL', ['h', '0']) // remove "0"

    const hash = e.state.keys['h']!.value
    if (hash.type !== 'hash') throw new Error('expected a hash')
    expect([...hash.fieldOrder].sort()).toEqual(Object.keys(hash.value).sort())
    expect(new Set(hash.fieldOrder).size).toBe(hash.fieldOrder.length)
  })
})
