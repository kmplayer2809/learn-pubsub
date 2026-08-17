import { describe, expect, it } from 'vitest'
import { parse } from './parse'
import { LuaSyntaxError } from './lex'

describe('parse', () => {
  it('parses a local declaration and a return', () => {
    expect(parse('local x = 1 return x')).toEqual([
      { kind: 'local', name: 'x', expr: { kind: 'number', value: 1 } },
      { kind: 'return', expr: { kind: 'var', name: 'x' } },
    ])
  })

  it('parses redis.call as a field access wrapped in a call', () => {
    const [stmt] = parse(`return redis.call('GET', KEYS[1])`)
    expect(stmt).toEqual({
      kind: 'return',
      expr: {
        kind: 'call',
        callee: { kind: 'field', target: { kind: 'var', name: 'redis' }, name: 'call' },
        args: [
          { kind: 'string', value: 'GET' },
          { kind: 'index', target: { kind: 'var', name: 'KEYS' }, index: { kind: 'number', value: 1 } },
        ],
      },
    })
  })

  it('parses if/elseif/else/end', () => {
    const program = parse(`
      if a == b then
        return 1
      elseif a == c then
        return 2
      else
        return 0
      end
    `)
    expect(program).toHaveLength(1)
    expect(program[0]!.kind).toBe('if')
  })

  it('parses a numeric for loop and a while loop', () => {
    const program = parse(`
      for i = 1, 3 do
        redis.call('DEL', ARGV[i])
      end
      local n = 0
      while n < 3 do
        n = n + 1
      end
    `)
    expect(program[0]!.kind).toBe('forNumeric')
    expect(program[2]!.kind).toBe('while')
  })

  it('respects and/or/comparison/additive/multiplicative precedence', () => {
    const [stmt] = parse('return 1 + 2 * 3 == 7 and true or false')
    // ((1 + (2 * 3)) == 7) and true or false — top node is `or`
    expect(stmt).toEqual({ kind: 'return', expr: expect.objectContaining({ kind: 'binary', op: 'or' }) })
  })

  it('throws LuaSyntaxError on a malformed if with no end', () => {
    expect(() => parse('if a == b then return 1')).toThrow(LuaSyntaxError)
  })
})
