import { evictionVictims, sizeOf } from './memory'
import type { KeyRecord, RedisState, RedisValue } from './types'

/**
 * True when `key` exists and is not past its expiry, as of `now`. Does not
 * mutate state or touch hit/miss metrics — callers that need the side
 * effects of an actual access should go through `readKey` instead.
 *
 * Strictly `>=`: Redis expires a key *after* its deadline, so a key whose
 * `expiresAt` equals `now` is still alive for this one virtual millisecond.
 */
export function livesAt(state: RedisState, key: string, now: number): boolean {
  const record = state.keys[key]
  return Boolean(record) && (record!.expiresAt === undefined || record!.expiresAt >= now)
}

/**
 * Reads a key, removing it first if it is past its expiry (lazy expiry: the
 * only other place a key dies is the periodic active-expire cycle, modelled
 * separately so the gap between the two is visible to a learner). Counts a
 * hit or a miss, and on a genuine hit refreshes the LRU stamp and bumps the
 * LFU counter used by eviction.
 */
export function readKey(state: RedisState, key: string): { state: RedisState; record?: KeyRecord } {
  const record = state.keys[key]
  if (!record) {
    return { state: { ...state, metrics: { ...state.metrics, misses: state.metrics.misses + 1 } }, record: undefined }
  }

  if (record.expiresAt !== undefined && record.expiresAt < state.now) {
    // Past the deadline: remove it here rather than waiting for the active
    // cycle, and count it as expired — not evicted, which is a distinct
    // reason a key can vanish and the metrics keep them apart.
    const nextKeys = { ...state.keys }
    delete nextKeys[key]
    const nextState: RedisState = {
      ...state,
      keys: nextKeys,
      keyOrder: state.keyOrder.filter((k) => k !== key),
      metrics: {
        ...state.metrics,
        expired: state.metrics.expired + 1,
        misses: state.metrics.misses + 1,
        keysCount: state.metrics.keysCount - 1,
        memoryUsed: state.metrics.memoryUsed - record.bytes,
      },
    }
    return { state: nextState, record: undefined }
  }

  const updatedRecord: KeyRecord = { ...record, lastAccessAt: state.now, hits: record.hits + 1 }
  const nextState: RedisState = {
    ...state,
    keys: { ...state.keys, [key]: updatedRecord },
    metrics: { ...state.metrics, hits: state.metrics.hits + 1 },
  }
  return { state: nextState, record: updatedRecord }
}

/**
 * Writes a key, recomputing its byte size and evicting other keys if the
 * write would exceed `maxmemoryBytes`. `oom` means the write was refused
 * (`noeviction`, or eviction could not free enough room) — in that case the
 * returned state is the input state, untouched.
 */
export function writeKey(
  state: RedisState,
  key: string,
  value: RedisValue,
  opts?: { keepTtl?: boolean; expiresAt?: number },
): { state: RedisState; oom: boolean; evicted: string[] } {
  const existing = state.keys[key]
  const bytes = sizeOf(key, value)
  const delta = bytes - (existing?.bytes ?? 0)

  let working = state
  const evicted: string[] = []

  if (delta > 0) {
    // Exclude `key` itself from the candidates evictionVictims sees. Without
    // this, growing an existing key past the budget can rank that same key
    // as its own worst-case victim (it is still sitting in keyOrder with a
    // stale LRU stamp) — evictionVictims would then "evict" it, but the
    // write below puts it right back, leaving it present in `keys` while
    // missing from `keyOrder`. `memoryUsed` is adjusted so the over/budget
    // arithmetic evictionVictims does is unaffected: excluding the key's old
    // bytes here and asking for the full new `bytes` nets out to the same
    // number as asking for `delta` against the unmodified state.
    const existingBytes = existing?.bytes ?? 0
    let candidateState = working
    if (existing) {
      const keysWithoutSelf = { ...working.keys }
      delete keysWithoutSelf[key]
      candidateState = {
        ...working,
        keys: keysWithoutSelf,
        keyOrder: working.keyOrder.filter((k) => k !== key),
        metrics: { ...working.metrics, memoryUsed: working.metrics.memoryUsed - existingBytes },
      }
    }
    const result = evictionVictims(candidateState, bytes)
    working = { ...working, rng: result.rng }
    if (result.oom) {
      // Refused: return the *original* state (still carrying result.rng would
      // leak a random draw from an eviction attempt that never happened to
      // the outside world, breaking determinism for callers that retry).
      return { state, oom: true, evicted: [] }
    }
    for (const victim of result.keys) {
      const victimRecord = working.keys[victim]!
      const nextKeys = { ...working.keys }
      delete nextKeys[victim]
      working = {
        ...working,
        keys: nextKeys,
        keyOrder: working.keyOrder.filter((k) => k !== victim),
        metrics: {
          ...working.metrics,
          evicted: working.metrics.evicted + 1,
          keysCount: working.metrics.keysCount - 1,
          memoryUsed: working.metrics.memoryUsed - victimRecord.bytes,
        },
      }
      evicted.push(victim)
    }
  }

  const expiresAt = opts?.keepTtl ? existing?.expiresAt : opts?.expiresAt
  const record: KeyRecord = {
    value,
    expiresAt,
    lastAccessAt: working.now,
    hits: existing?.hits ?? 0,
    createdAt: existing?.createdAt ?? working.now,
    bytes,
  }

  const nextKeys = { ...working.keys, [key]: record }
  const nextKeyOrder = existing ? working.keyOrder : [...working.keyOrder, key]
  const nextState: RedisState = {
    ...working,
    keys: nextKeys,
    keyOrder: nextKeyOrder,
    metrics: {
      ...working.metrics,
      keysCount: working.metrics.keysCount + (existing ? 0 : 1),
      memoryUsed: working.metrics.memoryUsed + delta,
    },
  }

  return { state: nextState, oom: false, evicted }
}

/** Removes a key outright (not via expiry or eviction) and frees its bytes. */
export function deleteKey(state: RedisState, key: string): { state: RedisState; existed: boolean } {
  const record = state.keys[key]
  if (!record) return { state, existed: false }

  const nextKeys = { ...state.keys }
  delete nextKeys[key]
  const nextState: RedisState = {
    ...state,
    keys: nextKeys,
    keyOrder: state.keyOrder.filter((k) => k !== key),
    metrics: {
      ...state.metrics,
      keysCount: state.metrics.keysCount - 1,
      memoryUsed: state.metrics.memoryUsed - record.bytes,
    },
  }
  return { state: nextState, existed: true }
}
