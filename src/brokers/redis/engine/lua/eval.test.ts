import { describe, expect, it, vi } from 'vitest'
import { parse } from './parse'
import { evalProgram, LuaRuntimeError, type LuaEnv } from './eval'

function env(overrides: Partial<LuaEnv> = {}): LuaEnv {
  return { keys: [], argv: [], call: vi.fn(() => null), ...overrides }
}

describe('evalProgram', () => {
  it('returns nil (null) when the script never returns', () => {
    expect(evalProgram(parse('local x = 1'), env())).toBeNull()
  })

  it('evaluates arithmetic with standard precedence', () => {
    expect(evalProgram(parse('return 1 + 2 * 3'), env())).toBe(7)
  })

  it('resolves KEYS[n] and ARGV[n] as 1-indexed', () => {
    const result = evalProgram(parse('return KEYS[1]'), env({ keys: ['first', 'second'] }))
    expect(result).toBe('first')
  })

  it('runs redis.call through env.call and returns its Lua-side value', () => {
    const call = vi.fn(() => 'ok-value')
    const result = evalProgram(parse(`return redis.call('GET', KEYS[1])`), env({ keys: ['k'], call }))
    expect(call).toHaveBeenCalledWith('GET', ['k'])
    expect(result).toBe('ok-value')
  })

  it('takes the true branch of if/elseif/else and skips the rest', () => {
    const calls: string[] = []
    const call = vi.fn((name: string) => { calls.push(name); return null })
    evalProgram(
      parse(`
        if false then
          redis.call('A')
        elseif true then
          redis.call('B')
        else
          redis.call('C')
        end
      `),
      env({ call }),
    )
    expect(calls).toEqual(['B'])
  })

  it('runs a numeric for loop the right number of times', () => {
    const calls: string[] = []
    const call = vi.fn((_name: string, args: string[]) => { calls.push(args[0]!); return null })
    evalProgram(parse(`for i = 1, 3 do redis.call('DEL', tostringLikeIdentity) end`.replace('tostringLikeIdentity', 'ARGV[i]')), env({ argv: ['x', 'y', 'z'], call }))
    expect(calls).toEqual(['x', 'y', 'z'])
  })

  it('runs a while loop until the condition goes false', () => {
    const result = evalProgram(
      parse(`
        local n = 0
        while n < 5 do
          n = n + 1
        end
        return n
      `),
      env(),
    )
    expect(result).toBe(5)
  })

  it('short-circuits and/or', () => {
    const call = vi.fn(() => null)
    evalProgram(parse(`return false and redis.call('SHOULD_NOT_RUN')`), env({ call }))
    expect(call).not.toHaveBeenCalled()
  })

  it('throws LuaRuntimeError for an undefined variable', () => {
    expect(() => evalProgram(parse('return doesNotExist'), env())).toThrow(LuaRuntimeError)
  })

  it('lets an env.call error propagate as LuaRuntimeError via redis.call, but pcall swallows it', () => {
    const call = vi.fn(() => { throw new LuaRuntimeError('boom') })
    expect(() => evalProgram(parse(`return redis.call('X')`), env({ call }))).toThrow(LuaRuntimeError)
    expect(evalProgram(parse(`return redis.pcall('X')`), env({ call }))).toBeNull()
  })
})
