import { keySlot } from '../crc16'
import type { CommandContext, CommandHandler, CommandResult, Reply } from '../reply'
import type { EvictionPolicy, RedisServerSpec, RedisState } from '../types'

/**
 * Declared as a `Record` keyed by `EvictionPolicy` rather than a plain array of
 * strings: adding a policy to the union in `types.ts` without adding it here is
 * then a compile error, instead of a policy the eviction path understands but
 * `CONFIG SET` silently rejects.
 */
const POLICIES: Record<EvictionPolicy, true> = {
  noeviction: true,
  'allkeys-lru': true,
  'allkeys-lfu': true,
  'volatile-lru': true,
  'volatile-ttl': true,
  'allkeys-random': true,
}

function isEvictionPolicy(value: string): value is EvictionPolicy {
  return Object.hasOwn(POLICIES, value)
}

function withServer(state: RedisState, patch: Partial<RedisServerSpec>): RedisState {
  return { ...state, topology: { ...state.topology, server: { ...state.topology.server, ...patch } } }
}

/** Real Redis reports "no limit" as the number 0, not as an absent value. */
function maxmemoryString(server: RedisServerSpec): string {
  return String(server.maxmemoryBytes ?? 0)
}

function policyOf(server: RedisServerSpec): EvictionPolicy {
  return server.evictionPolicy ?? 'noeviction'
}

function configError(message: string): Reply {
  return { kind: 'error', value: `ERR ${message}` }
}

/**
 * `CONFIG SET <param> <value>` / `CONFIG GET <param>`, restricted to the two
 * parameters this simulation actually acts on: `maxmemory-policy` and
 * `maxmemory`. Every other parameter is refused rather than accepted and
 * ignored — a lesson that sets `appendonly yes` and gets `OK` back would be
 * teaching that this simulator persists to disk, which it does not.
 *
 * The change lands on `state.topology.server`, which is where `evictionVictims`
 * (memory.ts) reads the policy and the budget from, so it takes effect on the
 * next write and no sooner. That matches real Redis: lowering `maxmemory` below
 * current usage does not evict anything at the instant of the CONFIG call, it
 * evicts when the next write asks for room.
 *
 * `topology` arrives from outside the simulation — it is the lesson's own object,
 * which the shell hands to every run — so this replaces it copy-on-write like the
 * rest of the state rather than mutating in place. Mutating would leak one run's
 * CONFIG into the next replay of the same lesson and break determinism in the
 * one way a seeded rng cannot protect against.
 */
const config: CommandHandler = (context: CommandContext): CommandResult => {
  const [subcommand, param, value] = context.args
  const sub = subcommand?.toUpperCase()

  if (sub === 'GET') {
    const server = context.state.topology.server
    if (param === 'maxmemory-policy') {
      return { state: context.state, reply: { kind: 'array', value: ['maxmemory-policy', policyOf(server)] } }
    }
    if (param === 'maxmemory') {
      return { state: context.state, reply: { kind: 'array', value: ['maxmemory', maxmemoryString(server)] } }
    }
    return { state: context.state, reply: configError(`Unknown CONFIG parameter '${param}'`) }
  }

  if (sub === 'SET') {
    if (param === 'maxmemory-policy') {
      if (value === undefined || !isEvictionPolicy(value)) {
        return { state: context.state, reply: configError(`Invalid argument '${value}' for CONFIG SET 'maxmemory-policy'`) }
      }
      return { state: withServer(context.state, { evictionPolicy: value }), reply: { kind: 'status', value: 'OK' } }
    }
    if (param === 'maxmemory') {
      const bytes = Number(value)
      if (!Number.isFinite(bytes) || bytes < 0) {
        return { state: context.state, reply: configError(`Invalid argument '${value}' for CONFIG SET 'maxmemory'`) }
      }
      // 0 means "no limit" on the wire, and `maxmemoryBytes: undefined` is how
      // this engine spells that — `evictionVictims` returns early on undefined.
      return {
        state: withServer(context.state, { maxmemoryBytes: bytes === 0 ? undefined : bytes }),
        reply: { kind: 'status', value: 'OK' },
      }
    }
    return { state: context.state, reply: configError(`Unknown CONFIG parameter '${param}'`) }
  }

  return { state: context.state, reply: configError(`Unknown CONFIG subcommand '${subcommand}'`) }
}

/**
 * `INFO` — the memory and stats fields a cache lesson actually reasons about,
 * under their real Redis names so a learner can find the same numbers in a real
 * server.
 *
 * Real `INFO` is a multi-line bulk string spanning a dozen sections. This returns
 * one `status` line instead, for two reasons: the journal is a line-per-command
 * transcript and a fifteen-line reply would bury every command around it, and a
 * `bulk` reply would come back wrapped in quotes (see `formatReply`), which is
 * not how redis-cli prints INFO either. The field *names* are the teaching
 * content; the layout is this simulator's own.
 */
const info: CommandHandler = (context: CommandContext): CommandResult => {
  const { metrics, topology } = context.state
  const fields = [
    `used_memory:${metrics.memoryUsed}`,
    `maxmemory:${maxmemoryString(topology.server)}`,
    `maxmemory_policy:${policyOf(topology.server)}`,
    `keyspace_hits:${metrics.hits}`,
    `keyspace_misses:${metrics.misses}`,
    `expired_keys:${metrics.expired}`,
    `evicted_keys:${metrics.evicted}`,
    `db0:keys=${metrics.keysCount}`,
  ]
  return { state: context.state, reply: { kind: 'status', value: fields.join(' ') } }
}

/**
 * `CLUSTER KEYSLOT key` — the hash slot `key` would live on in a real
 * Cluster deployment. Nothing in this simulation actually shards data
 * across slots; this is a pure, informational computation.
 */
const cluster: CommandHandler = (context: CommandContext): CommandResult => {
  const [subcommand, key] = context.args
  const sub = subcommand?.toUpperCase()
  if (sub === 'KEYSLOT') {
    if (key === undefined) return { state: context.state, reply: configError("wrong number of arguments for 'cluster|keyslot' command") }
    return { state: context.state, reply: { kind: 'integer', value: keySlot(key) } }
  }
  return { state: context.state, reply: configError(`Unknown CLUSTER subcommand '${subcommand}'`) }
}

export const handlers = {
  CONFIG: config,
  INFO: info,
  CLUSTER: cluster,
} satisfies Record<string, CommandHandler>
