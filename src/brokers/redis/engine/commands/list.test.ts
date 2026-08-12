import { describe, expect, it } from 'vitest'
import { writeKey } from '../keyspace'
import { emptyState } from '../testState'
import { HANDLERS } from './index'

const run = (state = emptyState(), name: string, args: string[]) =>
  HANDLERS[name as keyof typeof HANDLERS]({ state, clientId: 'c1', args })

describe('LPUSH / RPUSH / LRANGE', () => {
  it('LPUSH pushes onto the head, most recent first', () => {
    const first = run(emptyState(), 'LPUSH', ['l', 'a'])
    const second = run(first.state, 'LPUSH', ['l', 'b'])
    expect(run(second.state, 'LRANGE', ['l', '0', '-1']).reply).toEqual({ kind: 'array', value: ['b', 'a'] })
  })

  it('RPUSH appends onto the tail', () => {
    const first = run(emptyState(), 'LPUSH', ['l', 'a'])
    const second = run(first.state, 'LPUSH', ['l', 'b'])
    const third = run(second.state, 'RPUSH', ['l', 'c'])
    expect(run(third.state, 'LRANGE', ['l', '0', '-1']).reply).toEqual({ kind: 'array', value: ['b', 'a', 'c'] })
  })

  it('LRANGE on a missing key is an empty array', () => {
    expect(run(emptyState(), 'LRANGE', ['nope', '0', '-1']).reply).toEqual({ kind: 'array', value: [] })
  })

  it('LRANGE slices inclusively at both ends, including negative indices', () => {
    const a = run(emptyState(), 'RPUSH', ['l', 'a'])
    const b = run(a.state, 'RPUSH', ['l', 'b'])
    const c = run(b.state, 'RPUSH', ['l', 'c'])
    const d = run(c.state, 'RPUSH', ['l', 'd'])
    const e = run(d.state, 'RPUSH', ['l', 'e'])
    expect(run(e.state, 'LRANGE', ['l', '1', '-2']).reply).toEqual({ kind: 'array', value: ['b', 'c', 'd'] })
  })

  it('LRANGE with an out-of-range slice yields an empty array, not an error', () => {
    const a = run(emptyState(), 'RPUSH', ['l', 'a'])
    expect(run(a.state, 'LRANGE', ['l', '5', '10']).reply).toEqual({ kind: 'array', value: [] })
  })

  it('LPUSH on a string key is WRONGTYPE', () => {
    const stringState = writeKey(emptyState(), 'l', { type: 'string', value: 'x' }).state
    expect(run(stringState, 'LPUSH', ['l', 'a']).reply.kind).toBe('error')
  })
})

describe('LPOP / RPOP / LLEN', () => {
  it('LPOP pops the head, RPOP pops the tail', () => {
    const first = run(emptyState(), 'LPUSH', ['l', 'a'])
    const second = run(first.state, 'LPUSH', ['l', 'b'])
    const third = run(second.state, 'RPUSH', ['l', 'c'])
    // list is now ['b', 'a', 'c']
    const popped = run(third.state, 'LPOP', ['l'])
    expect(popped.reply).toEqual({ kind: 'bulk', value: 'b' })
    expect(run(popped.state, 'RPOP', ['l']).reply).toEqual({ kind: 'bulk', value: 'c' })
  })

  it('LPOP on the last element deletes the key', () => {
    const set = run(emptyState(), 'LPUSH', ['l', 'a'])
    const popped = run(set.state, 'LPOP', ['l'])
    expect(popped.state.keys['l']).toBeUndefined()
  })

  it('LPOP on a missing key is nil', () => {
    expect(run(emptyState(), 'LPOP', ['nope']).reply).toEqual({ kind: 'nil' })
  })

  it('LLEN on a missing key is 0', () => {
    expect(run(emptyState(), 'LLEN', ['nope']).reply).toEqual({ kind: 'integer', value: 0 })
  })

  it('LLEN counts the elements', () => {
    const first = run(emptyState(), 'RPUSH', ['l', 'a'])
    const second = run(first.state, 'RPUSH', ['l', 'b'])
    expect(run(second.state, 'LLEN', ['l']).reply).toEqual({ kind: 'integer', value: 2 })
  })
})

describe('BLPOP', () => {
  it('pops immediately when the list is non-empty', () => {
    const first = run(emptyState(), 'LPUSH', ['l', 'a'])
    const second = run(first.state, 'LPUSH', ['l', 'b'])
    // list is now ['b', 'a']
    const result = run(second.state, 'BLPOP', ['l', '5'])
    expect(result.reply).toEqual({ kind: 'array', value: ['l', 'b'] })
    // A completed pop is not a park: the kernel wiring must journal it and
    // animate a return flight immediately, same as any other reply.
    expect(result.parked).toBeUndefined()
  })

  it('parks the client on state.blocked when the list is empty, and replies nil', () => {
    const result = run(emptyState(), 'BLPOP', ['l', '5'])
    expect(result.reply).toEqual({ kind: 'nil' })
    expect(result.parked).toBe(true)
    expect(result.state.blocked).toHaveLength(1)
    expect(result.state.blocked[0]!.clientId).toBe('c1')
    expect(result.state.blocked[0]!.keys).toEqual(['l'])
  })

  // Regression: `keys` drops the trailing timeout (see the comment above), so
  // anything that later needs to re-journal the original command verbatim —
  // the kernel wiring's completed-BLPOP line — must read it from `args`
  // instead. This was missing until the kernel wiring task needed it.
  it('keeps the full original arguments, timeout included, on the blocked entry', () => {
    const result = run(emptyState(), 'BLPOP', ['l', '5'])
    expect(result.state.blocked[0]!.args).toEqual(['l', '5'])
  })

  it('parks the client when the named key is missing entirely', () => {
    const result = run(emptyState(), 'BLPOP', ['nope', '5'])
    expect(result.state.blocked).toHaveLength(1)
    expect(result.state.blocked[0]!.keys).toEqual(['nope'])
  })

  it('computes timeoutAt from now plus the timeout in seconds, converted to ms', () => {
    const result = run(emptyState(), 'BLPOP', ['l', '5'])
    expect(result.state.blocked[0]!.timeoutAt).toBe(5000)
  })

  it('accepts a fractional timeout, in seconds', () => {
    const result = run(emptyState(), 'BLPOP', ['l', '0.5'])
    expect(result.state.blocked[0]!.timeoutAt).toBe(500)
  })

  it('a timeout of 0 means block forever: timeoutAt is undefined', () => {
    const result = run(emptyState(), 'BLPOP', ['l', '0'])
    expect(result.state.blocked[0]!.timeoutAt).toBeUndefined()
  })

  // Malformed input is validate.ts's job to report to the script's author —
  // the engine itself must not throw over it mid-run, so it degrades to the
  // same block-forever behavior as an explicit 0.
  it('a timeout that does not parse as a number degrades to block-forever rather than throwing', () => {
    expect(() => run(emptyState(), 'BLPOP', ['l', 'not-a-number'])).not.toThrow()
    const result = run(emptyState(), 'BLPOP', ['l', 'not-a-number'])
    expect(result.state.blocked[0]!.timeoutAt).toBeUndefined()
  })

  it('a negative timeout also degrades to block-forever rather than throwing', () => {
    const result = run(emptyState(), 'BLPOP', ['l', '-5'])
    expect(result.state.blocked[0]!.timeoutAt).toBeUndefined()
  })
})
