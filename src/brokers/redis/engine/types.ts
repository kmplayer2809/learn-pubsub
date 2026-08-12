import type { KernelState } from '../../../shell/kernel/types'

export type NodeId = string

export type RedisValue =
  | { type: 'string'; value: string }
  | { type: 'hash'; value: Record<string, string> }
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
