import { livesAt, readKey, writeKey } from '../keyspace'
import type { CommandContext, CommandHandler, CommandResult } from '../reply'

/**
 * `EXPIRE key seconds` — stamps a new deadline, relative to `state.now`, on
 * an existing key. `writeKey` is handed the record's own current value back
 * unchanged, so `sizeOf` recomputes to the same byte count and the `delta >
 * 0` eviction path never runs for a command that never grows anything.
 */
const expire: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, secondsArg] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  if (!record) return { state: afterRead, reply: { kind: 'integer', value: 0 } }

  const expiresAt = afterRead.now + Number(secondsArg) * 1000
  const result = writeKey(afterRead, key!, record.value, { expiresAt })
  return { state: result.state, reply: { kind: 'integer', value: 1 } }
}

/** `TTL key` — remaining seconds, `-1` with no TTL, `-2` when the key is gone. */
const ttl: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!)
  if (!record) return { state, reply: { kind: 'integer', value: -2 } }
  if (record.expiresAt === undefined) return { state, reply: { kind: 'integer', value: -1 } }
  // Round up: a key with 500ms left still reads as "1 second remaining" rather
  // than the more alarming "0 seconds", matching real Redis TTL's rounding.
  const remainingSeconds = Math.ceil((record.expiresAt - state.now) / 1000)
  return { state, reply: { kind: 'integer', value: remainingSeconds } }
}

/** `PERSIST key` — clears a TTL; returns `1` only when there was one to clear. */
const persist: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  if (!record || record.expiresAt === undefined) return { state: afterRead, reply: { kind: 'integer', value: 0 } }

  // No `expiresAt` and no `keepTtl` in the write opts: writeKey's default is
  // exactly "drop the TTL", which is what PERSIST asks for.
  const result = writeKey(afterRead, key!, record.value)
  return { state: result.state, reply: { kind: 'integer', value: 1 } }
}

/** `EXISTS key [key ...]` — counts only keys that are still live, once per argument. */
const exists: CommandHandler = (context: CommandContext): CommandResult => {
  let working = context.state
  let count = 0
  for (const key of context.args) {
    const { state: afterRead, record } = readKey(working, key)
    working = afterRead
    if (record) count++
  }
  return { state: working, reply: { kind: 'integer', value: count } }
}

/** `TYPE key` — the value's type name, or `none` for a missing (or expired) key. */
const type: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!)
  return { state, reply: { kind: 'status', value: record ? record.value.type : 'none' } }
}

/**
 * `KEYS pattern`, `SCAN cursor [COUNT n]` and `DBSIZE` all enumerate the
 * keyspace rather than access one key, so — unlike every handler above —
 * they filter with `livesAt` instead of `readKey`: bulk enumeration has no
 * business bumping the hit/miss counters or lazily expiring every key it
 * merely glances at.
 */

/** `*` and `?` only, compiled to a RegExp by escaping every other character. */
function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (const ch of pattern) {
    if (ch === '*') source += '.*'
    else if (ch === '?') source += '.'
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

/** `KEYS pattern` — every live key matching the glob, in `keyOrder` (insertion order). */
const keys: CommandHandler = (context: CommandContext): CommandResult => {
  const [pattern] = context.args
  const regex = globToRegExp(pattern!)
  const matches = context.state.keyOrder.filter((key) => livesAt(context.state, key, context.state.now) && regex.test(key))
  return { state: context.state, reply: { kind: 'array', value: matches } }
}

/**
 * `SCAN cursor [COUNT n]` — paginates `keyOrder` using the cursor as a plain
 * index to resume at. This is a teaching simplification, not how real Redis
 * cursors work: production Redis uses a reverse-binary bucket cursor so that
 * pagination stays correct even while the hash table resizes mid-scan. This
 * simulation's keyspace never rehashes, so an index is enough to demonstrate
 * SCAN's cursor-based pagination contract — but a learner should not walk
 * away assuming this *is* Redis's actual cursor scheme.
 */
const scan: CommandHandler = (context: CommandContext): CommandResult => {
  const [cursorArg, ...opts] = context.args
  let count = 10
  for (let i = 0; i < opts.length; i++) {
    if (opts[i]!.toUpperCase() === 'COUNT') count = Number(opts[++i])
  }

  const cursor = Number(cursorArg)
  const page = context.state.keyOrder.slice(cursor, cursor + count)
  const liveKeys = page.filter((key) => livesAt(context.state, key, context.state.now))
  const nextCursor = cursor + count >= context.state.keyOrder.length ? 0 : cursor + count

  return { state: context.state, reply: { kind: 'array', value: [String(nextCursor), ...liveKeys] } }
}

/** `DBSIZE` — the number of live keys. */
const dbsize: CommandHandler = (context: CommandContext): CommandResult => {
  const count = context.state.keyOrder.filter((key) => livesAt(context.state, key, context.state.now)).length
  return { state: context.state, reply: { kind: 'integer', value: count } }
}

export const handlers = {
  EXPIRE: expire,
  TTL: ttl,
  PERSIST: persist,
  EXISTS: exists,
  TYPE: type,
  KEYS: keys,
  SCAN: scan,
  DBSIZE: dbsize,
} satisfies Record<string, CommandHandler>
