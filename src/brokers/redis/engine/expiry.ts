import { deleteKey } from './keyspace'
import type { RedisEventType, RedisState } from './types'
import type { SimEvent } from '../../../shell/kernel/types'

/**
 * How many `keyOrder` entries one active-expire pass inspects. Real Redis'
 * own cycle samples a fixed batch (its default is also 20) rather than
 * walking the whole keyspace on every wakeup, and this constant is that
 * same idea: a fixed sample size, not a fraction of however many keys exist.
 */
export const ACTIVE_EXPIRE_SAMPLE = 20

/** Real Redis' own default gap between active-expire passes, in ms. */
const DEFAULT_ACTIVE_EXPIRE_EVERY_MS = 100

/**
 * The active expire cycle. It wakes up on a timer and inspects only the
 * first `ACTIVE_EXPIRE_SAMPLE` entries of `keyOrder`, deleting whichever of
 * those have already passed their deadline.
 *
 * Sampling the *head* of `keyOrder` — rather than drawing indices at random,
 * the way real Redis' `activeExpireCycleTryExpire` does — is a deliberate
 * simplification: it keeps this cycle deterministic without threading the
 * rng through it. It still teaches the lesson this task exists for: a
 * keyspace bigger than one sample does not drain in a single pass, so an
 * expired key can sit present-but-dead for a while, occupying memory and
 * still counted in `keysCount`, until a later pass (or a lazy `readKey`
 * access) finally removes it. That gap is the point — an active cycle that
 * swept every key at once would erase the very phenomenon this lesson is
 * about.
 */
export function applyActiveExpire(
  state: RedisState,
  _event: SimEvent<RedisEventType>,
): { state: RedisState; newEvents: SimEvent<RedisEventType>[] } {
  const sample = state.keyOrder.slice(0, ACTIVE_EXPIRE_SAMPLE)

  let working = state
  for (const key of sample) {
    const record = working.keys[key]
    // Already gone (shouldn't happen within one pass, since each iteration
    // deletes at most the key it is looking at) or has no TTL at all.
    if (!record || record.expiresAt === undefined || record.expiresAt >= working.now) continue

    const deleted = deleteKey(working, key)
    working = {
      ...deleted.state,
      metrics: { ...deleted.state.metrics, expired: deleted.state.metrics.expired + 1 },
      journal: [...deleted.state.journal, { at: working.now, type: 'activeExpire', text: `# active expire removed ${key}` }],
    }
  }

  // Always reschedule, whether or not this pass found anything to remove —
  // the cycle is a heartbeat, not a one-shot triggered by expired keys.
  const everyMs = working.topology.server.activeExpireEveryMs ?? DEFAULT_ACTIVE_EXPIRE_EVERY_MS
  const nextEvent: SimEvent<RedisEventType> = {
    at: working.now + everyMs,
    seq: working.seq + 1,
    type: 'activeExpire',
    payload: {},
  }
  working = { ...working, seq: working.seq + 1 }

  return { state: working, newEvents: [nextEvent] }
}
