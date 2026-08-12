import { describe, expect, it } from 'vitest'
import { validateRedisTopology } from './validate'
import type { RedisScriptedCommand, UnvalidatedScriptedCommand } from './validate'
import type { RedisTopology } from './types'

const topology: RedisTopology = {
  clients: [{ id: 'c1', label: 'App', position: { x: 0, y: 0 } }],
  server: { id: 'redis', label: 'Redis', position: { x: 200, y: 0 } },
}

describe('validateRedisTopology', () => {
  it('is clean for a topology with a client and no memory cap', () => {
    expect(validateRedisTopology(topology, [])).toEqual([])
  })

  it('flags a scripted command whose client does not exist, as a fatal error', () => {
    const script: RedisScriptedCommand[] = [{ at: 0, clientId: 'ghost', name: 'SET', args: ['k', 'v'] }]
    const issues = validateRedisTopology(topology, script)
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'client-missing', severity: 'error', nodeId: 'ghost' }),
    )
  })

  it('flags an unknown command name as a fatal error', () => {
    // Unreachable through the type system from a typed lesson — `name` is
    // statically a `RedisCommandName` there — so this reproduces the one path
    // that actually reaches the check: the Sandbox console building a script
    // from free text a learner typed, which is exactly what
    // `UnvalidatedScriptedCommand` models (`name: string`, no cast needed).
    const script: UnvalidatedScriptedCommand[] = [{ at: 0, clientId: 'c1', name: 'FLUSHALL', args: [] }]
    const issues = validateRedisTopology(topology, script)
    expect(issues).toContainEqual(expect.objectContaining({ code: 'unknown-command', severity: 'error' }))
  })

  it('warns when the topology has no clients', () => {
    const empty: RedisTopology = { ...topology, clients: [] }
    const issues = validateRedisTopology(empty, [])
    expect(issues).toContainEqual(expect.objectContaining({ code: 'no-clients', severity: 'warning' }))
  })

  it('warns when maxmemory is set and evictionPolicy is explicitly noeviction', () => {
    const capped: RedisTopology = { ...topology, server: { ...topology.server, maxmemoryBytes: 1024, evictionPolicy: 'noeviction' } }
    const issues = validateRedisTopology(capped, [])
    expect(issues).toContainEqual(expect.objectContaining({ code: 'maxmemory-noeviction', severity: 'warning' }))
  })

  it('warns when maxmemory is set and evictionPolicy is left unset, since noeviction is the default', () => {
    const capped: RedisTopology = { ...topology, server: { ...topology.server, maxmemoryBytes: 1024 } }
    const issues = validateRedisTopology(capped, [])
    expect(issues).toContainEqual(expect.objectContaining({ code: 'maxmemory-noeviction', severity: 'warning' }))
  })

  it('does not warn about maxmemory when an actual eviction policy is set', () => {
    const capped: RedisTopology = { ...topology, server: { ...topology.server, maxmemoryBytes: 1024, evictionPolicy: 'allkeys-lru' } }
    const issues = validateRedisTopology(capped, [])
    expect(issues.some((i) => i.code === 'maxmemory-noeviction')).toBe(false)
  })

  it('reports one issue per offending scripted command, not just the first', () => {
    const script: RedisScriptedCommand[] = [
      { at: 0, clientId: 'ghost1', name: 'SET', args: ['k', 'v'] },
      { at: 100, clientId: 'ghost2', name: 'GET', args: ['k'] },
    ]
    const issues = validateRedisTopology(topology, script).filter((i) => i.code === 'client-missing')
    expect(issues).toHaveLength(2)
  })
})
