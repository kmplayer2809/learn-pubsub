# Redis Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Redis broker module — engine, canvas, keyspace panel, and eleven lessons covering data structures, TTL, and caching — selectable from the broker switcher alongside RabbitMQ.

**Architecture:** `src/brokers/redis/engine/` is a pure reducer over `RedisState`, built on `createKernel` from `src/shell/kernel/`. A `command` event dispatches to a handler table keyed by command name; handlers are pure `(state, command) => { state, newEvents }`. Expiry is modelled twice on purpose — lazily on key access and actively by a periodic `activeExpire` event — because the gap between them is a lesson. Eviction runs after every write that grows `memoryUsed`.

**Tech Stack:** TypeScript 6, React 19, Zustand 5, `@xyflow/react` 12, Vitest 4, Tailwind 3.

**Depends on:** `docs/superpowers/plans/2026-08-07-multi-broker-shell.md` must be complete. This plan uses `createKernel`, `KernelState`, `SimEvent`, `InFlight`, `Lesson<T, A>`, `BrokerModule`, and `BROKERS`.

**Source spec:** `docs/superpowers/specs/2026-08-07-multi-broker-redis-design.md` sections 4, 5, 6 (groups *Cơ bản* and *Cache*), delivery phases 3–4.

## Global Constraints

- **Typecheck with `npm run typecheck`**, never `npx tsc --noEmit`.
- **`src/brokers/redis/engine/**` is pure**: no `Math.random`, `Date.now`, `new Date`, `setTimeout`, `setInterval`, `performance.now`, `document.`, `window.`, `process.`, dynamic `import(`/`require(`, and no `react`/`zustand`/`@xyflow/react` imports. `src/shell/kernel/purity.test.ts` enforces this the moment the directory exists.
- **Determinism:** same seed ⇒ identical journal, event for event. All randomness goes through `nextFloat`/`nextInt` from `src/shell/kernel/rng.ts`.
- **Copy:** narrative bodies, summaries, and checkpoints in Vietnamese. Redis and programming terms stay English and untranslated: key, keyspace, value, TTL, expire, eviction, maxmemory, LRU, LFU, hash, list, set, sorted set, member, score, cache-aside, write-through, write-behind, stampede, pipeline, hit, miss. Titles may stay English when they are the plain name of the concept (`Sorted Set`, `Cache-aside`).
- **Existing tests stay green.** RabbitMQ is untouched by this plan.
- **No new runtime dependencies.**
- **Commit after every task.**

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/brokers/redis/engine/types.ts` | `RedisTopology`, `RedisValue`, `RedisState`, `RedisEventType`, `RedisMetrics`. |
| `src/brokers/redis/engine/keyspace.ts` | Read/write/delete a key with lazy expiry and size accounting. |
| `src/brokers/redis/engine/memory.ts` | Approximate per-type sizing and the eviction policies. |
| `src/brokers/redis/engine/expiry.ts` | The active-expire cycle. |
| `src/brokers/redis/engine/commands/string.ts` | `SET`, `GET`, `DEL`, `INCR`, `DECR`, `APPEND`, `SETNX`. |
| `src/brokers/redis/engine/commands/keyspace.ts` | `EXPIRE`, `TTL`, `PERSIST`, `EXISTS`, `TYPE`, `SCAN`, `KEYS`, `DBSIZE`. |
| `src/brokers/redis/engine/commands/hash.ts` | `HSET`, `HGET`, `HGETALL`, `HDEL`, `HINCRBY`. |
| `src/brokers/redis/engine/commands/list.ts` | `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `BLPOP`, `LRANGE`, `LLEN`. |
| `src/brokers/redis/engine/commands/set.ts` | `SADD`, `SREM`, `SMEMBERS`, `SINTER`, `SCARD`, `SISMEMBER`. |
| `src/brokers/redis/engine/commands/zset.ts` | `ZADD`, `ZINCRBY`, `ZRANGE`, `ZREVRANGE`, `ZSCORE`, `ZCARD`. |
| `src/brokers/redis/engine/commands/server.ts` | `CONFIG SET maxmemory`, `CONFIG SET maxmemory-policy`, `INFO`. |
| `src/brokers/redis/engine/commands/index.ts` | The handler table and `RedisCommandName`. |
| `src/brokers/redis/engine/reply.ts` | Reply formatting (`OK`, `(nil)`, `(integer) 3`, arrays). |
| `src/brokers/redis/engine/validate.ts` | `validateRedisTopology` → `RedisValidationIssue[]`. |
| `src/brokers/redis/engine/index.ts` | `createRedisSimulation`, re-exports. |
| `src/brokers/redis/lessons/**` | 11 lessons + registry + group tests. |
| `src/brokers/redis/ui/nodes.tsx` | `ClientNode`, `ServerNode`. |
| `src/brokers/redis/ui/toFlow.ts` | Redis topology → React Flow. |
| `src/brokers/redis/ui/KeyspacePanel.tsx` | The Redis state panel. |
| `src/brokers/redis/ui/issueText.ts` | Vietnamese text per Redis issue code. |
| `src/brokers/redis/index.ts` | The `BrokerModule` object. |

---

### Task 1: Redis state and value types

**Files:**
- Create: `src/brokers/redis/engine/types.ts`
- Create: `src/brokers/redis/engine/types.test.ts`

**Interfaces:**
- Consumes: `KernelState`, `SimEvent` from `src/shell/kernel/types`.
- Produces:

```ts
export type NodeId = string

export type RedisValue =
  | { type: 'string'; value: string }
  | { type: 'hash'; value: Record<string, string> }
  | { type: 'list'; value: string[] }
  | { type: 'set'; value: string[] }          // insertion-ordered for determinism
  | { type: 'zset'; value: { member: string; score: number }[] }

export interface KeyRecord {
  value: RedisValue
  /** Virtual ms at which the key dies. Absent means no TTL. */
  expiresAt?: number
  /** Virtual ms of the last read or write, for LRU. */
  lastAccessAt: number
  /** Access counter, for LFU. */
  hits: number
  /** Virtual ms the key was first created, for insertion ordering in the panel. */
  createdAt: number
  /** Approximate bytes, recomputed on every write. */
  bytes: number
}

export type EvictionPolicy =
  | 'noeviction' | 'allkeys-lru' | 'allkeys-lfu'
  | 'volatile-lru' | 'volatile-ttl' | 'allkeys-random'

export interface RedisServerSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
  maxmemoryBytes?: number
  evictionPolicy?: EvictionPolicy
  /** How often the active expire cycle runs. Redis' own default is 100ms. */
  activeExpireEveryMs?: number
}

export interface RedisClientSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
}

export interface RedisTopology {
  clients: RedisClientSpec[]
  server: RedisServerSpec
}

export interface RedisMetrics {
  commands: number
  hits: number
  misses: number
  expired: number
  evicted: number
  keysCount: number
  memoryUsed: number
}

export type RedisEventType = 'command' | 'reply' | 'activeExpire' | 'evict' | 'unblock'

export interface RedisFlight {
  message: { id: string; label: string; solid: boolean }
  edgeId: string
  fromT: number
  toT: number
  tone: string
}

export interface BlockedClient {
  clientId: NodeId
  keys: string[]
  since: number
  commandId: string
}

export interface RedisState extends KernelState {
  topology: RedisTopology
  /** Insertion-ordered by construction: never reorder, the panel reads it directly. */
  keys: Record<string, KeyRecord>
  keyOrder: string[]
  metrics: RedisMetrics
  inFlight: RedisFlight[]
  /** Clients parked on BLPOP, oldest first — the wake order must be deterministic. */
  blocked: BlockedClient[]
  commandCounter: number
}
```

- [ ] **Step 1: Write the failing test**

Create `src/brokers/redis/engine/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRng } from '../../../shell/kernel/rng'
import type { RedisState } from './types'

describe('RedisState', () => {
  it('satisfies KernelState and keeps its own keyspace', () => {
    const state: RedisState = {
      now: 0,
      seq: 0,
      rng: createRng(1),
      journal: [],
      topology: { clients: [], server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } } },
      keys: { 'user:1': { value: { type: 'string', value: 'alice' }, lastAccessAt: 0, hits: 0, createdAt: 0, bytes: 12 } },
      keyOrder: ['user:1'],
      metrics: { commands: 0, hits: 0, misses: 0, expired: 0, evicted: 0, keysCount: 1, memoryUsed: 12 },
      inFlight: [],
      blocked: [],
      commandCounter: 0,
    }
    expect(state.keys['user:1']!.value.type).toBe('string')
    expect(state.keyOrder).toEqual(['user:1'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/types.test.ts`
Expected: FAIL — `Cannot find module './types'`.

- [ ] **Step 3: Write `types.ts`** with exactly the declarations above.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the purity guard now covers the new directory**

Run: `npx vitest run src/shell/kernel/purity.test.ts`
Expected: PASS. The first case discovers `src/brokers/redis/engine` automatically.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(redis): define the Redis engine state and value types"
```

---

### Task 2: Memory sizing and eviction policies

**Files:**
- Create: `src/brokers/redis/engine/memory.ts`
- Create: `src/brokers/redis/engine/memory.test.ts`

**Interfaces:**
- Consumes: `KeyRecord`, `RedisValue`, `EvictionPolicy`, `RedisState` (Task 1); `nextInt` from `src/shell/kernel/rng`.
- Produces:

```ts
export function sizeOf(key: string, value: RedisValue): number
export function evictionVictims(state: RedisState, needBytes: number): { keys: string[]; rng: RngState; oom: boolean }
```

`sizeOf` is a teaching approximation, not real Redis accounting: 16 bytes of overhead per key, plus the key name's length, plus the payload (string length; per-field name+value for a hash; per-element length for list/set; per-member length plus 8 bytes for a zset score). Document that in a comment — a reader must not mistake it for `MEMORY USAGE`.

- [ ] **Step 1: Write the failing test**

Create `src/brokers/redis/engine/memory.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRng } from '../../../shell/kernel/rng'
import { evictionVictims, sizeOf } from './memory'
import type { RedisState } from './types'

function stateWith(keys: Record<string, { bytes: number; expiresAt?: number; lastAccessAt: number; hits: number }>, policy: RedisState['topology']['server']['evictionPolicy'], maxmemoryBytes = 100): RedisState {
  const entries = Object.entries(keys)
  return {
    now: 1000,
    seq: 0,
    rng: createRng(7),
    journal: [],
    topology: { clients: [], server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 }, maxmemoryBytes, evictionPolicy: policy } },
    keys: Object.fromEntries(entries.map(([k, v]) => [k, { value: { type: 'string' as const, value: 'x' }, createdAt: 0, ...v }])),
    keyOrder: entries.map(([k]) => k),
    metrics: { commands: 0, hits: 0, misses: 0, expired: 0, evicted: 0, keysCount: entries.length, memoryUsed: entries.reduce((n, [, v]) => n + v.bytes, 0) },
    inFlight: [],
    blocked: [],
    commandCounter: 0,
  }
}

describe('sizeOf', () => {
  it('counts key overhead, key name, and payload', () => {
    expect(sizeOf('a', { type: 'string', value: 'hello' })).toBe(16 + 1 + 5)
  })

  it('sums every field of a hash', () => {
    expect(sizeOf('h', { type: 'hash', value: { name: 'alice', city: 'hanoi' } })).toBe(16 + 1 + 4 + 5 + 4 + 5)
  })

  it('adds eight bytes per zset score', () => {
    expect(sizeOf('z', { type: 'zset', value: [{ member: 'ann', score: 10 }] })).toBe(16 + 1 + 3 + 8)
  })
})

describe('evictionVictims', () => {
  it('allkeys-lru evicts the least recently accessed key first', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 900, hits: 5 }, b: { bytes: 60, lastAccessAt: 100, hits: 5 } }, 'allkeys-lru')
    expect(evictionVictims(state, 20).keys).toEqual(['b'])
  })

  it('allkeys-lfu evicts the least frequently accessed key first', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 9 }, b: { bytes: 60, lastAccessAt: 900, hits: 1 } }, 'allkeys-lfu')
    expect(evictionVictims(state, 20).keys).toEqual(['b'])
  })

  it('volatile-lru ignores keys without a TTL', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 1 }, b: { bytes: 60, lastAccessAt: 900, hits: 1, expiresAt: 5000 } }, 'volatile-lru')
    expect(evictionVictims(state, 20).keys).toEqual(['b'])
  })

  it('volatile-ttl evicts the key that dies soonest', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 1, expiresAt: 9000 }, b: { bytes: 60, lastAccessAt: 900, hits: 1, expiresAt: 2000 } }, 'volatile-ttl')
    expect(evictionVictims(state, 20).keys).toEqual(['b'])
  })

  it('reports OOM under noeviction instead of evicting', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 1 } }, 'noeviction')
    const result = evictionVictims(state, 80)
    expect(result.oom).toBe(true)
    expect(result.keys).toEqual([])
  })

  it('reports OOM when a volatile policy has no key with a TTL to sacrifice', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 100, hits: 1 }, b: { bytes: 60, lastAccessAt: 900, hits: 1 } }, 'volatile-lru')
    const result = evictionVictims(state, 20)
    expect(result.oom).toBe(true)
    expect(result.keys).toEqual([])
  })

  it('evicts as many keys as it takes to fit, and no more', () => {
    const state = stateWith({ a: { bytes: 40, lastAccessAt: 100, hits: 1 }, b: { bytes: 40, lastAccessAt: 200, hits: 1 }, c: { bytes: 40, lastAccessAt: 300, hits: 1 } }, 'allkeys-lru', 100)
    expect(evictionVictims(state, 60).keys).toEqual(['a', 'b'])
  })

  it('allkeys-random is deterministic for a given rng state', () => {
    const state = stateWith({ a: { bytes: 60, lastAccessAt: 1, hits: 1 }, b: { bytes: 60, lastAccessAt: 2, hits: 1 } }, 'allkeys-random')
    expect(evictionVictims(state, 20).keys).toEqual(evictionVictims(state, 20).keys)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/memory.test.ts`
Expected: FAIL — `Cannot find module './memory'`.

- [ ] **Step 3: Implement `memory.ts`**

`sizeOf` per the formula above. `evictionVictims(state, needBytes)`:

1. `budget = state.topology.server.maxmemoryBytes`; if undefined, return `{ keys: [], rng: state.rng, oom: false }` — no limit, nothing to do.
2. `over = state.metrics.memoryUsed + needBytes - budget`; if `over <= 0`, return the same empty result.
3. Under `noeviction`, return `{ keys: [], rng: state.rng, oom: true }`.
4. Build the candidate list: `allkeys-*` considers `state.keyOrder`; `volatile-*` considers only keys with `expiresAt !== undefined`. If the candidate list is empty, return `{ keys: [], rng: state.rng, oom: true }`.
5. Sort candidates by the policy — `lru`: ascending `lastAccessAt`; `lfu`: ascending `hits`; `ttl`: ascending `expiresAt`; `random`: repeatedly draw with `nextInt(rng, remaining.length)`, threading the rng. **Ties break on `keyOrder` index**, never on object key order, or the run stops being deterministic.
6. Take keys off the sorted list until their cumulative `bytes` covers `over`. If the whole list is not enough, return every candidate with `oom: true`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/memory.test.ts`
Expected: PASS, all nine cases.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(redis): approximate key sizing and the eviction policies"
```

---

### Task 3: Keyspace access with lazy expiry

**Files:**
- Create: `src/brokers/redis/engine/keyspace.ts`
- Create: `src/brokers/redis/engine/keyspace.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:

```ts
/** Reads a key, removing it first if it is past its expiry. Counts hit/miss. */
export function readKey(state: RedisState, key: string): { state: RedisState; record?: KeyRecord }
/** Writes a key, recomputing size, evicting if needed. `oom` means the write was refused. */
export function writeKey(state: RedisState, key: string, value: RedisValue, opts?: { keepTtl?: boolean; expiresAt?: number }): { state: RedisState; oom: boolean; evicted: string[] }
export function deleteKey(state: RedisState, key: string): { state: RedisState; existed: boolean }
/** True when the key exists and is not past its expiry. Does not mutate or count. */
export function livesAt(state: RedisState, key: string, now: number): boolean
```

- [ ] **Step 1: Write the failing test**

Create `src/brokers/redis/engine/keyspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deleteKey, livesAt, readKey, writeKey } from './keyspace'
import { emptyState } from './testState'

describe('readKey', () => {
  it('counts a hit and refreshes the LRU stamp', () => {
    const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }).state
    const at = { ...written, now: 500 }
    const { state, record } = readKey(at, 'a')
    expect(record?.value).toEqual({ type: 'string', value: 'x' })
    expect(state.metrics.hits).toBe(1)
    expect(state.keys['a']!.lastAccessAt).toBe(500)
    expect(state.keys['a']!.hits).toBe(1)
  })

  it('counts a miss for a key that was never written', () => {
    const { state, record } = readKey(emptyState(), 'nope')
    expect(record).toBeUndefined()
    expect(state.metrics.misses).toBe(1)
  })

  it('removes an expired key lazily on read and counts it as expired, not evicted', () => {
    const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }, { expiresAt: 100 }).state
    const { state, record } = readKey({ ...written, now: 101 }, 'a')
    expect(record).toBeUndefined()
    expect(state.keys['a']).toBeUndefined()
    expect(state.keyOrder).toEqual([])
    expect(state.metrics.expired).toBe(1)
    expect(state.metrics.evicted).toBe(0)
    expect(state.metrics.misses).toBe(1)
  })

  it('keeps a key that expires exactly now — Redis expires strictly after the deadline', () => {
    const written = writeKey(emptyState(), 'a', { type: 'string', value: 'x' }, { expiresAt: 100 }).state
    expect(readKey({ ...written, now: 100 }, 'a').record).toBeDefined()
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
    let state = { ...emptyState() }
    state.topology = { ...state.topology, server: { ...state.topology.server, maxmemoryBytes: 60, evictionPolicy: 'allkeys-lru' } }
    state = writeKey(state, 'old', { type: 'string', value: 'aaaaaaaaaa' }).state
    const result = writeKey({ ...state, now: 100 }, 'new', { type: 'string', value: 'bbbbbbbbbb' })
    expect(result.evicted).toEqual(['old'])
    expect(result.oom).toBe(false)
    expect(result.state.keys['new']).toBeDefined()
    expect(result.state.metrics.evicted).toBe(1)
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
```

Also create `src/brokers/redis/engine/testState.ts` (not a `.test.ts`, so it is importable by tests — and it must stay pure, since the purity guard scans it):

```ts
import { createRng } from '../../../shell/kernel/rng'
import type { RedisState } from './types'

/** A single-server, no-client, empty keyspace at time 0. Every engine test starts here. */
export function emptyState(): RedisState {
  return {
    now: 0,
    seq: 0,
    rng: createRng(1),
    journal: [],
    topology: { clients: [], server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } } },
    keys: {},
    keyOrder: [],
    metrics: { commands: 0, hits: 0, misses: 0, expired: 0, evicted: 0, keysCount: 0, memoryUsed: 0 },
    inFlight: [],
    blocked: [],
    commandCounter: 0,
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/keyspace.test.ts`
Expected: FAIL — `Cannot find module './keyspace'`.

- [ ] **Step 3: Implement `keyspace.ts`**

- `livesAt`: `const r = state.keys[key]; return Boolean(r) && (r.expiresAt === undefined || r.expiresAt >= now)`. Strictly `>=`: a key expires *after* its deadline, matching the test above.
- `readKey`: if the record is missing → `misses + 1`. If present but `expiresAt < state.now` → delete it, `expired + 1`, `misses + 1`, return no record. Otherwise `hits + 1`, bump `lastAccessAt = state.now` and `hits + 1` on the record.
- `writeKey`: compute `bytes = sizeOf(key, value)`; `delta = bytes - (existing?.bytes ?? 0)`; if `delta > 0` call `evictionVictims(state, delta)` and either apply the victims (`evicted + n`, freeing their bytes, threading the returned rng) or, when `oom`, return the state unchanged with `oom: true`. Then write the record, appending to `keyOrder` only when the key is new, setting `expiresAt` from `opts` (or preserving it when `opts.keepTtl`), `createdAt` preserved on overwrite, `lastAccessAt = state.now`, `hits` preserved on overwrite and `0` when new.
- `deleteKey`: remove from `keys` and `keyOrder`, subtract `bytes`, decrement `keysCount`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/brokers/redis/engine/keyspace.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(redis): keyspace access with lazy expiry and eviction on write"
```

---

### Task 4: The command handler table and reply formatting

**Files:**
- Create: `src/brokers/redis/engine/reply.ts` (+ test)
- Create: `src/brokers/redis/engine/commands/index.ts`
- Create: `src/brokers/redis/engine/commands/string.ts` (+ test)
- Create: `src/brokers/redis/engine/commands/keyspace.ts` (+ test)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:

```ts
export type Reply =
  | { kind: 'status'; value: string }        // OK
  | { kind: 'integer'; value: number }       // (integer) 3
  | { kind: 'bulk'; value: string }          // "alice"
  | { kind: 'nil' }                          // (nil)
  | { kind: 'array'; value: string[] }       // 1) "a"  2) "b"
  | { kind: 'error'; value: string }         // (error) OOM ...

export function formatReply(reply: Reply): string
export function formatCommand(name: string, args: string[]): string

export interface CommandContext { state: RedisState; clientId: NodeId; args: string[] }
export interface CommandResult { state: RedisState; reply: Reply }
export type CommandHandler = (context: CommandContext) => CommandResult

export const HANDLERS: Record<RedisCommandName, CommandHandler>
export type RedisCommandName = keyof typeof HANDLERS
export function isCommandName(name: string): name is RedisCommandName
```

- [ ] **Step 1: Write the failing tests**

`src/brokers/redis/engine/reply.test.ts`:

```ts
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
```

An argument is quoted when it is not a bare integer — that keys, TTL seconds, and scores read naturally in the journal.

`src/brokers/redis/engine/commands/string.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { emptyState } from '../testState'
import { HANDLERS } from './index'

const run = (state = emptyState(), name: string, args: string[]) =>
  HANDLERS[name as keyof typeof HANDLERS]({ state, clientId: 'c1', args })

describe('SET / GET', () => {
  it('SET replies OK and GET returns the value', () => {
    const set = run(emptyState(), 'SET', ['user:1', 'alice'])
    expect(set.reply).toEqual({ kind: 'status', value: 'OK' })
    expect(run(set.state, 'GET', ['user:1']).reply).toEqual({ kind: 'bulk', value: 'alice' })
  })

  it('GET on a missing key is nil, not an error', () => {
    expect(run(emptyState(), 'GET', ['nope']).reply).toEqual({ kind: 'nil' })
  })

  it('SET ... EX sets a TTL in seconds', () => {
    const set = run(emptyState(), 'SET', ['k', 'v', 'EX', '60'])
    expect(set.state.keys['k']!.expiresAt).toBe(60_000)
  })

  it('SET ... KEEPTTL preserves the existing TTL', () => {
    const first = run(emptyState(), 'SET', ['k', 'v', 'EX', '60'])
    const second = run(first.state, 'SET', ['k', 'v2', 'KEEPTTL'])
    expect(second.state.keys['k']!.expiresAt).toBe(60_000)
  })

  it('SET on a key of another type replaces it wholesale', () => {
    const pushed = run(emptyState(), 'LPUSH', ['k', 'a'])
    const set = run(pushed.state, 'SET', ['k', 'v'])
    expect(set.state.keys['k']!.value).toEqual({ type: 'string', value: 'v' })
  })

  it('SET refused for lack of memory replies with an OOM error', () => {
    const base = emptyState()
    base.topology = { ...base.topology, server: { ...base.topology.server, maxmemoryBytes: 10, evictionPolicy: 'noeviction' } }
    expect(run(base, 'SET', ['k', 'aaaaaaaaaaaa']).reply.kind).toBe('error')
  })
})

describe('INCR', () => {
  it('creates the key at 1 when it does not exist', () => {
    expect(run(emptyState(), 'INCR', ['n']).reply).toEqual({ kind: 'integer', value: 1 })
  })

  it('increments an existing integer string', () => {
    const first = run(emptyState(), 'SET', ['n', '41'])
    expect(run(first.state, 'INCR', ['n']).reply).toEqual({ kind: 'integer', value: 42 })
  })

  it('errors on a value that is not an integer', () => {
    const first = run(emptyState(), 'SET', ['n', 'alice'])
    expect(run(first.state, 'INCR', ['n']).reply).toEqual({
      kind: 'error',
      value: 'ERR value is not an integer or out of range',
    })
  })

  it('errors on a key holding the wrong type', () => {
    const first = run(emptyState(), 'LPUSH', ['n', 'a'])
    expect(run(first.state, 'INCR', ['n']).reply.kind).toBe('error')
  })
})

describe('DEL / SETNX', () => {
  it('DEL returns how many keys it removed', () => {
    const set = run(emptyState(), 'SET', ['a', '1'])
    expect(run(set.state, 'DEL', ['a', 'b']).reply).toEqual({ kind: 'integer', value: 1 })
  })

  it('SETNX refuses to overwrite', () => {
    const set = run(emptyState(), 'SET', ['a', 'first'])
    const nx = run(set.state, 'SETNX', ['a', 'second'])
    expect(nx.reply).toEqual({ kind: 'integer', value: 0 })
    expect(nx.state.keys['a']!.value).toEqual({ type: 'string', value: 'first' })
  })
})
```

`src/brokers/redis/engine/commands/keyspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { emptyState } from '../testState'
import { HANDLERS } from './index'

const run = (state: ReturnType<typeof emptyState>, name: string, args: string[]) =>
  HANDLERS[name as keyof typeof HANDLERS]({ state, clientId: 'c1', args })

describe('EXPIRE / TTL / PERSIST', () => {
  it('EXPIRE on an existing key returns 1 and stamps the deadline', () => {
    const set = run(emptyState(), 'SET', ['k', 'v'])
    const expire = run({ ...set.state, now: 1000 }, 'EXPIRE', ['k', '30'])
    expect(expire.reply).toEqual({ kind: 'integer', value: 1 })
    expect(expire.state.keys['k']!.expiresAt).toBe(31_000)
  })

  it('EXPIRE on a missing key returns 0', () => {
    expect(run(emptyState(), 'EXPIRE', ['k', '30']).reply).toEqual({ kind: 'integer', value: 0 })
  })

  it('TTL reports remaining seconds, -1 without a TTL, -2 when the key is gone', () => {
    const set = run(emptyState(), 'SET', ['k', 'v'])
    expect(run(set.state, 'TTL', ['k']).reply).toEqual({ kind: 'integer', value: -1 })
    const expire = run(set.state, 'EXPIRE', ['k', '30'])
    expect(run({ ...expire.state, now: 10_000 }, 'TTL', ['k']).reply).toEqual({ kind: 'integer', value: 20 })
    expect(run(emptyState(), 'TTL', ['nope']).reply).toEqual({ kind: 'integer', value: -2 })
  })

  it('PERSIST removes the TTL and returns 1 only when there was one', () => {
    const set = run(emptyState(), 'SET', ['k', 'v', 'EX', '30'])
    const persisted = run(set.state, 'PERSIST', ['k'])
    expect(persisted.reply).toEqual({ kind: 'integer', value: 1 })
    expect(persisted.state.keys['k']!.expiresAt).toBeUndefined()
    expect(run(persisted.state, 'PERSIST', ['k']).reply).toEqual({ kind: 'integer', value: 0 })
  })
})

describe('SCAN / KEYS', () => {
  it('KEYS matches a glob and returns every match at once', () => {
    let state = emptyState()
    for (const k of ['user:1', 'user:2', 'session:9']) state = run(state, 'SET', [k, 'v']).state
    expect(run(state, 'KEYS', ['user:*']).reply).toEqual({ kind: 'array', value: ['user:1', 'user:2'] })
  })

  it('SCAN returns a cursor and a page, and terminates with cursor 0', () => {
    let state = emptyState()
    for (const k of ['a', 'b', 'c']) state = run(state, 'SET', [k, 'v']).state
    const first = run(state, 'SCAN', ['0', 'COUNT', '2'])
    expect(first.reply).toEqual({ kind: 'array', value: ['2', 'a', 'b'] })
    const second = run(state, 'SCAN', ['2', 'COUNT', '2'])
    expect(second.reply).toEqual({ kind: 'array', value: ['0', 'c'] })
  })

  it('SCAN skips a key that has already expired', () => {
    let state = run(emptyState(), 'SET', ['dead', 'v', 'EX', '1']).state
    state = run(state, 'SET', ['alive', 'v']).state
    const page = run({ ...state, now: 5000 }, 'SCAN', ['0', 'COUNT', '10'])
    expect(page.reply).toEqual({ kind: 'array', value: ['0', 'alive'] })
  })
})

describe('EXISTS / TYPE / DBSIZE', () => {
  it('EXISTS counts only live keys', () => {
    const set = run(emptyState(), 'SET', ['k', 'v', 'EX', '1'])
    expect(run(set.state, 'EXISTS', ['k']).reply).toEqual({ kind: 'integer', value: 1 })
    expect(run({ ...set.state, now: 5000 }, 'EXISTS', ['k']).reply).toEqual({ kind: 'integer', value: 0 })
  })

  it('TYPE names the value type, or none', () => {
    const set = run(emptyState(), 'LPUSH', ['k', 'a'])
    expect(run(set.state, 'TYPE', ['k']).reply).toEqual({ kind: 'status', value: 'list' })
    expect(run(emptyState(), 'TYPE', ['nope']).reply).toEqual({ kind: 'status', value: 'none' })
  })

  it('DBSIZE counts live keys only', () => {
    let state = run(emptyState(), 'SET', ['a', 'v']).state
    state = run(state, 'SET', ['b', 'v', 'EX', '1']).state
    expect(run({ ...state, now: 5000 }, 'DBSIZE', []).reply).toEqual({ kind: 'integer', value: 1 })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/brokers/redis/engine/reply.test.ts src/brokers/redis/engine/commands/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `reply.ts`, `commands/string.ts`, `commands/keyspace.ts`, and `commands/index.ts`**

`commands/index.ts` assembles the table:

```ts
import * as keyspace from './keyspace'
import * as string from './string'

export const HANDLERS = {
  ...string.handlers,
  ...keyspace.handlers,
} satisfies Record<string, CommandHandler>

export type RedisCommandName = keyof typeof HANDLERS

export function isCommandName(name: string): name is RedisCommandName {
  return Object.hasOwn(HANDLERS, name)
}
```

Each command module exports `export const handlers = { SET: (ctx) => ..., ... }`.

Notes the implementer must honour:

- `SET k v EX <seconds>` computes `expiresAt = state.now + seconds * 1000`. `PX` takes milliseconds. `KEEPTTL` passes `keepTtl: true` to `writeKey`. `NX`/`XX` gate the write.
- Any handler that reads a key must go through `readKey`, so lazy expiry and hit/miss counting happen in exactly one place.
- Wrong-type access replies `{ kind: 'error', value: 'WRONGTYPE Operation against a key holding the wrong kind of value' }` and leaves state untouched.
- An OOM from `writeKey` replies `{ kind: 'error', value: "OOM command not allowed when used memory > 'maxmemory'." }`.
- `SCAN` uses `keyOrder` index as the cursor: the cursor is the index to resume at, and `0` is returned when the page reached the end. This is not how real Redis cursors work (they are reverse-binary bucket cursors), and the SCAN lesson must say so rather than let a learner infer a false guarantee.
- `KEYS` glob support is `*` and `?` only — compile to a `RegExp` by escaping every other character.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/brokers/redis/engine/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(redis): reply formatting plus the string and keyspace commands"
```

---

### Task 5: Hash, list, set, and sorted set commands

**Files:**
- Create: `src/brokers/redis/engine/commands/hash.ts` (+ test)
- Create: `src/brokers/redis/engine/commands/list.ts` (+ test)
- Create: `src/brokers/redis/engine/commands/set.ts` (+ test)
- Create: `src/brokers/redis/engine/commands/zset.ts` (+ test)
- Modify: `src/brokers/redis/engine/commands/index.ts`

**Interfaces:**
- Consumes: `CommandHandler`, `readKey`/`writeKey`/`deleteKey` (Tasks 3–4).
- Produces: handler entries for `HSET`, `HGET`, `HGETALL`, `HDEL`, `HINCRBY`, `LPUSH`, `RPUSH`, `LPOP`, `RPOP`, `LRANGE`, `LLEN`, `BLPOP`, `SADD`, `SREM`, `SMEMBERS`, `SINTER`, `SCARD`, `SISMEMBER`, `ZADD`, `ZINCRBY`, `ZRANGE`, `ZREVRANGE`, `ZSCORE`, `ZCARD`.

- [ ] **Step 1: Write the failing tests**

One test file per type. The cases each file must cover, with the exact expected replies:

`hash.test.ts`
- `HSET h field alice` on a missing key → `{ kind: 'integer', value: 1 }` (fields added), and the key's type is `hash`.
- `HSET h field bob` on an existing field → `{ kind: 'integer', value: 0 }`, value updated.
- `HSET h a 1 b 2` → `{ kind: 'integer', value: 2 }`.
- `HGET h missing` → `{ kind: 'nil' }`.
- `HGETALL h` → `{ kind: 'array', value: ['a', '1', 'b', '2'] }`, fields in insertion order.
- `HINCRBY h n 5` on a missing field → `{ kind: 'integer', value: 5 }`.
- `HGET` on a string key → `WRONGTYPE` error.
- `HDEL h a` removing the last field deletes the key entirely (`state.keys['h']` undefined) — Redis does not keep empty collections.

`list.test.ts`
- `LPUSH l a`, `LPUSH l b` → `LRANGE l 0 -1` gives `['b', 'a']`.
- `RPUSH l c` → `LRANGE l 0 -1` gives `['b', 'a', 'c']`.
- `LPOP l` → `{ kind: 'bulk', value: 'b' }`; `RPOP l` → `'c'`.
- `LPOP` on the last element deletes the key.
- `LPOP` on a missing key → `{ kind: 'nil' }`.
- `LLEN` on a missing key → `{ kind: 'integer', value: 0 }`.
- `LRANGE l 0 -1` on a missing key → `{ kind: 'array', value: [] }`.
- `LRANGE l 1 -2` slices inclusively at both ends.
- `BLPOP l 5` with a non-empty list pops immediately and replies `{ kind: 'array', value: ['l', 'b'] }`.
- `BLPOP l 5` with an empty list returns `{ kind: 'blocked' }`-equivalent: the handler pushes the client onto `state.blocked` and replies `{ kind: 'nil' }` for now; the `unblock` wiring is Task 7. Assert `result.state.blocked` has one entry naming the client and the key.

`set.test.ts`
- `SADD s a b a` → `{ kind: 'integer', value: 2 }` (duplicates not counted).
- `SMEMBERS s` → insertion order `['a', 'b']`. Document in a comment that real Redis gives no order guarantee and this engine fixes one for determinism; the Set lesson must say the same.
- `SISMEMBER s a` → `1`; missing → `0`.
- `SINTER s1 s2` → members present in both, in `s1`'s order.
- `SINTER` with a missing key → `{ kind: 'array', value: [] }`.
- `SREM` of the last member deletes the key.
- `SCARD` on a missing key → `0`.

`zset.test.ts`
- `ZADD z 10 ann 20 bob` → `{ kind: 'integer', value: 2 }`.
- `ZADD z 30 ann` on an existing member → `{ kind: 'integer', value: 0 }`, score updated.
- `ZRANGE z 0 -1` → ascending by score → `['bob', 'ann']` after the update above.
- `ZRANGE z 0 -1 WITHSCORES` → `['bob', '20', 'ann', '30']`.
- `ZREVRANGE z 0 0` → `['ann']`.
- Equal scores order by member string, ascending — the tie-break must be explicit or the run is not deterministic.
- `ZINCRBY z 5 bob` → `{ kind: 'bulk', value: '25' }`.
- `ZSCORE z nope` → `{ kind: 'nil' }`.
- `ZCARD` on a missing key → `0`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/brokers/redis/engine/commands/`
Expected: FAIL — the four new modules do not exist.

- [ ] **Step 3: Implement the four command modules and add them to `HANDLERS`**

Shared rules:
- Every handler reads through `readKey` and writes through `writeKey` — never touches `state.keys` directly, or eviction and lazy expiry silently stop applying.
- A collection command on a key of another type replies `WRONGTYPE` and returns the state unchanged.
- Removing the last element/field/member deletes the key via `deleteKey`.
- Negative `LRANGE`/`ZRANGE` indices count from the end; `-1` is the last element; an out-of-range slice yields an empty array rather than an error.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/brokers/redis/engine/commands/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(redis): hash, list, set, and sorted set commands"
```

---

### Task 6: The active expire cycle

**Files:**
- Create: `src/brokers/redis/engine/expiry.ts` (+ test)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:

```ts
export const ACTIVE_EXPIRE_SAMPLE = 20
export function applyActiveExpire(state: RedisState, event: SimEvent<RedisEventType>): { state: RedisState; newEvents: SimEvent<RedisEventType>[] }
```

- [ ] **Step 1: Write the failing test**

`src/brokers/redis/engine/expiry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { writeKey } from './keyspace'
import { applyActiveExpire } from './expiry'
import { emptyState } from './testState'
import type { RedisState } from './types'

function withKeys(count: number, expiresAt: number): RedisState {
  let state = emptyState()
  for (let i = 0; i < count; i++) {
    state = writeKey(state, `k${i}`, { type: 'string', value: 'v' }, { expiresAt }).state
  }
  return state
}

const tick = { at: 0, seq: 0, type: 'activeExpire' as const, payload: {} }

describe('applyActiveExpire', () => {
  it('removes keys already past their deadline and counts them as expired', () => {
    const state = { ...withKeys(3, 100), now: 500 }
    const result = applyActiveExpire(state, { ...tick, at: 500 })
    expect(result.state.metrics.expired).toBe(3)
    expect(result.state.keyOrder).toEqual([])
  })

  it('leaves keys that are still alive', () => {
    const state = { ...withKeys(3, 9000), now: 500 }
    expect(applyActiveExpire(state, { ...tick, at: 500 }).state.keyOrder).toHaveLength(3)
  })

  it('samples at most ACTIVE_EXPIRE_SAMPLE keys per pass, so a big keyspace drains over several passes', () => {
    const state = { ...withKeys(50, 100), now: 500 }
    const result = applyActiveExpire(state, { ...tick, at: 500 })
    expect(result.state.metrics.expired).toBe(20)
    expect(result.state.keyOrder).toHaveLength(30)
  })

  it('schedules the next pass at the configured interval', () => {
    const base = withKeys(1, 9000)
    const state: RedisState = { ...base, now: 500, topology: { ...base.topology, server: { ...base.topology.server, activeExpireEveryMs: 250 } } }
    const [next] = applyActiveExpire(state, { ...tick, at: 500 }).newEvents
    expect(next).toMatchObject({ at: 750, type: 'activeExpire' })
  })

  it('defaults the interval to 100ms, matching Redis', () => {
    const state = { ...withKeys(1, 9000), now: 0 }
    expect(applyActiveExpire(state, tick).newEvents[0]!.at).toBe(100)
  })

  it('is deterministic: the same state expires the same keys', () => {
    const state = { ...withKeys(50, 100), now: 500 }
    const a = applyActiveExpire(state, { ...tick, at: 500 })
    const b = applyActiveExpire(state, { ...tick, at: 500 })
    expect(a.state.keyOrder).toEqual(b.state.keyOrder)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/expiry.test.ts`
Expected: FAIL — `Cannot find module './expiry'`.

- [ ] **Step 3: Implement `expiry.ts`**

Walk the first `ACTIVE_EXPIRE_SAMPLE` entries of `keyOrder` that carry an `expiresAt`, delete the ones with `expiresAt < state.now`, count them into `metrics.expired`, append one journal line per removal (`# active expire removed user:1`), and always schedule the next `activeExpire` at `state.now + (server.activeExpireEveryMs ?? 100)`.

Sampling the head of `keyOrder` rather than drawing randomly is a deliberate simplification — it keeps the cycle deterministic without threading the rng, and it still shows the behaviour the lesson needs (a large keyspace does not drain in one pass). Say so in a comment.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/brokers/redis/engine/expiry.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(redis): the active expire cycle"
```

---

### Task 7: `createRedisSimulation`

**Files:**
- Create: `src/brokers/redis/engine/validate.ts` (+ test)
- Create: `src/brokers/redis/engine/index.ts` (+ test)

**Interfaces:**
- Consumes: `createKernel` (shell kernel), Tasks 1–6.
- Produces:

```ts
export interface RedisScriptedCommand {
  at: number
  clientId: NodeId
  name: RedisCommandName
  args: string[]
  tone?: string
}

export interface RedisSimulationOptions {
  topology: RedisTopology
  script: RedisScriptedCommand[]
  seed: number
  maxEvents?: number
}

export type RedisIssueCode = 'client-missing' | 'unknown-command' | 'no-clients' | 'maxmemory-noeviction'
export interface RedisValidationIssue { code: RedisIssueCode; severity: 'error' | 'warning'; nodeId?: string; message: string }
export function validateRedisTopology(topology: RedisTopology, script: RedisScriptedCommand[]): RedisValidationIssue[]

export function createRedisSimulation(options: RedisSimulationOptions): Simulation<RedisState> & { readonly issues: RedisValidationIssue[] }

export const COMMAND_TRAVEL_MS = 120
```

- [ ] **Step 1: Write the failing test**

`src/brokers/redis/engine/index.test.ts`:

```ts
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

  it('wakes a BLPOP client when a push arrives, in arrival order', () => {
    const sim = createRedisSimulation({
      topology: { ...topology, clients: [...topology.clients, { id: 'c2', label: 'Worker', position: { x: 40, y: 260 } }] },
      script: [
        { at: 0, clientId: 'c2', name: 'BLPOP', args: ['jobs', '10'] },
        { at: 1000, clientId: 'c1', name: 'LPUSH', args: ['jobs', 'job-1'] },
      ],
      seed: 1,
    })
    sim.advanceTo(3000)
    expect(sim.snapshot().blocked).toEqual([])
    expect(sim.snapshot().keys['jobs']).toBeUndefined()
    expect(sim.snapshot().journal.map((e) => e.text)).toContain('BLPOP jobs 10 → 1) "jobs" 2) "job-1"')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/brokers/redis/engine/index.test.ts`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Implement `validate.ts`**

- `client-missing` (error): a scripted command names a `clientId` not in `topology.clients`.
- `unknown-command` (error): `!isCommandName(command.name)`. This is unreachable from a typed lesson and reachable from the Sandbox console.
- `no-clients` (warning): `topology.clients` is empty — nothing will ever run.
- `maxmemory-noeviction` (warning): `maxmemoryBytes` set and policy is `noeviction` (or unset, since `noeviction` is the Redis default).

- [ ] **Step 4: Implement `index.ts`**

```ts
export const COMMAND_TRAVEL_MS = 120

const REDUCERS: Record<RedisEventType, (s: RedisState, e: SimEvent<RedisEventType>) => { state: RedisState; newEvents: SimEvent<RedisEventType>[] }> = {
  command: applyCommand,
  reply: applyReply,
  activeExpire: applyActiveExpire,
  evict: (s) => ({ state: s, newEvents: [] }),   // eviction happens inside writeKey; the
                                                  // event type exists so the Sandbox can
                                                  // surface a manual FLUSH-style eviction later
  unblock: applyUnblock,
}
```

- `seedEvents` maps each scripted command to a `command` event at `command.at`, payload `{ clientId, name, args, tone, commandId }` where `commandId` is `cmd-<index>` — deterministic and stable across replays.
- `applyCommand`: at `at`, push an `InFlight` on edge `${clientId}->${server.id}` from `at` to `at + COMMAND_TRAVEL_MS` labelled with the command name, and schedule a `reply` event at `at + COMMAND_TRAVEL_MS`.
- `applyReply`: drop that flight, run `HANDLERS[name]({ state, clientId, args })`, increment `metrics.commands`, append the journal line `` `${formatCommand(name, args)} → ${formatReply(reply)}` ``, then push a return `InFlight` on `${server.id}->${clientId}` from `now` to `now + COMMAND_TRAVEL_MS`, and schedule an `unblock` at `now` when the command was a push onto a key some client is blocked on. Schedule a plain flight-cleanup by giving the reply flight a `toT` and dropping expired flights at the start of every reducer — a single `pruneFlights(state)` helper called first in each reducer keeps this in one place.
- `applyUnblock`: take the oldest entry in `state.blocked` whose key now has an element, pop it via the list handler, journal the completed `BLPOP` line, and remove the entry. Repeat while both a blocked client and an element remain.
- `createRedisSimulation` wires `createKernel` with `fatal: issues.some(i => i.severity === 'error')` and seeds one `activeExpire` at `server.activeExpireEveryMs ?? 100`, exactly as the RabbitMQ module wires its own.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/brokers/redis/engine/`
Expected: PASS, every file.

- [ ] **Step 6: Purity, typecheck, commit**

```bash
npx vitest run src/shell/kernel/purity.test.ts
npm run typecheck
git add -A && git commit -m "feat(redis): assemble the Redis simulation on the shell kernel"
```

---

### Task 8: Redis canvas nodes, `toFlow`, and the keyspace panel

**Files:**
- Create: `src/brokers/redis/ui/nodes.tsx` (+ test)
- Create: `src/brokers/redis/ui/toFlow.ts` (+ test)
- Create: `src/brokers/redis/ui/KeyspacePanel.tsx` (+ test)
- Create: `src/brokers/redis/ui/issueText.ts` (+ test)
- Create: `src/brokers/redis/ui/NodeConfig.tsx` (+ test) — see **Amendment 3**

**Interfaces:**
- Consumes: `RedisState`, `RedisTopology` (Task 1); `RedisValidationIssue` (Task 7).
- Produces:

```ts
export function ClientNode(props: NodeProps): JSX.Element
export function ServerNode(props: NodeProps): JSX.Element
export function toFlowNodes(topology: RedisTopology, state: RedisState, highlight?: string[]): Node[]
export function toFlowEdges(topology: RedisTopology): Edge[]
export function KeyspacePanel({ state }: { state: RedisState }): JSX.Element
export function issueText(issue: RedisValidationIssue): string
export function NodeConfig(props: { lesson: Lesson<RedisTopology, RedisScriptedCommand>; state: RedisState; nodeId: string }): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

`toFlow.test.ts`:
- One node per client plus one for the server.
- `toFlowEdges` gives one edge per client in each direction: ids `c1->redis` and `redis->c1`. Both directions are required — `MessageLayer` looks the edge up by id to place the particle, and a reply travels the other way.
- A node named in `highlight` carries `data.highlighted === true`; an id matching nothing is ignored rather than throwing.
- The server node's data carries `keysCount`, `memoryUsed`, `maxmemoryBytes`, and `evictionPolicy`.

`KeyspacePanel.test.tsx`:
- Renders one row per live key, in `keyOrder`, each with `data-testid="keyspace-row"` and `data-key="<name>"`.
- A key past its expiry is not rendered at all — the panel shows what a client would see.
- The TTL column shows remaining whole seconds, and `—` for a key with no TTL.
- The value column summarises by type: a string shows its value truncated to 24 characters with an ellipsis; a hash shows `{n} fields`; a list `{n} items`; a set `{n} members`; a zset `{n} members`.
- An empty keyspace renders `data-testid="keyspace-empty"` with the Vietnamese text `Keyspace đang trống.`
- The header shows `keysCount` and `memoryUsed`.
- A key whose TTL expires within 1000ms carries `data-expiring="true"`, which drives the pulse.

`issueText.test.ts`: one case per `RedisIssueCode`, asserting Vietnamese output that keeps `client`, `command`, `maxmemory`, and `noeviction` in English.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/brokers/redis/ui/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Match the existing RabbitMQ node styling (`src/brokers/rabbitmq/ui/nodes.tsx`) so the two brokers look like one app: same rounded box, same slate palette, same `.outline-fuchsia-400` class for the narrative highlight — `App.test.tsx` finds highlighted nodes by that class, and the Redis lessons will need the same affordance.

`ServerNode` renders the label, `keysCount` keys, and `memoryUsed / maxmemoryBytes` with the policy name when a limit is set.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/brokers/redis/ui/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(redis): canvas nodes, edges, and the keyspace panel"
```

---

### Task 9: Register the Redis broker module

**Files:**
- Create: `src/brokers/redis/index.ts`
- Create: `src/brokers/redis/lessons/registry.ts`
- Modify: `src/brokers/registry.ts`
- Modify: `src/brokers/registry.test.ts`

**Interfaces:**
- Consumes: Tasks 7–8; `BrokerModule` from `src/brokers/types.ts`.
- Produces: `export const redis: BrokerModule<RedisState, RedisTopology, RedisScriptedCommand, RedisValidationIssue>`; `BROKERS` becomes `[rabbitmq, redis]`.

- [ ] **Step 1: Write the failing test**

Add to `src/brokers/registry.test.ts`:

```ts
it('lists Redis alongside RabbitMQ', () => {
  expect(BROKERS.map((b) => b.id)).toEqual(['rabbitmq', 'redis'])
})

it('gives Redis lessons but no sandbox yet', () => {
  const redis = getBroker('redis')
  expect(redis.lessons.length).toBeGreaterThan(0)
  expect(redis.sandbox).toBeUndefined()
})
```

Add to `src/shell/ui/App.test.tsx`:

```ts
it('switches the whole workspace to Redis', () => {
  render(<App />)
  act(() => useAppStore.getState().setBroker('redis'))
  expect(screen.getByTestId('keyspace-panel')).toBeTruthy()
  expect(screen.queryByTestId('inflight-panel')).toBeNull()
  expect(screen.queryByTestId('open-sandbox')).toBeNull()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/brokers/registry.test.ts src/shell/ui/App.test.tsx`
Expected: FAIL — `getBroker('redis')` falls back to RabbitMQ.

- [ ] **Step 3: Implement**

`src/brokers/redis/lessons/registry.ts` starts with an empty `LESSONS` array and the four group specs:

```ts
export const REDIS_LESSON_GROUPS = [
  { id: 'basics', label: 'Cơ bản' },
  { id: 'cache', label: 'Cache' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'advanced', label: 'Nâng cao' },
]
```

The `messaging` and `advanced` groups have no lessons until the next plan; the registry test asserts every lesson's group is declared, not that every group has a lesson, so an empty group is fine.

`src/brokers/redis/index.ts` mirrors the RabbitMQ module: `id: 'redis'`, `label: 'Redis'`, `defaultLessonId: '01-strings'`, `emptyTopology` with one server and no clients, `createSimulation: createRedisSimulation`, `nodeTypes: { client: ClientNode, server: ServerNode }`, `inFlight: (state) => state.inFlight`, `StatePanel: KeyspacePanel`, `issueText`, and **no** `sandbox` field.

See **Amendments 1–4** at the end of this plan for the four slots this paragraph gets wrong — it was written before the shell branch finished, and the `BrokerModule` contract moved underneath it. `src/brokers/types.ts` at HEAD is the authority; that paragraph is not.

`defaultLessonId` must resolve to a lesson that exists, so **this task includes Task 10's lesson file**: write `src/brokers/redis/lessons/01-strings.ts` exactly as Task 10 specifies and add it to `LESSONS` here. Task 10 then contributes only its behaviour test (its Step 4) and its own commit.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS once Task 10's first lesson exists.

- [ ] **Step 5: Commit**

```bash
git add -- src/brokers/redis/ src/brokers/registry.ts src/brokers/registry.test.ts src/brokers/catalog.ts src/shell/ui/App.test.tsx
git commit -m "feat(redis): register the Redis broker module"
```

Never `git add -A`: `.claude/scheduled_tasks.lock` is unrelated noise that has been
left unstaged in every commit on this project, and a bare `-A` sweeps it in.

---

### Tasks 10–20: The eleven lessons

Every lesson task has the identical shape, so the steps are stated once here and each task below gives only its own content. **Do not skip a step because the previous lesson did the same thing** — each lesson is committed and verified on its own.

**Per-lesson steps:**

- [ ] **Step 1:** Write `src/brokers/redis/lessons/<file>.ts` exporting a `RedisLesson` with the `id`, `group`, `title`, `summary`, `topology`, `script`, `narrative`, `checkpoints`, `seed`, and `durationMs` given below.
- [ ] **Step 2:** Add it to `LESSONS` in `src/brokers/redis/lessons/registry.ts` (and import it).
- [ ] **Step 3:** Run `npx vitest run src/brokers/redis/lessons/` — the shared `lessons.test.ts` (Task 21) checks validity, determinism, and that every command gets a reply.
- [ ] **Step 4:** Write the lesson's own behaviour test in the matching group file (`basics.test.ts` or `cache.test.ts`), asserting the specific claim named under **Must prove** below. A lesson whose narrative claims something the engine does not do is the failure mode these tests exist to catch.
- [ ] **Step 5:** Run `npm test` and commit: `git commit -m "feat(redis): lesson <n> — <title>"`.

`RedisLesson` is declared once, in `src/brokers/redis/lessons/types.ts`:

```ts
import type { Lesson } from '../../../shell/lesson/types'
import type { RedisScriptedCommand, RedisTopology } from '../engine'

export type RedisLessonGroup = 'basics' | 'cache' | 'messaging' | 'advanced'

export interface RedisLesson extends Lesson<RedisTopology, RedisScriptedCommand> {
  group: RedisLessonGroup
}
```

Every lesson uses this two-client topology unless its own entry says otherwise:

```ts
const APP = { id: 'app', label: 'App', position: { x: 40, y: 120 } }
const WORKER = { id: 'worker', label: 'Worker', position: { x: 40, y: 280 } }
const SERVER = { id: 'redis', label: 'Redis', position: { x: 380, y: 200 } }
```

---

#### Task 10: Lesson 01 — `01-strings.ts`, group `basics`

**Title:** `String và counter` · **seed** 1 · **durationMs** 12_000
**Script:** `SET user:1 alice` @0; `GET user:1` @1500; `GET user:2` @3000; `INCR page:views` @4500; `INCR page:views` @6000; `SET user:1 bob` @7500; `GET user:1` @9000.
**Narrative beats (4):** keyspace is one flat map from key to value, no tables and no schema · `GET` on a missing key returns `(nil)`, which is a value, not an error · `INCR` is atomic and creates the key at 0 first, so no read-modify-write race exists · `SET` overwrites without asking and drops any TTL the key had.
**Checkpoint** @10_500: "`INCR` trên một key chưa tồn tại trả về gì?" → options `(error)`, `(integer) 1`, `(nil)` → answer index 1 → explanation names the create-at-zero-then-increment behaviour.
**Must prove:** after 10_000ms, `keys['page:views']` is `{ type: 'string', value: '2' }` and `metrics.misses` is 1.

#### Task 11: Lesson 02 — `02-hash.ts`, group `basics`

**Title:** `Hash` · **seed** 2 · **durationMs** 12_000
**Script:** `HSET user:1 name alice city hanoi` @0; `HGET user:1 name` @1500; `HGETALL user:1` @3000; `HINCRBY user:1 logins 1` @4500; `HDEL user:1 city` @6000; `HGETALL user:1` @7500.
**Narrative beats (4):** a hash stores many fields under one key, so one round trip fetches a whole object · `HGET` reads one field without transferring the rest — the reason to prefer a hash over a JSON string · `HINCRBY` makes a counter per field, still atomic · a TTL belongs to the key, never to a field: you cannot expire one field of a hash.
**Checkpoint** @9000: "Đặt TTL cho một field trong hash bằng cách nào?" → options: `HEXPIRE user:1 name 60`, `Không được — TTL chỉ gắn với key`, `EXPIRE user:1 name 60` → answer index 1.
**Must prove:** after `HDEL`, `HGETALL` returns exactly `['name', 'alice', 'logins', '1']`.

#### Task 12: Lesson 03 — `03-list.ts`, group `basics`

**Title:** `List: queue và stack` · **seed** 3 · **durationMs** 16_000
**Script:** `LPUSH jobs a` @0; `LPUSH jobs b` @1000; `LPUSH jobs c` @2000; `RPOP jobs` @3500 (queue: FIFO); `LPOP jobs` @5000 (stack: LIFO); `LRANGE jobs 0 -1` @6500; `BLPOP jobs 10` from `worker` @8000; `LPUSH jobs d` from `app` @11_000.
**Topology:** both clients.
**Narrative beats (5):** `LPUSH` + `RPOP` is a FIFO queue; `LPUSH` + `LPOP` is a LIFO stack — the same key, two data structures, chosen by which end you pop · a list has no consumer group and no ack: a popped element is gone, and a worker that crashes after popping loses it · `BLPOP` parks the client instead of polling · a push wakes exactly one blocked client, the one that waited longest · when the last element is popped, the key disappears — Redis keeps no empty collections.
**Checkpoint** @14_000: "Worker `BLPOP` xong rồi crash trước khi xử lý xong. Message đi đâu?" → options: `Redis requeue tự động`, `Mất — list không có ack`, `Vào dead-letter list` → answer index 1 → explanation contrasts with a RabbitMQ queue by name.
**Must prove:** at 8500ms `state.blocked` has one entry for `worker`; by 12_000ms it is empty, `keys['jobs']` is undefined, and the journal contains the completed `BLPOP` line.

#### Task 13: Lesson 04 — `04-set.ts`, group `basics`

**Title:** `Set` · **seed** 4 · **durationMs** 12_000
**Script:** `SADD online:mon ann bob cat` @0; `SADD online:tue bob cat dan` @1500; `SADD online:mon bob` @3000 (duplicate, returns 0); `SISMEMBER online:mon ann` @4500; `SINTER online:mon online:tue` @6000; `SCARD online:mon` @7500.
**Narrative beats (4):** a set stores each member once, so `SADD` is idempotent and dedup needs no read first · `SISMEMBER` is a membership test that does not transfer the set · `SINTER` computes the intersection inside Redis — the network never carries either set · real Redis gives no order guarantee for `SMEMBERS`; this simulator fixes insertion order so runs replay identically, and code must never depend on it.
**Checkpoint** @9000: "`SADD` một member đã có trả về gì?" → `(integer) 0`, `(integer) 1`, `(error)` → answer index 0.
**Must prove:** the `SINTER` journal line is `SINTER online:mon online:tue → 1) "bob" 2) "cat"`.

#### Task 14: Lesson 05 — `05-zset.ts`, group `basics`

**Title:** `Sorted Set: leaderboard` · **seed** 5 · **durationMs** 14_000
**Script:** `ZADD board 100 ann 250 bob 175 cat` @0; `ZREVRANGE board 0 2 WITHSCORES` @2000; `ZINCRBY board 200 ann` @4000; `ZREVRANGE board 0 2 WITHSCORES` @6000; `ZSCORE board cat` @8000; `ZCARD board` @9500.
**Narrative beats (4):** every member carries a score and the set stays sorted on write, so a leaderboard read is a range query, not a sort · `ZINCRBY` updates a score in place and the ordering follows immediately · `ZREVRANGE` reads the top N without scanning the rest · equal scores need a tie-break — this engine orders by member name so a run always replays identically.
**Checkpoint** @11_000: "Sau `ZINCRBY board 200 ann`, ai đứng đầu?" → `bob (250)`, `ann (300)`, `cat (175)` → answer index 1.
**Must prove:** the second `ZREVRANGE` journal line lists `ann` first with score `300`.

#### Task 15: Lesson 06 — `06-ttl.ts`, group `basics`

**Title:** `TTL: lazy và active expire` · **seed** 6 · **durationMs** 20_000
**Topology:** server with `activeExpireEveryMs: 5000` — a deliberately slow cycle, so the gap between the two mechanisms is visible on the canvas rather than theoretical.
**Script:** `SET session:1 tokenA EX 3` @0; `SET session:2 tokenB EX 3` @200; `TTL session:1` @1000; `GET session:1` @4000 — past the deadline, so lazy expire fires here and the reply is `(nil)`; `DBSIZE` @4500 — replies `(integer) 0`, because `DBSIZE` counts live keys and `session:2` is dead even though its record is still in memory; `TTL session:2` @5500 — replies `(integer) -2`; `SET session:3 tokenC` @7000; `TTL session:3` @8000 — replies `(integer) -1`; `PERSIST session:3` @9000 — replies `(integer) 0`, there was no TTL to remove.
**Narrative beats (5):** `EX` sets a deadline, `TTL` reports what is left · a key past its deadline is not removed at that instant — nothing in Redis is scheduled per key · the first command that touches it removes it lazily, which is why `GET` at 4000 both misses and frees the memory · the active cycle sweeps the rest in the background, sampling a bounded number of keys per pass, so a large keyspace drains over several passes · `TTL` of `-1` means no TTL and `-2` means no key — two different answers a caller must not confuse.
**Checkpoint** @16_000: "Key hết hạn lúc t=3000 nhưng không ai đọc. Lúc t=3500 memory đã được giải phóng chưa?" → options: `Rồi, Redis xoá đúng lúc hết hạn`, `Chưa chắc — chờ lazy read hoặc active cycle`, `Không bao giờ, phải DEL tay` → answer index 1.
**Must prove:** at 3500ms (before the first active pass at 5000) `keys['session:2']` still exists in state while `livesAt(state, 'session:2', 3500)` is false; after 5000ms it is gone and `metrics.expired` is 2.

#### Task 16: Lesson 07 — `07-scan.ts`, group `basics`

**Title:** `SCAN thay vì KEYS` · **seed** 7 · **durationMs** 16_000
**Script:** twelve `SET user:<n> v` at 0..2200 (200ms apart); `KEYS user:*` @3000; `SCAN 0 COUNT 5` @5000; `SCAN 5 COUNT 5` @7000; `SCAN 10 COUNT 5` @9000; `DBSIZE` @11_000.
**Narrative beats (4):** `KEYS` walks the entire keyspace in one blocking pass — fine with twelve keys, a production outage with ten million · `SCAN` returns a cursor and a bounded page, so the server stays responsive between pages · a cursor is not a snapshot: a key added or removed mid-scan may be missed or seen twice, so `SCAN` guarantees only that keys present for the whole scan appear at least once · this simulator's cursor is an index into insertion order, which is a simplification — real cursors are reverse-binary bucket cursors, and code must not depend on either.
**Checkpoint** @13_000: "`SCAN` đảm bảo gì?" → options: `Mỗi key xuất hiện đúng một lần`, `Key tồn tại suốt scan sẽ xuất hiện ít nhất một lần`, `Snapshot tại thời điểm bắt đầu` → answer index 1.
**Must prove:** the three `SCAN` replies together list all twelve keys, and the last one ends with cursor `0`.

#### Task 17: Lesson 08 — `08-cache-aside.ts`, group `cache`

**Title:** `Cache-aside` · **seed** 8 · **durationMs** 20_000
**Topology:** `APP`, `SERVER`, plus a third node representing the database — model it as a second client `{ id: 'db', label: 'Database', position: { x: 40, y: 40 } }` whose commands are the cache fills, so the round trip is visible on the canvas without inventing a node type.
**Script:** `GET product:7` @0 from `app` — miss; `SET product:7 "Bàn phím|450000" EX 30` @1500 from `db` — the fill after the database read; `GET product:7` @3500 from `app` — hit; `GET product:7` @5000 from `app` — hit; `SET product:7 "Bàn phím|399000" EX 30` @7000 from `app` — price changed, the cache is overwritten in the same breath as the database write; `GET product:7` @9000 from `app` — hit, and it returns the new price; `DEL product:7` @11_000 from `app` — explicit invalidation; `GET product:7` @13_000 from `app` — miss again.
**Narrative beats (5):** the application, not Redis, owns the pattern: read cache, on miss read the database, then write the cache · the TTL is the correctness budget — it bounds how stale a reader can be when nothing invalidates · a miss costs a database round trip *plus* two Redis round trips, so a cache with a poor hit rate is slower than no cache · explicit `DEL` on write is what keeps the cache honest between TTLs · `metrics.hits` and `metrics.misses` are the hit rate, and it is the only number that says whether the cache is earning its place.
**Checkpoint** @16_000: "Hit rate 20% thì cache-aside có đáng dùng không?" → options: `Có, cache luôn nhanh hơn`, `Không chắc — 80% request trả thêm 2 round trip Redis`, `Có, miễn là TTL đủ dài` → answer index 1.
**Must prove:** at 20_000ms `metrics.hits` is 3 and `metrics.misses` is 2.

#### Task 18: Lesson 09 — `09-write-through.ts`, group `cache`

**Title:** `Write-through và write-behind` · **seed** 9 · **durationMs** 20_000
**Topology:** `APP`, `WORKER` (the flusher), `SERVER`, plus `{ id: 'db', label: 'Database', position: { x: 40, y: 40 } }` standing in for the database round trip.
**Script:** write-through half — `SET order:1 pending` @0 from `app` (cache), `SET order:1 pending` @800 from `db` (the synchronous database write the caller also waits for), `GET order:1` @2000 from `app`. Write-behind half — `SET order:2 pending` @6000 from `app`, `LPUSH writeback order:2` @6200 from `app`, `GET order:2` @7000 from `app` (the cache already serves a value the database has never seen), `RPOP writeback` @9000 from `worker`, `SET order:2 pending` @9500 from `db` (the flusher finally persists it).
**Narrative beats (4):** write-through writes both stores before replying — the cache is never ahead of the database, and the write latency is the sum · write-behind replies as soon as Redis has it and lets a worker drain the queue — fast writes, and a window where the two stores disagree · that window is exactly how much data a crash can lose, and it is a product decision, not a technical one · the write-behind queue is itself a Redis list, so the earlier List lesson's warning applies: a crashed flusher loses whatever it had popped.
**Checkpoint** @16_000: "Write-behind mất dữ liệu khi nào?" → options: `Không bao giờ, Redis bền`, `Khi Redis hoặc worker chết trước lúc flush`, `Chỉ khi TTL hết hạn` → answer index 1.
**Must prove:** between 6200 and 9000ms, `keys['writeback']` holds exactly one element, and `GET order:2` at 7000 hits.

#### Task 19: Lesson 10 — `10-stampede.ts`, group `cache`

**Title:** `Cache stampede` · **seed** 10 · **durationMs** 22_000
**Topology:** `APP`, `WORKER`, plus a third client `{ id: 'app2', label: 'App 2', position: { x: 40, y: 200 } }` — three readers are the minimum that shows a stampede.
**Script:** `SET hot:key value EX 4` @0 from `app`; three `GET hot:key` at 5000, 5100, 5200 from `app`, `app2`, `worker` (all miss, the key died at 4000); then the guarded version — three `SETNX lock:hot:key 1` at 7000, 7100, 7200 from the same three clients, showing exactly one winning; `SET hot:key value2 EX 4` @8000 from the winner; `DEL lock:hot:key` @8200; `GET hot:key` @9000 from each of the three (all hit).
**Narrative beats (5):** one expired key plus N concurrent readers means N database queries for the same value — the stampede · the readers are not doing anything wrong; the miss is simultaneous because the expiry was · `SETNX` (or `SET key value NX`) elects exactly one rebuilder: the other readers back off · the lock needs its own TTL, or a rebuilder that dies takes the key hostage forever · TTL jitter attacks the same problem from the other side by making a thousand keys stop expiring at the same instant.
**Checkpoint** @18_000: "Vì sao lock rebuild bắt buộc phải có TTL riêng?" → options: `Để tiết kiệm memory`, `Vì rebuilder chết sẽ giữ lock vĩnh viễn`, `Vì Redis yêu cầu mọi key có TTL` → answer index 1.
**Must prove:** exactly one of the three `SETNX` replies is `(integer) 1` and the other two are `(integer) 0`; `metrics.misses` increases by 3 across the 5000–5200 window.

#### Task 20: Lesson 11 — `11-eviction.ts`, group `cache`

**Title:** `maxmemory và eviction policy` · **seed** 11 · **durationMs** 24_000
**Topology:** `APP`, `SERVER` with `maxmemoryBytes: 200` and `evictionPolicy: 'allkeys-lru'`. The tiny limit is deliberate: it makes eviction happen within a few keys instead of a few thousand, and the narrative says so.
**Script:** `SET a aaaaaaaa` @0; `SET b bbbbbbbb` @1000; `SET c cccccccc` @2000; `GET a` @3000 (refreshes a's LRU stamp); `SET d dddddddd` @4000 (evicts `b`, the least recently used); `KEYS *` @5500; then a policy switch — `CONFIG SET maxmemory-policy volatile-lru` @7000; `SET e eeeeeeee` @8000 (no key has a TTL, so this fails with OOM); `EXPIRE a 60` @10_000; `SET f ffffffff` @11_000 (now `a` is a candidate and the write succeeds); `KEYS *` @13_000; `INFO` @15_000.
**Narrative beats (5):** `maxmemory` is a ceiling, and reaching it forces a choice between refusing writes and deleting data · `allkeys-lru` deletes the coldest key, which is the right default for a pure cache · `volatile-*` policies only consider keys that carry a TTL, so a keyspace with no TTLs makes them behave exactly like `noeviction` · that is the failure that catches people: the policy is set, the memory is full, and every write returns OOM because nothing is eligible · eviction is not expiry: an evicted key was alive and got deleted for space, and `metrics.evicted` counts it separately from `metrics.expired` for that reason.
**Checkpoint** @19_000: "`volatile-lru` với keyspace không key nào có TTL thì sao?" → options: `Xoá key cũ nhất`, `Hoạt động như noeviction — write trả OOM`, `Xoá ngẫu nhiên một key` → answer index 1.
**Must prove:** the `SET e` reply is an OOM error and `metrics.evicted` is unchanged by it; the `SET f` reply is `OK` and `keys['a']` is gone.

---

### Task 21: Cross-lesson tests and the group behaviour suites

**Files:**
- Create: `src/brokers/redis/lessons/lessons.test.ts`
- Create: `src/brokers/redis/lessons/basics.test.ts`
- Create: `src/brokers/redis/lessons/cache.test.ts`
- Modify: `src/brokers/rabbitmq/lessons/language.test.ts` → move to `src/shell/lesson/language.test.ts` and run it over every broker

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `lessons.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { createRedisSimulation } from '../engine'
import { LESSONS } from './registry'

describe.each(LESSONS.map((l) => [l.id, l] as const))('%s', (_id, lesson) => {
  it('validates without a fatal issue', () => {
    const sim = createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    expect(sim.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('runs deterministically', () => {
    const run = () => {
      const sim = createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
      sim.advanceTo(lesson.durationMs)
      return sim.snapshot().journal
    }
    expect(run()).toEqual(run())
  })

  it('replies to every command it scripts', () => {
    const sim = createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs)
    expect(sim.snapshot().metrics.commands).toBe(lesson.script.length)
  })

  it('finishes inside its declared durationMs', () => {
    const sim = createRedisSimulation({ topology: lesson.topology, script: lesson.script, seed: lesson.seed })
    sim.advanceTo(lesson.durationMs)
    // Only the endless activeExpire tick may remain.
    expect(sim.snapshot().inFlight).toEqual([])
  })

  it('places every narrative step and checkpoint inside the run', () => {
    for (const step of lesson.narrative) expect(step.at).toBeLessThanOrEqual(lesson.durationMs)
    for (const check of lesson.checkpoints ?? []) expect(check.at).toBeLessThanOrEqual(lesson.durationMs)
  })

  it('highlights only node ids that exist', () => {
    const ids = new Set([...lesson.topology.clients.map((c) => c.id), lesson.topology.server.id])
    for (const step of lesson.narrative) for (const id of step.highlight ?? []) expect(ids.has(id)).toBe(true)
  })

  it('points every checkpoint answerIndex at a real option', () => {
    for (const check of lesson.checkpoints ?? []) {
      expect(check.answerIndex).toBeGreaterThanOrEqual(0)
      expect(check.answerIndex).toBeLessThan(check.options.length)
    }
  })
})

it('ships eleven lessons with unique ids', () => {
  expect(LESSONS).toHaveLength(11)
  expect(new Set(LESSONS.map((l) => l.id)).size).toBe(11)
})
```

- [ ] **Step 2: Write `basics.test.ts` and `cache.test.ts`**

Each contains one `describe` per lesson, holding the **Must prove** assertion stated in that lesson's task above. These were written incrementally in Tasks 10–20; this step is where they are reviewed together and any duplication is collapsed.

- [ ] **Step 3: Generalise the language test**

```bash
git mv src/brokers/rabbitmq/lessons/language.test.ts src/shell/lesson/language.test.ts
```

Change it to iterate `BROKERS` and each broker's `lessons`, keeping every existing rule (narrative bodies and summaries must be Vietnamese: diacritics present, no stray English connectives like `the`, `and`, `with`; titles may be English when they name the concept). Extend its allow-list of untranslated technical terms with the Redis vocabulary named in this plan's Global Constraints.

- [ ] **Step 4: Run everything**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all green. If the language test flags a lesson, fix the lesson copy, never the allow-list — the allow-list exists for terms of art, not for prose the author did not translate.

- [ ] **Step 5: Update the README**

Add Redis to the intro (the app now teaches two brokers), list the eleven lessons alongside the seventeen RabbitMQ ones, and note that Redis has lessons but no Sandbox yet.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test(redis): cross-lesson determinism, group behaviour, and shared language rules"
```

---

## Verification

- `npm test` — every test green, including all RabbitMQ tests untouched by this plan.
- `npm run typecheck`, `npm run lint`, `npm run build` — all exit 0.
- `npx vitest run src/shell/kernel/purity.test.ts` — passes with `src/brokers/redis/engine` discovered.
- `npm run dev`, then in the browser: the switcher shows RabbitMQ and Redis; selecting Redis loads `01-strings`; the keyspace panel fills as commands land; TTL counts down and a key vanishes on its lazy read; the eviction lesson visibly drops a key; no Sandbox button appears for Redis.
- `grep -rn "redis" src/shell/` returns nothing.

---

## Amendments

This plan was written while the multi-broker shell was still in progress. That
branch has since merged (`3b1349a`), and four things about the `BrokerModule`
contract changed after this plan's Task 9 was drafted. **`src/brokers/types.ts` at
HEAD is the authority.** Where Task 9's prose disagrees with these amendments,
the amendments win.

### Amendment 1 — `toFlow` is now `toNodes` + `toEdges`

The contract no longer has a single `toFlow`. It has:

```ts
  toNodes(topology: T, state: S, highlight?: string[]): Node[]
  toEdges(topology: T, script: A[]): Edge[]
```

They were split because nodes depend on the live simulation state and edges do
not, so fusing them rebuilt every edge on every tick and handed React Flow a new
`edges` array identity each frame. `CanvasView` now memoizes the two separately.

Task 8 already produces exactly the right pair of functions — `toFlowNodes` and
`toFlowEdges` — so this costs nothing. Two details:

- `toEdges` takes a `script` parameter that Redis has no use for: its edges come
  from the client list alone. Accept it and ignore it. Do **not** widen
  `toFlowEdges`'s own signature to take a script it will not read; adapt at the
  module boundary instead:
  `toEdges: (topology) => toFlowEdges(topology)`.
- Neither may return a fresh literal derived from something unstable — both land
  in a `useMemo`, and a new identity per call defeats the split.

### Amendment 2 — `metrics(state)` is a required slot

```ts
  metrics(state: S): Record<string, number>
```

The Inspector's metrics grid is driven generically by `Object.entries`, so each
broker names its own counters. Redis supplies its `RedisMetrics`.

**`metrics: (state) => state.metrics` will not compile.** `RedisMetrics` is
declared as an `interface`, and an interface gets no implicit index signature in
TypeScript, so it does not structurally satisfy `Record<string, number>` even
though every field is a number. Spread into a fresh object literal, exactly as
RabbitMQ does at `src/brokers/rabbitmq/index.ts:66`:

```ts
  metrics: (state) => ({ ...state.metrics }),
```

**Do not fix this with a cast.** A cast here is the defect two tasks on the shell
branch were sent back for. The spread is the fix.

### Amendment 3 — `NodeConfig` is a required slot

```ts
  NodeConfig: ComponentType<{ lesson: Lesson<T, A>; state: S; nodeId: string }>
```

The Inspector renders it whenever a canvas node is selected; there is no generic
shell fallback, so a broker without one does not compile. This plan never
mentioned it, which is why Task 8's file list above now includes
`src/brokers/redis/ui/NodeConfig.tsx`.

Keep it small and mirror `src/brokers/rabbitmq/ui/NodeConfig.tsx` in shape and
voice. Two branches suffice:

- **server selected** — `maxmemoryBytes`, `evictionPolicy`, `activeExpireEveryMs`,
  and the live `keysCount` / `memoryUsed`, taking the spec fields from
  `lesson.topology.server` and the live numbers from `state`.
- **client selected** — the client's label, and how many commands it has issued.

Anything else falls back to the Vietnamese `Node này không có cấu hình.`, matching
RabbitMQ's wording verbatim.

`ExportDialog` stays **absent**: it is optional, and Redis code export belongs to
the sandbox plan. The Inspector already hides the "Xuất code" button for a broker
that ships without one, and there is a test covering exactly that.

### Amendment 4 — Redis must also be added to `catalog.ts`

`src/brokers/catalog.ts` is a second, deliberately separate registration: plain
broker facts (`id`, `label`, `defaultLessonId`) that the Zustand store reads at
module-evaluation time. It exists because the store must not import
`registry.ts` — that cycle resolved to `undefined` at runtime rather than
throwing, which is a failure mode worth never meeting twice.

Registering Redis in `registry.ts` alone leaves `catalogEntry('redis')` silently
falling back to RabbitMQ, so the switcher would appear to work while the store
stayed on the wrong broker. Task 9 must add:

```ts
  { id: 'redis', label: 'Redis', defaultLessonId: '01-strings' },
```

The `label` and `defaultLessonId` must match the module's exactly. Add a Task 9
test asserting that agreement for **every** broker, so the two registrations can
never drift:

```ts
it('registers every broker in the catalog with matching facts', () => {
  for (const broker of BROKERS) {
    const entry = BROKER_CATALOG.find((b) => b.id === broker.id)
    expect(entry, `${broker.id} is in BROKERS but missing from BROKER_CATALOG`).toBeDefined()
    expect(entry!.label).toBe(broker.label)
    expect(entry!.defaultLessonId).toBe(broker.defaultLessonId)
  }
})
```

Falsify it by changing one field in the catalog and confirming it goes red.

### Amendment 5 — never `git add -A`

Every task's commit step stages explicit paths.
`.claude/scheduled_tasks.lock` is unrelated noise that has been left unstaged in
every commit on this project; a bare `-A` sweeps it in.
