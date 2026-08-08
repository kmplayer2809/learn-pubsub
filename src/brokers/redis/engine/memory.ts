import { nextInt } from '../../../shell/kernel/rng'
import type { RngState } from '../../../shell/kernel/rng'
import type { EvictionPolicy, KeyRecord, RedisState, RedisValue } from './types'

/**
 * Approximate byte cost of storing `value` under `key`.
 *
 * This is a teaching approximation, not real Redis accounting — it is not
 * `MEMORY USAGE` and must not be presented to a learner as such. Redis'
 * actual footprint depends on internal encodings (embstr vs raw, intset vs
 * hashtable, listpack vs skiplist, ...) that this simulation does not model.
 * The formula here exists only so eviction has *some* deterministic, easy
 * to explain number to compare against `maxmemory`:
 *
 *   16 bytes fixed overhead per key
 * + the key name's length
 * + the payload:
 *     string  -> the string's length
 *     hash    -> sum of (field name length + field value length) per field
 *     list    -> sum of each element's length
 *     set     -> sum of each member's length
 *     zset    -> sum of (member length + 8) per member, the 8 bytes standing
 *                in for the score (a float64)
 */
export function sizeOf(key: string, value: RedisValue): number {
  const overhead = 16 + key.length
  switch (value.type) {
    case 'string':
      return overhead + value.value.length
    case 'hash':
      return overhead + Object.entries(value.value).reduce((sum, [field, v]) => sum + field.length + v.length, 0)
    case 'list':
    case 'set':
      return overhead + value.value.reduce((sum, v) => sum + v.length, 0)
    case 'zset':
      return overhead + value.value.reduce((sum, entry) => sum + entry.member.length + 8, 0)
  }
}

export interface EvictionResult {
  keys: string[]
  rng: RngState
  oom: boolean
}

/** Candidates a policy is allowed to sacrifice, in `keyOrder` so ties resolve deterministically. */
function candidatesFor(state: RedisState, policy: EvictionPolicy): string[] {
  if (policy.startsWith('volatile-')) {
    return state.keyOrder.filter((k) => state.keys[k]!.expiresAt !== undefined)
  }
  return state.keyOrder
}

/**
 * Order candidates worst-first (the key that should be evicted soonest comes
 * first). Ties break on `keyOrder` index — the array is already in that
 * order, and `Array.prototype.sort` is stable, so a plain comparator that
 * only looks at the policy's field preserves keyOrder for equal values.
 */
function rankFor(state: RedisState, policy: EvictionPolicy, candidates: string[]): string[] {
  const record = (k: string): KeyRecord => state.keys[k]!
  const ranked = [...candidates]
  switch (policy) {
    case 'allkeys-lru':
    case 'volatile-lru':
      ranked.sort((a, b) => record(a).lastAccessAt - record(b).lastAccessAt)
      break
    case 'allkeys-lfu':
      ranked.sort((a, b) => record(a).hits - record(b).hits)
      break
    case 'volatile-ttl':
      // Every candidate here is volatile (candidatesFor filtered them), so
      // expiresAt is always defined.
      ranked.sort((a, b) => record(a).expiresAt! - record(b).expiresAt!)
      break
    default:
      // allkeys-random and noeviction (which never reaches here) keep keyOrder.
      break
  }
  return ranked
}

/**
 * Pick the keys to evict so that `needBytes` more can be allocated without
 * exceeding `maxmemoryBytes`. Pure and deterministic: random draws thread
 * the rng through the return value instead of touching global state.
 */
export function evictionVictims(state: RedisState, needBytes: number): EvictionResult {
  const budget = state.topology.server.maxmemoryBytes
  if (budget === undefined) return { keys: [], rng: state.rng, oom: false }

  const over = state.metrics.memoryUsed + needBytes - budget
  if (over <= 0) return { keys: [], rng: state.rng, oom: false }

  const policy = state.topology.server.evictionPolicy ?? 'noeviction'
  if (policy === 'noeviction') return { keys: [], rng: state.rng, oom: true }

  const candidates = candidatesFor(state, policy)
  if (candidates.length === 0) return { keys: [], rng: state.rng, oom: true }

  const victims: string[] = []
  let freed = 0
  let rng = state.rng

  if (policy === 'allkeys-random') {
    // Draw without replacement: each pick removes its key from the pool so
    // later draws never repeat one, threading the rng through every step.
    const pool = [...candidates]
    while (pool.length > 0 && freed < over) {
      const [index, nextRng] = nextInt(rng, pool.length)
      rng = nextRng
      const [key] = pool.splice(index, 1)
      victims.push(key!)
      freed += state.keys[key!]!.bytes
    }
  } else {
    const ranked = rankFor(state, policy, candidates)
    for (const key of ranked) {
      if (freed >= over) break
      victims.push(key)
      freed += state.keys[key]!.bytes
    }
  }

  return { keys: victims, rng, oom: freed < over }
}
