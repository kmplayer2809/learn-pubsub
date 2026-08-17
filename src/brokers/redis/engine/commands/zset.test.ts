import { describe, expect, it } from 'vitest'
import { writeKey } from '../keyspace'
import { emptyState } from '../testState'
import { HANDLERS } from './index'

const run = (state = emptyState(), name: string, args: string[]) =>
  HANDLERS[name as keyof typeof HANDLERS]({ state, clientId: 'c1', args, commandId: 'cmd-0' })

describe('ZADD / ZRANGE / ZREVRANGE', () => {
  it('ZADD counts only the new members, and ZRANGE orders ascending by score', () => {
    const add = run(emptyState(), 'ZADD', ['z', '10', 'ann', '20', 'bob'])
    expect(add.reply).toEqual({ kind: 'integer', value: 2 })

    const update = run(add.state, 'ZADD', ['z', '30', 'ann'])
    expect(update.reply).toEqual({ kind: 'integer', value: 0 })

    expect(run(update.state, 'ZRANGE', ['z', '0', '-1']).reply).toEqual({ kind: 'array', value: ['bob', 'ann'] })
  })

  it('ZRANGE WITHSCORES flattens member/score pairs', () => {
    const add = run(emptyState(), 'ZADD', ['z', '10', 'ann', '20', 'bob'])
    const update = run(add.state, 'ZADD', ['z', '30', 'ann'])
    expect(run(update.state, 'ZRANGE', ['z', '0', '-1', 'WITHSCORES']).reply).toEqual({
      kind: 'array',
      value: ['bob', '20', 'ann', '30'],
    })
  })

  it('ZREVRANGE orders descending by score', () => {
    const add = run(emptyState(), 'ZADD', ['z', '10', 'ann', '20', 'bob'])
    const update = run(add.state, 'ZADD', ['z', '30', 'ann'])
    expect(run(update.state, 'ZREVRANGE', ['z', '0', '0']).reply).toEqual({ kind: 'array', value: ['ann'] })
  })

  it('ties break by member string, ascending — deterministic even at equal scores', () => {
    const add = run(emptyState(), 'ZADD', ['z', '10', 'zed', '10', 'amy', '10', 'mia'])
    expect(run(add.state, 'ZRANGE', ['z', '0', '-1']).reply).toEqual({ kind: 'array', value: ['amy', 'mia', 'zed'] })
    expect(run(add.state, 'ZREVRANGE', ['z', '0', '-1']).reply).toEqual({ kind: 'array', value: ['zed', 'mia', 'amy'] })
  })

  it('ZRANGE on a missing key is an empty array', () => {
    expect(run(emptyState(), 'ZRANGE', ['nope', '0', '-1']).reply).toEqual({ kind: 'array', value: [] })
  })

  it('ZADD on a string key is WRONGTYPE', () => {
    const stringState = writeKey(emptyState(), 'z', { type: 'string', value: 'x' }).state
    expect(run(stringState, 'ZADD', ['z', '1', 'a']).reply.kind).toBe('error')
  })
})

describe('ZINCRBY / ZSCORE / ZCARD', () => {
  it('ZINCRBY adds to an existing score and returns the new score as a bulk string', () => {
    const add = run(emptyState(), 'ZADD', ['z', '20', 'bob'])
    expect(run(add.state, 'ZINCRBY', ['z', '5', 'bob']).reply).toEqual({ kind: 'bulk', value: '25' })
  })

  it('ZINCRBY creates the member at the increment when it does not exist', () => {
    expect(run(emptyState(), 'ZINCRBY', ['z', '5', 'bob']).reply).toEqual({ kind: 'bulk', value: '5' })
  })

  it('ZSCORE on a missing member is nil', () => {
    const add = run(emptyState(), 'ZADD', ['z', '10', 'ann'])
    expect(run(add.state, 'ZSCORE', ['z', 'nope']).reply).toEqual({ kind: 'nil' })
  })

  it('ZCARD on a missing key is 0', () => {
    expect(run(emptyState(), 'ZCARD', ['nope']).reply).toEqual({ kind: 'integer', value: 0 })
  })
})

describe('ZREMRANGEBYSCORE / ZCOUNT', () => {
  it('removes and counts members with score in [min, max], -inf/+inf included', () => {
    const add = run(emptyState(), 'ZADD', ['z', '1', 'a', '2', 'b', '3', 'c'])

    expect(run(add.state, 'ZCOUNT', ['z', '-inf', '2']).reply).toEqual({ kind: 'integer', value: 2 })

    const afterRemove = run(add.state, 'ZREMRANGEBYSCORE', ['z', '-inf', '1'])
    expect(afterRemove.reply).toEqual({ kind: 'integer', value: 1 })
    expect(run(afterRemove.state, 'ZCARD', ['z']).reply).toEqual({ kind: 'integer', value: 2 })
  })

  it('returns 0 for a missing key and WRONGTYPE for a non-zset key', () => {
    expect(run(emptyState(), 'ZCOUNT', ['nope', '0', '10']).reply).toEqual({ kind: 'integer', value: 0 })
    expect(run(emptyState(), 'ZREMRANGEBYSCORE', ['nope', '0', '10']).reply).toEqual({ kind: 'integer', value: 0 })

    const stringState = writeKey(emptyState(), 'z', { type: 'string', value: 'x' }).state
    expect(run(stringState, 'ZCOUNT', ['z', '0', '10']).reply.kind).toBe('error')
    expect(run(stringState, 'ZREMRANGEBYSCORE', ['z', '0', '10']).reply.kind).toBe('error')
  })
})
