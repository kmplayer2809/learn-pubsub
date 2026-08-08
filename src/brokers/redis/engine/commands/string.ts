import { deleteKey, readKey, writeKey } from '../keyspace'
import type { CommandContext, CommandHandler, CommandResult } from '../reply'
import { oomReply, wrongTypeReply } from '../reply'

/**
 * `SET key value [EX seconds | PX ms] [NX | XX] [KEEPTTL]`.
 *
 * Unlike GET/INCR, SET never checks the existing value's type — real Redis
 * lets SET clobber a list, hash, set or zset just as freely as a string, so
 * there is no WRONGTYPE case here.
 */
const set: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, value, ...opts] = context.args

  let exSeconds: number | undefined
  let pxMillis: number | undefined
  let nx = false
  let xx = false
  let keepTtl = false
  for (let i = 0; i < opts.length; i++) {
    const token = opts[i]!.toUpperCase()
    if (token === 'EX') exSeconds = Number(opts[++i])
    else if (token === 'PX') pxMillis = Number(opts[++i])
    else if (token === 'NX') nx = true
    else if (token === 'XX') xx = true
    else if (token === 'KEEPTTL') keepTtl = true
  }

  // Route the existence check through readKey (never `state.keys` directly) so
  // lazy expiry and hit/miss counting stay centralised, per the engine's rules.
  const { state: afterRead, record } = readKey(context.state, key!)
  if (nx && record) return { state: afterRead, reply: { kind: 'nil' } }
  if (xx && !record) return { state: afterRead, reply: { kind: 'nil' } }

  const expiresAt =
    exSeconds !== undefined ? afterRead.now + exSeconds * 1000 : pxMillis !== undefined ? afterRead.now + pxMillis : undefined

  const result = writeKey(afterRead, key!, { type: 'string', value: value! }, { keepTtl, expiresAt })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'status', value: 'OK' } }
}

/** `GET key` — nil for a missing key, WRONGTYPE for a non-string one. */
const get: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!)
  if (!record) return { state, reply: { kind: 'nil' } }
  if (record.value.type !== 'string') return { state, reply: wrongTypeReply() }
  return { state, reply: { kind: 'bulk', value: record.value.value } }
}

/**
 * `INCR key` — creates the key at 1 when absent, otherwise parses the
 * existing string as a base-10 integer and adds one. `keepTtl: true` on the
 * write because incrementing a key must not clear a TTL a caller already set.
 */
const incr: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  // Narrowed through a plain local rather than the `record.value.type` chain
  // directly: TS does not retain discriminated-union narrowing on a nested
  // property path across a later re-test of the same chain.
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'string') return { state: afterRead, reply: wrongTypeReply() }

  const current = existingValue ? existingValue.value : '0'
  if (!/^-?\d+$/.test(current)) {
    return { state: afterRead, reply: { kind: 'error', value: 'ERR value is not an integer or out of range' } }
  }

  const next = Number(current) + 1
  const result = writeKey(afterRead, key!, { type: 'string', value: String(next) }, { keepTtl: true })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: next } }
}

/** `DEL key [key ...]` — returns how many of the given keys were actually live. */
const del: CommandHandler = (context: CommandContext): CommandResult => {
  let working = context.state
  let removed = 0
  for (const key of context.args) {
    // readKey first: a key past its deadline is already gone (lazy expiry),
    // and must not be double-counted as a fresh deletion.
    const { state: afterRead, record } = readKey(working, key)
    working = afterRead
    if (!record) continue
    working = deleteKey(working, key).state
    removed++
  }
  return { state: working, reply: { kind: 'integer', value: removed } }
}

/** `SETNX key value` — writes only when the key does not already exist. */
const setnx: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, value] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  if (record) return { state: afterRead, reply: { kind: 'integer', value: 0 } }

  const result = writeKey(afterRead, key!, { type: 'string', value: value! })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: 1 } }
}

export const handlers = {
  SET: set,
  GET: get,
  INCR: incr,
  DEL: del,
  SETNX: setnx,
} satisfies Record<string, CommandHandler>
