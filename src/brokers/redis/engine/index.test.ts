import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from './index'
import type { RedisTopology } from './types'

const topology: RedisTopology = {
  clients: [{ id: 'c1', label: 'App', position: { x: 40, y: 120 } }],
  server: { id: 'redis', label: 'Redis', position: { x: 320, y: 120 } },
}

const script = [
  { at: 0, clientId: 'c1', name: 'SET' as const, args: ['user:1', 'alice'] },
  { at: 500, clientId: 'c1', name: 'GET' as const, args: ['user:1'] },
]

describe('createRedisSimulation', () => {
  it('applies a command after its travel time, not at its scripted time', () => {
    const sim = createRedisSimulation({ topology, script, seed: 1 })
    sim.advanceTo(50)
    expect(sim.snapshot().keys['user:1']).toBeUndefined()
    sim.advanceTo(200)
    expect(sim.snapshot().keys['user:1']!.value).toEqual({ type: 'string', value: 'alice' })
  })

  it('animates the command out and the reply back', () => {
    const sim = createRedisSimulation({ topology, script, seed: 1 })
    sim.advanceTo(60)
    expect(sim.snapshot().inFlight.map((f) => f.edgeId)).toEqual(['c1->redis'])
    sim.advanceTo(180)
    expect(sim.snapshot().inFlight.map((f) => f.edgeId)).toEqual(['redis->c1'])
    sim.advanceTo(400)
    expect(sim.snapshot().inFlight).toEqual([])
  })

  it('journals the command and its reply as a redis-cli transcript', () => {
    const sim = createRedisSimulation({ topology, script, seed: 1 })
    sim.advanceTo(1000)
    const lines = sim.snapshot().journal.map((e) => e.text)
    expect(lines).toContain('SET user:1 "alice" → OK')
    expect(lines).toContain('GET user:1 → "alice"')
  })

  it('schedules the first active expire pass and keeps rescheduling it', () => {
    const sim = createRedisSimulation({ topology, script: [], seed: 1 })
    sim.advanceTo(1000)
    expect(sim.nextEventTime()).toBe(1100)
  })

  it('counts every command exactly once', () => {
    const sim = createRedisSimulation({ topology, script, seed: 1 })
    sim.advanceTo(2000)
    expect(sim.snapshot().metrics.commands).toBe(2)
  })

  it('is deterministic: the same seed replays the same journal', () => {
    const a = createRedisSimulation({ topology, script, seed: 3 })
    const b = createRedisSimulation({ topology, script, seed: 3 })
    a.advanceTo(5000)
    b.advanceTo(5000)
    expect(a.snapshot().journal).toEqual(b.snapshot().journal)
  })

  it('threads the seed through eviction: different seeds pick different victims', () => {
    // The same-seed case above proves replay stability, but its fixture draws
    // no randomness at all (no eviction ever fires), so it cannot show the
    // seed is actually wired in rather than just accepted and ignored. The
    // only place this engine draws from the rng is `evictionVictims`
    // (memory.ts), reached only under `allkeys-random` with a full keyspace.
    //
    // sizeOf (memory.ts) is `16 + key.length + payload`. Each key here is 2
    // chars with a 1-char value, so each costs 16 + 2 + 1 = 19 bytes. Writing
    // k1..k4 brings memoryUsed to 76 without ever tripping eviction (every
    // intermediate `over` check — memoryUsed + 19 - 80 — stays negative
    // through k4: -61, -42, -23, -4). Writing the 5th 19-byte key pushes
    // 76 + 19 - 80 = 15 over budget, which forces exactly one eviction (any
    // single 19-byte candidate frees enough to clear it). Confirmed against
    // the real engine before trusting this: seed 1 evicts k3, seed 4 evicts
    // k4 — different victims from the same script, so the seed is genuinely
    // threaded, not decorative.
    const evictingTopology: RedisTopology = {
      ...topology,
      server: { ...topology.server, maxmemoryBytes: 80, evictionPolicy: 'allkeys-random' },
    }
    const evictingScript = [
      { at: 0, clientId: 'c1', name: 'SET' as const, args: ['k1', 'v'] },
      { at: 200, clientId: 'c1', name: 'SET' as const, args: ['k2', 'v'] },
      { at: 400, clientId: 'c1', name: 'SET' as const, args: ['k3', 'v'] },
      { at: 600, clientId: 'c1', name: 'SET' as const, args: ['k4', 'v'] },
      { at: 800, clientId: 'c1', name: 'SET' as const, args: ['k5', 'v'] },
    ]
    const a = createRedisSimulation({ topology: evictingTopology, script: evictingScript, seed: 1 })
    const b = createRedisSimulation({ topology: evictingTopology, script: evictingScript, seed: 4 })
    a.advanceTo(2000)
    b.advanceTo(2000)
    const survivors = (sim: typeof a) => ['k1', 'k2', 'k3', 'k4', 'k5'].filter((k) => sim.snapshot().keys[k] !== undefined)
    expect(a.snapshot().metrics.evicted).toBe(1)
    expect(b.snapshot().metrics.evicted).toBe(1)
    expect(survivors(a)).not.toEqual(survivors(b))
  })

  it('reports a command from an unknown client as a fatal issue and never dispatches', () => {
    const sim = createRedisSimulation({
      topology,
      script: [{ at: 0, clientId: 'ghost', name: 'SET', args: ['k', 'v'] }],
      seed: 1,
    })
    expect(sim.issues.some((i) => i.code === 'client-missing' && i.severity === 'error')).toBe(true)
    sim.advanceTo(5000)
    expect(sim.snapshot().keys['k']).toBeUndefined()
  })

  it('warns when maxmemory is set with noeviction, since writes will start failing', () => {
    const sim = createRedisSimulation({
      topology: { ...topology, server: { ...topology.server, maxmemoryBytes: 64, evictionPolicy: 'noeviction' } },
      script,
      seed: 1,
    })
    expect(sim.issues.some((i) => i.code === 'maxmemory-noeviction' && i.severity === 'warning')).toBe(true)
  })

  describe('BLPOP timeout', () => {
    const withWorker: RedisTopology = {
      ...topology,
      clients: [...topology.clients, { id: 'c2', label: 'Worker', position: { x: 40, y: 260 } }],
    }

    it('wakes a BLPOP client when a push arrives, journalling exactly one line for it, not a spurious extra', () => {
      const sim = createRedisSimulation({
        topology: withWorker,
        script: [
          { at: 0, clientId: 'c2', name: 'BLPOP', args: ['jobs', '10'] },
          { at: 1000, clientId: 'c1', name: 'LPUSH', args: ['jobs', 'job-1'] },
        ],
        seed: 1,
      })
      sim.advanceTo(3000)
      expect(sim.snapshot().blocked).toEqual([])
      expect(sim.snapshot().keys['jobs']).toBeUndefined()
      // Asserting the full journal array, not `toContain`: the review found
      // the previous fixture's `toContain` never noticed a spurious extra
      // "(nil)" line journalled the instant the client parked. There must be
      // exactly one BLPOP line — the real completion — not two.
      // 'jobs' has no colon, so formatCommand's quoting heuristic (reply.ts:
      // bare integers and `a:b` tokens go unquoted, everything else is quoted)
      // quotes it on the command side, same as it would any other plain word.
      expect(sim.snapshot().journal.map((e) => e.text)).toEqual([
        'LPUSH "jobs" "job-1" → (integer) 1',
        'BLPOP "jobs" 10 → 1) "jobs" 2) "job-1"',
      ])
    })

    it('never times out with no push: still blocked at t=1000 and the journal is empty; after the deadline, one nil line, unblocked, a return flight animated', () => {
      const sim = createRedisSimulation({
        topology: withWorker,
        script: [{ at: 0, clientId: 'c2', name: 'BLPOP', args: ['jobs', '5'] }],
        seed: 1,
      })
      sim.advanceTo(1000)
      expect(sim.snapshot().blocked).toHaveLength(1)
      expect(sim.snapshot().journal).toEqual([])

      // Parked at t=120 (COMMAND_TRAVEL_MS after the scripted `at: 0`),
      // deadline 5s later: timeoutAt = 120 + 5000 = 5120.
      sim.advanceTo(5130)
      expect(sim.snapshot().blocked).toEqual([])
      expect(sim.snapshot().journal.map((e) => e.text)).toEqual(['BLPOP "jobs" 5 → (nil)'])
      expect(sim.snapshot().inFlight.map((f) => f.edgeId)).toContain('redis->c2')

      sim.advanceTo(6000)
      expect(sim.snapshot().inFlight).toEqual([])
    })

    it('a push landing at exactly the deadline wakes the client with data, not a timeout', () => {
      // BLPOP parks at t=120 with a 0.1s timeout, so its deadline is exactly
      // t=220. Scripting the LPUSH at t=100 makes its own reply (t=100+120)
      // land at that same instant — proving `applyUnblock`'s wake-before-
      // timeout ordering, not just that a push can outrace an unrelated
      // deadline.
      const sim = createRedisSimulation({
        topology: withWorker,
        script: [
          { at: 0, clientId: 'c2', name: 'BLPOP', args: ['jobs', '0.1'] },
          { at: 100, clientId: 'c1', name: 'LPUSH', args: ['jobs', 'job-1'] },
        ],
        seed: 1,
      })
      sim.advanceTo(1000)
      expect(sim.snapshot().blocked).toEqual([])
      expect(sim.snapshot().journal.map((e) => e.text)).toEqual([
        'LPUSH "jobs" "job-1" → (integer) 1',
        'BLPOP "jobs" "0.1" → 1) "jobs" 2) "job-1"',
      ])
    })

    it('BLPOP key 0 blocks forever: still parked long after any plausible deadline, no journal line', () => {
      const sim = createRedisSimulation({
        topology: withWorker,
        script: [{ at: 0, clientId: 'c2', name: 'BLPOP', args: ['jobs', '0'] }],
        seed: 1,
      })
      sim.advanceTo(100_000)
      expect(sim.snapshot().blocked).toHaveLength(1)
      expect(sim.snapshot().journal).toEqual([])
    })

    it('metrics.commands counts a BLPOP that parks and then wakes exactly once, not twice', () => {
      const sim = createRedisSimulation({
        topology: withWorker,
        script: [
          { at: 0, clientId: 'c2', name: 'BLPOP', args: ['jobs', '10'] },
          { at: 1000, clientId: 'c1', name: 'LPUSH', args: ['jobs', 'job-1'] },
        ],
        seed: 1,
      })
      sim.advanceTo(3000)
      // BLPOP + LPUSH = 2 commands scripted; BLPOP must count once (at park),
      // never a second time when applyUnblock later wakes it.
      expect(sim.snapshot().metrics.commands).toBe(2)
    })
  })

  it('advances without throwing and reports no-clients when nothing is scheduled at all', () => {
    const emptyTopology: RedisTopology = {
      clients: [],
      server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
    }
    const sim = createRedisSimulation({ topology: emptyTopology, script: [], seed: 1 })
    expect(sim.issues.some((i) => i.code === 'no-clients' && i.severity === 'warning')).toBe(true)
    expect(() => sim.advanceTo(5000)).not.toThrow()
    // no-clients is a warning, not an error, so the kernel is not fatal and
    // the active-expire heartbeat still runs — it just never finds a key to
    // remove, since nothing ever wrote one.
    expect(sim.snapshot().journal).toEqual([])
  })
})
