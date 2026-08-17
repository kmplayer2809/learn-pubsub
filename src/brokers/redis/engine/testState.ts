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
    keyVersions: {},
  }
}
