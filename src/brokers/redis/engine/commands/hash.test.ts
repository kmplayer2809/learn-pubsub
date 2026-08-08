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
    expect(result.state.keys['h']!.value).toEqual({ type: 'hash', value: { field: 'alice' } })
  })

  it('HSET on an existing field updates the value and counts zero new fields', () => {
    const first = run(emptyState(), 'HSET', ['h', 'field', 'alice'])
    const second = run(first.state, 'HSET', ['h', 'field', 'bob'])
    expect(second.reply).toEqual({ kind: 'integer', value: 0 })
    expect(second.state.keys['h']!.value).toEqual({ type: 'hash', value: { field: 'bob' } })
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
    expect(del.state.keys['h']!.value).toEqual({ type: 'hash', value: { b: '2' } })
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
