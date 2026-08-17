// src/brokers/redis/engine/lua/lex.test.ts
import { describe, expect, it } from 'vitest'
import { lex, LuaSyntaxError } from './lex'

describe('lex', () => {
  it('tokenises numbers, strings, identifiers, and keywords', () => {
    const tokens = lex(`local x = 1 if x == "a" then return true end`)
    expect(tokens.map((t) => t.type)).toEqual([
      'local', 'ident', '=', 'number',
      'if', 'ident', '==', 'string',
      'then', 'return', 'true', 'end', 'eof',
    ])
  })

  it('reads two-character operators as single tokens', () => {
    expect(lex('a ~= b').map((t) => t.type)).toEqual(['ident', '~=', 'ident', 'eof'])
    expect(lex('a <= b').map((t) => t.type)).toEqual(['ident', '<=', 'ident', 'eof'])
  })

  it('skips -- line comments', () => {
    expect(lex('local x = 1 -- a comment\nreturn x').map((t) => t.type)).toEqual([
      'local', 'ident', '=', 'number', 'return', 'ident', 'eof',
    ])
  })

  it('indexes KEYS[1] as ident [ number ]', () => {
    expect(lex('KEYS[1]').map((t) => t.type)).toEqual(['ident', '[', 'number', ']', 'eof'])
  })

  it('throws LuaSyntaxError on an unterminated string', () => {
    expect(() => lex('local x = "abc')).toThrow(LuaSyntaxError)
  })

  it('throws LuaSyntaxError on an unrecognised character', () => {
    expect(() => lex('local x = 1 % 2')).toThrow(LuaSyntaxError)
  })
})
