import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from '../index'
import type { RedisTopology } from '../types'

const topology: RedisTopology = {
  clients: [{ id: 'app', label: 'App', position: { x: 0, y: 0 } }],
  server: { id: 'redis', label: 'Redis', position: { x: 200, y: 50 } },
}

function run(script: { at: number; clientId: string; name: string; args: string[] }[]) {
  const sim = createRedisSimulation({ topology, script: script as never, seed: 1 })
  sim.advanceTo(10_000)
  return sim.snapshot()
}

describe('EVAL', () => {
  it('runs redis.call writes and reads through the real HANDLERS table', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'EVAL', args: [`redis.call('SET', KEYS[1], ARGV[1]) return redis.call('GET', KEYS[1])`, '1', 'k', 'v'] },
    ])
    expect(state.keys['k']!.value).toEqual({ type: 'string', value: 'v' })
    const line = state.journal.find((e) => e.text.startsWith('EVAL'))!
    expect(line.text).toContain('"v"')
  })

  it('is atomic: no other scripted command can observe a partial script', () => {
    // Two clients would be needed to prove interleaving is impossible at the
    // kernel level; this proves the weaker but load-bearing fact that a
    // multi-call script's effects all land together in one journal entry
    // rather than as separate per-call entries.
    const state = run([
      { at: 0, clientId: 'app', name: 'EVAL', args: [`redis.call('SET', 'a', '1') redis.call('SET', 'b', '2') return 'done'`, '0'] },
    ])
    expect(state.keys['a']!.value).toEqual({ type: 'string', value: '1' })
    expect(state.keys['b']!.value).toEqual({ type: 'string', value: '2' })
    // `.startsWith` rather than `.includes`: the EVAL line's own text embeds the raw
    // script source (which itself contains the substring "SET"), so `.includes('SET')`
    // would false-positive on the EVAL line itself. `.startsWith('SET')` correctly
    // targets "a separate SET command line" the way `.startsWith('EVAL')` targets the EVAL line above.
    expect(state.journal.filter((e) => e.text.startsWith('SET'))).toHaveLength(0) // no separate SET lines — only the one EVAL line
  })

  it('replies with a compiler error for a syntax error, and does not change state', () => {
    const state = run([{ at: 0, clientId: 'app', name: 'EVAL', args: [`if a ==`, '0'] }])
    const line = state.journal.find((e) => e.text.startsWith('EVAL'))!
    expect(line.text).toContain('(error) ERR Error compiling script')
    expect(state.keys).toEqual({})
  })

  it('replies with a runtime error and keeps whatever ran before the failing call', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'EVAL', args: [`redis.call('SET', 'a', '1') return redis.call('NOTACOMMAND')`, '0'] },
    ])
    expect(state.keys['a']!.value).toEqual({ type: 'string', value: '1' })
    const line = state.journal.find((e) => e.text.startsWith('EVAL'))!
    expect(line.text).toContain('(error) ERR')
  })

  it('implements the compare-and-delete unlock pattern used by the distributed-lock lesson', () => {
    const unlockScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`
    const state = run([
      { at: 0, clientId: 'app', name: 'SET', args: ['lock:x', 'token-a', 'NX'] },
      { at: 200, clientId: 'app', name: 'EVAL', args: [unlockScript, '1', 'lock:x', 'token-b'] }, // wrong token: refused
      { at: 400, clientId: 'app', name: 'EVAL', args: [unlockScript, '1', 'lock:x', 'token-a'] }, // right token: deletes
    ])
    expect(state.keys['lock:x']).toBeUndefined()
    const lines = state.journal.filter((e) => e.text.startsWith('EVAL')).map((e) => e.text)
    expect(lines[0]).toContain('(integer) 0')
    expect(lines[1]).toContain('(integer) 1')
  })
})
