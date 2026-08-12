import { describe, expect, it } from 'vitest'
import { deleteKey, livesAt, readKey, writeKey } from './keyspace'
import { emptyState } from './testState'

describe('readKey', () => {
  it('counts a hit and refreshes the LRU stamp', () => {
    const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }).state
    const at = { ...written, now: 500 }
    const { state, record } = readKey(at, 'a', 'read')
    expect(record?.value).toEqual({ type: 'string', value: 'x' })
    expect(state.metrics.hits).toBe(1)
    expect(state.keys['a']!.lastAccessAt).toBe(500)
    expect(state.keys['a']!.hits).toBe(1)
  })

  it('counts a miss for a key that was never written', () => {
    const { state, record } = readKey(emptyState(), 'nope', 'read')
    expect(record).toBeUndefined()
    expect(state.metrics.misses).toBe(1)
  })

  it('removes an expired key lazily on read and counts it as expired, not evicted', () => {
    const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }, { expiresAt: 100 }).state
    const { state, record } = readKey({ ...written, now: 101 }, 'a', 'read')
    expect(record).toBeUndefined()
    expect(state.keys['a']).toBeUndefined()
    expect(state.keyOrder).toEqual([])
    expect(state.metrics.expired).toBe(1)
    expect(state.metrics.evicted).toBe(0)
    expect(state.metrics.misses).toBe(1)
  })

  it('keeps a key that expires exactly now — Redis expires strictly after the deadline', () => {
    const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }, { expiresAt: 100 }).state
    expect(readKey({ ...written, now: 100 }, 'a', 'read').record).toBeDefined()
  })

  describe("intent 'write'", () => {
    it('finds the same key and record a read would, without moving hits or misses', () => {
      const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }).state
      const hit = readKey({ ...written, now: 500 }, 'a', 'write')
      expect(hit.record?.value).toEqual({ type: 'string', value: 'x' })
      expect(hit.state.metrics.hits).toBe(0)

      const miss = readKey(written, 'nope', 'write')
      expect(miss.record).toBeUndefined()
      expect(miss.state.metrics.misses).toBe(0)
    })

    it('still refreshes the LRU stamp and the LFU counter, because eviction must see a write as an access', () => {
      // If a write did not count as an access, `allkeys-lru` would treat the
      // key just written as the coldest in the keyspace and evict it first —
      // which is the opposite of what the eviction lesson demonstrates.
      const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }).state
      const { state } = readKey({ ...written, now: 500 }, 'a', 'write')
      expect(state.keys['a']!.lastAccessAt).toBe(500)
      expect(state.keys['a']!.hits).toBe(1)
    })

    it('still expires a dead key and still counts it expired — only the miss is withheld', () => {
      const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }, { expiresAt: 100 }).state
      const { state, record } = readKey({ ...written, now: 101 }, 'a', 'write')
      expect(record).toBeUndefined()
      expect(state.keys['a']).toBeUndefined()
      expect(state.keyOrder).toEqual([])
      expect(state.metrics.expired).toBe(1)
      expect(state.metrics.misses).toBe(0)
    })

    it('returns the caller\'s own state object on a plain miss, allocating nothing', () => {
      const state = emptyState()
      expect(readKey(state, 'nope', 'write').state).toBe(state)
    })
  })
})

describe('writeKey', () => {
  it('appends to keyOrder once and keeps position on overwrite', () => {
    let state = writeKey(emptyState(), 'a', { type: 'string', value: '1' }).state
    state = writeKey(state, 'b', { type: 'string', value: '2' }).state
    state = writeKey(state, 'a', { type: 'string', value: '3' }).state
    expect(state.keyOrder).toEqual(['a', 'b'])
  })

  it('drops the TTL on overwrite unless keepTtl is set', () => {
    let state = writeKey(emptyState(), 'a', { type: 'string', value: '1' }, { expiresAt: 500 }).state
    state = writeKey(state, 'a', { type: 'string', value: '2' }).state
    expect(state.keys['a']!.expiresAt).toBeUndefined()

    let kept = writeKey(emptyState(), 'b', { type: 'string', value: '1' }, { expiresAt: 500 }).state
    kept = writeKey(kept, 'b', { type: 'string', value: '2' }, { keepTtl: true }).state
    expect(kept.keys['b']!.expiresAt).toBe(500)
  })

  it('tracks memoryUsed and keysCount', () => {
    const { state } = writeKey(emptyState(), 'a', { type: 'string', value: 'hello' })
    expect(state.metrics.keysCount).toBe(1)
    expect(state.metrics.memoryUsed).toBe(16 + 1 + 5)
  })

  it('evicts to make room and reports which keys went', () => {
    // sizeOf('old', 10 a's) === sizeOf('new', 10 b's) === 29 bytes (16 + 3-char
    // key + 10-char value). A budget of 60 lets both fit (29 + 29 = 58 <= 60)
    // per evictionVictims' `memoryUsed + needBytes - budget` check, so no
    // eviction would occur — the brief's original 60 does not exercise this
    // path against Task 2's actual memory.ts formula. 40 genuinely forces it
    // (29 + 29 - 40 = 18 > 0, and evicting 'old' frees 29 >= 18).
    let state = { ...emptyState() }
    state.topology = { ...state.topology, server: { ...state.topology.server, maxmemoryBytes: 40, evictionPolicy: 'allkeys-lru' } }
    state = writeKey(state, 'old', { type: 'string', value: 'aaaaaaaaaa' }).state
    const result = writeKey({ ...state, now: 100 }, 'new', { type: 'string', value: 'bbbbbbbbbb' })
    expect(result.evicted).toEqual(['old'])
    expect(result.oom).toBe(false)
    expect(result.state.keys['new']).toBeDefined()
    expect(result.state.metrics.evicted).toBe(1)
  })

  // Regression: growing an existing key past the budget must never let
  // eviction pick that same key as its own victim. `old` is written first
  // (so it has the stalest LRU stamp), then grown enough to force eviction —
  // a naive implementation ranks `old` as the worst-case candidate and
  // "evicts" itself, then re-adds it via the write, leaving it present in
  // `keys` but missing from `keyOrder` (the sync bug the engine's
  // determinism depends on never happening).
  it('never evicts the key it is currently writing, and keeps keys/keyOrder in sync', () => {
    let state = { ...emptyState() }
    state.topology = { ...state.topology, server: { ...state.topology.server, maxmemoryBytes: 100, evictionPolicy: 'allkeys-lru' } }
    state = writeKey(state, 'old', { type: 'string', value: 'a'.repeat(19) }).state
    state = writeKey({ ...state, now: 10 }, 'a', { type: 'string', value: 'bb' }).state
    const result = writeKey({ ...state, now: 20 }, 'old', { type: 'string', value: 'c'.repeat(70) })
    expect(result.evicted).toEqual(['a'])
    expect(result.oom).toBe(false)
    expect(Object.keys(result.state.keys)).toEqual(result.state.keyOrder)
    expect(result.state.keys['old']).toBeDefined()
    expect(result.state.keyOrder).toEqual(['old'])
  })

  it('refuses the write under noeviction and leaves the keyspace untouched', () => {
    let state = { ...emptyState() }
    state.topology = { ...state.topology, server: { ...state.topology.server, maxmemoryBytes: 40, evictionPolicy: 'noeviction' } }
    state = writeKey(state, 'old', { type: 'string', value: 'aaaaaaaaaa' }).state
    const result = writeKey(state, 'new', { type: 'string', value: 'bbbbbbbbbb' })
    expect(result.oom).toBe(true)
    expect(result.state.keys['new']).toBeUndefined()
    expect(result.state.keys['old']).toBeDefined()
  })
})

describe('deleteKey', () => {
  it('removes the key from both the map and the order, and frees its bytes', () => {
    const written = writeKey(emptyState(), 'a', { type: 'string', value: 'hello' }).state
    const { state, existed } = deleteKey(written, 'a')
    expect(existed).toBe(true)
    expect(state.keyOrder).toEqual([])
    expect(state.metrics.memoryUsed).toBe(0)
    expect(state.metrics.keysCount).toBe(0)
  })

  it('reports a delete of a missing key without touching metrics', () => {
    const { state, existed } = deleteKey(emptyState(), 'nope')
    expect(existed).toBe(false)
    expect(state.metrics.expired).toBe(0)
  })
})

describe('livesAt', () => {
  it('does not count a hit or a miss', () => {
    const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }).state
    expect(livesAt(written, 'a', 0)).toBe(true)
    expect(written.metrics.hits).toBe(0)
  })
})
