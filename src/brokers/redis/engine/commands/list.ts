import { deleteKey, readKey, writeKey } from '../keyspace'
import type { CommandContext, CommandHandler, CommandResult } from '../reply'
import { oomReply, wrongTypeReply } from '../reply'
import type { BlockedClient, RedisState } from '../types'

/**
 * Resolves `LRANGE`/`ZRANGE`-style `start`/`stop` arguments — Redis allows
 * negative indices counting from the end, `-1` being the last element — into
 * an inclusive `[start, stop]` pair of real array indices, or `null` when the
 * requested slice is empty or out of range. Redis replies with an empty array
 * in that case, never an error.
 */
function resolveRange(length: number, startArg: string, stopArg: string): [number, number] | null {
  if (length === 0) return null
  let start = Number(startArg)
  let stop = Number(stopArg)
  if (start < 0) start = Math.max(length + start, 0)
  if (stop < 0) stop = length + stop
  stop = Math.min(stop, length - 1)
  if (start > stop) return null
  return [start, stop]
}

/** `LPUSH key value [value ...]` — each value in turn becomes the new head, so the last value listed ends up first. */
const lpush: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, ...values] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'list') return { state: afterRead, reply: wrongTypeReply() }

  let list: string[] = existingValue && existingValue.type === 'list' ? existingValue.value : []
  for (const value of values) list = [value, ...list]

  const result = writeKey(afterRead, key!, { type: 'list', value: list })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: list.length } }
}

/** `RPUSH key value [value ...]` — appended in the order given, tail-first. */
const rpush: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, ...values] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'list') return { state: afterRead, reply: wrongTypeReply() }

  const base: string[] = existingValue && existingValue.type === 'list' ? existingValue.value : []
  const list = [...base, ...values]

  const result = writeKey(afterRead, key!, { type: 'list', value: list })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: list.length } }
}

/** `LPOP key` — pops the head; nil for a missing key; deletes the key once the last element is gone. */
const lpop: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  if (!record) return { state: afterRead, reply: { kind: 'nil' } }
  if (record.value.type !== 'list') return { state: afterRead, reply: wrongTypeReply() }

  const [popped, ...rest] = record.value.value
  const state = rest.length === 0 ? deleteKey(afterRead, key!).state : writeKey(afterRead, key!, { type: 'list', value: rest }).state
  return { state, reply: { kind: 'bulk', value: popped! } }
}

/** `RPOP key` — pops the tail; same nil/delete rules as LPOP. */
const rpop: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  if (!record) return { state: afterRead, reply: { kind: 'nil' } }
  if (record.value.type !== 'list') return { state: afterRead, reply: wrongTypeReply() }

  const list = record.value.value
  const popped = list[list.length - 1]!
  const rest = list.slice(0, -1)
  const state = rest.length === 0 ? deleteKey(afterRead, key!).state : writeKey(afterRead, key!, { type: 'list', value: rest }).state
  return { state, reply: { kind: 'bulk', value: popped } }
}

/** `LRANGE key start stop` — inclusive slice; negative indices count from the end; out-of-range yields `[]`. */
const lrange: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, startArg, stopArg] = context.args
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'array', value: [] } }
  if (record.value.type !== 'list') return { state, reply: wrongTypeReply() }

  const list = record.value.value
  const range = resolveRange(list.length, startArg!, stopArg!)
  return { state, reply: { kind: 'array', value: range ? list.slice(range[0], range[1] + 1) : [] } }
}

/** `LLEN key` — 0 for a missing key. */
const llen: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'list') return { state, reply: wrongTypeReply() }
  return { state, reply: { kind: 'integer', value: record.value.value.length } }
}

/**
 * `BLPOP key [key ...] timeout` — pops the first non-empty list among the
 * given keys, leftmost key first, exactly like `LPOP` on that key. When every
 * named key is empty or missing, there is nothing to pop synchronously: the
 * client is parked on `state.blocked` instead. Waking it when a later push
 * targets one of these keys is Task 7's `unblock` wiring — this handler only
 * records the block and replies nil; it never actually suspends anything (the
 * engine is a pure step function, so there is no thread to suspend).
 */
const blpop: CommandHandler = (context: CommandContext): CommandResult => {
  const keys = context.args.slice(0, -1)

  let working = context.state
  for (const key of keys) {
    const { state: afterRead, record } = readKey(working, key, 'write')
    working = afterRead
    if (!record) continue
    if (record.value.type !== 'list') return { state: working, reply: wrongTypeReply() }
    if (record.value.value.length === 0) continue // empty lists are deleted, but guard anyway

    const [popped, ...rest] = record.value.value
    working = rest.length === 0 ? deleteKey(working, key).state : writeKey(working, key, { type: 'list', value: rest }).state
    return { state: working, reply: { kind: 'array', value: [key, popped!] } }
  }

  // BLPOP's timeout is seconds, possibly fractional, with 0 meaning "block
  // forever" — real Redis semantics this engine matches. A timeout that does
  // not parse as a finite non-negative number is malformed input; that gets
  // reported by validate.ts, not here, so a running simulation treats it as
  // block-forever rather than throwing over it.
  const timeoutArg = context.args[context.args.length - 1]!
  const parsedTimeout = Number(timeoutArg)
  const timeoutAt =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? working.now + parsedTimeout * 1000 : undefined

  const blockedClient: BlockedClient = {
    clientId: context.clientId,
    keys,
    args: context.args,
    since: working.now,
    commandId: String(working.commandCounter),
    timeoutAt,
  }
  const nextState: RedisState = {
    ...working,
    commandCounter: working.commandCounter + 1,
    blocked: [...working.blocked, blockedClient],
  }
  return { state: nextState, reply: { kind: 'nil' }, parked: true }
}

export const handlers = {
  LPUSH: lpush,
  RPUSH: rpush,
  LPOP: lpop,
  RPOP: rpop,
  LRANGE: lrange,
  LLEN: llen,
  BLPOP: blpop,
} satisfies Record<string, CommandHandler>
