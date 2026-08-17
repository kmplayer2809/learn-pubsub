import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from '../index'
import type { RedisTopology } from '../types'

const topology: RedisTopology = {
  clients: [{ id: 'app', label: 'App', position: { x: 0, y: 0 } }, { id: 'worker', label: 'Worker', position: { x: 0, y: 100 } }],
  server: { id: 'redis', label: 'Redis', position: { x: 200, y: 50 } },
}

function run(script: { at: number; clientId: string; name: string; args: string[] }[]) {
  const sim = createRedisSimulation({ topology, script: script as never, seed: 1 })
  sim.advanceTo(10_000)
  return sim.snapshot()
}

describe('MULTI/EXEC/DISCARD/WATCH', () => {
  it('queues commands issued inside MULTI instead of running them, and replies QUEUED', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'MULTI', args: [] },
      { at: 200, clientId: 'app', name: 'SET', args: ['a', '1'] },
    ])
    const lines = state.journal.map((e) => e.text)
    // '1' renders unquoted: formatCommand's bare-integer rule (reply.ts) treats it
    // like a TTL or cursor, same convention every other command's journal line uses.
    expect(lines).toContain('SET "a" 1 → QUEUED')
    expect(state.keys['a']).toBeUndefined() // never actually ran
  })

  it('runs every queued command atomically on EXEC, in order', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'MULTI', args: [] },
      { at: 200, clientId: 'app', name: 'SET', args: ['a', '1'] },
      { at: 400, clientId: 'app', name: 'INCR', args: ['a'] },
      { at: 600, clientId: 'app', name: 'EXEC', args: [] },
    ])
    expect(state.keys['a']!.value).toEqual({ type: 'string', value: '2' })
    const execLine = state.journal.find((e) => e.text.startsWith('EXEC'))!
    expect(execLine.text).toBe('EXEC → 1) OK 2) (integer) 2')
  })

  it('aborts EXEC with a nil reply when a watched key changed since WATCH, and runs nothing', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'SET', args: ['balance', '100'] },
      { at: 200, clientId: 'app', name: 'WATCH', args: ['balance'] },
      { at: 400, clientId: 'worker', name: 'SET', args: ['balance', '999'] },
      { at: 700, clientId: 'app', name: 'MULTI', args: [] },
      { at: 900, clientId: 'app', name: 'INCR', args: ['balance'] },
      { at: 1100, clientId: 'app', name: 'EXEC', args: [] },
    ])
    const execLine = state.journal.find((e) => e.text.startsWith('EXEC'))!
    expect(execLine.text).toBe('EXEC → (nil)')
    expect(state.keys['balance']!.value).toEqual({ type: 'string', value: '999' }) // INCR never ran
  })

  it('lets EXEC through when the watched key never changed', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'SET', args: ['balance', '100'] },
      { at: 200, clientId: 'app', name: 'WATCH', args: ['balance'] },
      { at: 400, clientId: 'app', name: 'MULTI', args: [] },
      { at: 600, clientId: 'app', name: 'INCR', args: ['balance'] },
      { at: 800, clientId: 'app', name: 'EXEC', args: [] },
    ])
    expect(state.keys['balance']!.value).toEqual({ type: 'string', value: '101' })
  })

  it('errors EXEC without a matching MULTI, and DISCARD without one', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'EXEC', args: [] },
      { at: 200, clientId: 'app', name: 'DISCARD', args: [] },
    ])
    const lines = state.journal.map((e) => e.text)
    expect(lines).toEqual(['EXEC → (error) ERR EXEC without MULTI', 'DISCARD → (error) ERR DISCARD without MULTI'])
  })

  it('DISCARD drops the queue without running it', () => {
    const state = run([
      { at: 0, clientId: 'app', name: 'MULTI', args: [] },
      { at: 200, clientId: 'app', name: 'SET', args: ['a', '1'] },
      { at: 400, clientId: 'app', name: 'DISCARD', args: [] },
    ])
    expect(state.keys['a']).toBeUndefined()
  })
})
