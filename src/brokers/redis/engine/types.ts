import type { KernelState } from '../../../shell/kernel/types'

export type NodeId = string

export type RedisValue =
  | { type: 'string'; value: string }
  | { type: 'hash'; value: Record<string, string>; fieldOrder: string[] }
  | { type: 'list'; value: string[] }
  | { type: 'set'; value: string[] } // insertion-ordered for determinism
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
  /** Absent means "no persistence configured": a crash loses everything.
   *  `rdb.everySec` models Redis' periodic snapshot; `aof` models the
   *  append-only file's fsync policy. A server declares at most one of
   *  these two in a given lesson — see `engine/index.ts`'s `snapshotWrite`
   *  scheduling for how the interval is picked. */
  persistence?: {
    rdb?: { everySec: number }
    aof?: 'always' | 'everysec' | 'no'
  }
}

export interface RedisClientSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
}

export interface RedisReplicaSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
  /** Virtual ms between a write landing on the primary and reaching this replica. */
  lagMs: number
}

export interface RedisSentinelSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
}

export interface RedisTopology {
  clients: RedisClientSpec[]
  server: RedisServerSpec
  replicas?: RedisReplicaSpec[]
  sentinels?: RedisSentinelSpec[]
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

export type RedisEventType =
  | 'command' | 'reply' | 'activeExpire' | 'evict' | 'unblock'
  | 'snapshotWrite' | 'crash' | 'restart' | 'replicate' | 'sentinelFailover'

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
  /**
   * The full original command arguments, including the trailing timeout —
   * `keys` deliberately drops it (see `commands/list.ts`'s `blpop`), but the
   * kernel wiring that journals the completed BLPOP once a push wakes this
   * client needs the exact text the client typed, timeout included.
   */
  args: string[]
  since: number
  commandId: string
  /**
   * Absolute virtual-ms deadline, or undefined when the client asked to block
   * forever (BLPOP's timeout argument of 0). Parsed at park time because
   * `args` holds the raw seconds string the client typed.
   */
  timeoutAt?: number
}

/** A full-keyspace snapshot, captured by the `snapshotWrite` event and
 *  restored by `crash` when the server has no `persistence.aof: 'always'`. */
export interface RedisSnapshot {
  keys: Record<string, KeyRecord>
  keyOrder: string[]
  keyVersions: Record<string, number>
  writeCounter: number
}

export interface QueuedCommand {
  name: string
  args: string[]
}

export interface WatchedKey {
  key: string
  version: number
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
  /** Monotonic per-key counter, bumped on every write, delete, eviction, and
   *  lazy-expiry removal. Never reset when a key is deleted — WATCH stores a
   *  key's version at watch time and EXEC compares it against this map, so a
   *  delete-then-recreate must still read as "changed" even though the new
   *  KeyRecord itself starts fresh. */
  keyVersions: Record<string, number>
  /** Presence of a `clientId` entry (even an empty array) means that client is
   *  between MULTI and EXEC/DISCARD. `engine/index.ts`'s `applyReply` checks
   *  this before dispatching a command. */
  txQueues: Record<string, QueuedCommand[]>
  watched: Record<string, WatchedKey[]>
  /** How many writes (SET/DEL/eviction/lazy-expiry — anything `touchKey` sees)
   *  the primary has applied since the run started. Compared against each
   *  replica's `replicaState[id].appliedWriteCounter` to show lag. */
  writeCounter: number
  replicaState: Record<NodeId, { appliedWriteCounter: number }>
  /** Which node id is currently treated as primary. Starts as `topology.server.id`;
   *  a `sentinelFailover` fault can repoint it at a replica id. */
  primaryId: NodeId
  lastSnapshot?: RedisSnapshot
  primaryDown: boolean
}
