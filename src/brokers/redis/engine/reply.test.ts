import { describe, expect, it } from 'vitest'
import { formatCommand, formatReply } from './reply'

describe('formatReply', () => {
  it('renders each reply kind the way redis-cli does', () => {
    expect(formatReply({ kind: 'status', value: 'OK' })).toBe('OK')
    expect(formatReply({ kind: 'integer', value: 3 })).toBe('(integer) 3')
    expect(formatReply({ kind: 'bulk', value: 'alice' })).toBe('"alice"')
    expect(formatReply({ kind: 'nil' })).toBe('(nil)')
    expect(formatReply({ kind: 'array', value: ['a', 'b'] })).toBe('1) "a" 2) "b"')
    expect(formatReply({ kind: 'array', value: [] })).toBe('(empty array)')
    expect(formatReply({ kind: 'error', value: 'OOM command not allowed' })).toBe('(error) OOM command not allowed')
  })
})

describe('formatCommand', () => {
  it('quotes only the arguments that need it', () => {
    expect(formatCommand('SET', ['user:1', 'alice'])).toBe('SET user:1 "alice"')
    expect(formatCommand('EXPIRE', ['user:1', '60'])).toBe('EXPIRE user:1 60')
    expect(formatCommand('DBSIZE', [])).toBe('DBSIZE')
  })
})
