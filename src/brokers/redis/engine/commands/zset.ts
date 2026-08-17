import { deleteKey, readKey, writeKey } from '../keyspace'
import type { CommandContext, CommandHandler, CommandResult } from '../reply'
import { oomReply, wrongTypeReply } from '../reply'

type ZEntry = { member: string; score: number }

/**
 * Redis orders a sorted set by score ascending, ties broken by member name
 * lexicographically — that is the one true iteration order ZRANGE (and,
 * reversed, ZREVRANGE) present. This is computed fresh from whatever order
 * ZADD happened to leave the backing array in; storage order is never
 * treated as iteration order.
 */
function sortedAscending(entries: ZEntry[]): ZEntry[] {
  return [...entries].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.member < b.member) return -1
    if (a.member > b.member) return 1
    return 0
  })
}

/**
 * Resolves `ZRANGE`/`ZREVRANGE`-style `start`/`stop` arguments — negative
 * indices count from the end, `-1` being the last element — into an
 * inclusive `[start, stop]` pair of real array indices, or `null` when the
 * requested slice is empty or out of range. Redis replies with an empty
 * array in that case, never an error.
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

/**
 * `ZADD key score member [score member ...]` — creates or updates members.
 * The integer reply counts only members that did NOT already exist, matching
 * real Redis's default ZADD return value (the CH flag is not modelled — no
 * learner-facing lesson on this plan needs it).
 */
const zadd: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, ...pairs] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'zset') return { state: afterRead, reply: wrongTypeReply() }

  const entries: ZEntry[] = existingValue && existingValue.type === 'zset' ? [...existingValue.value] : []
  let added = 0
  for (let i = 0; i < pairs.length; i += 2) {
    const score = Number(pairs[i])
    const member = pairs[i + 1]!
    const index = entries.findIndex((entry) => entry.member === member)
    if (index === -1) {
      entries.push({ member, score })
      added++
    } else {
      entries[index] = { member, score }
    }
  }

  const result = writeKey(afterRead, key!, { type: 'zset', value: entries })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: added } }
}

/** `ZINCRBY key increment member` — creates the member at `increment` when absent. */
const zincrby: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, incrementArg, member] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'zset') return { state: afterRead, reply: wrongTypeReply() }

  const entries: ZEntry[] = existingValue && existingValue.type === 'zset' ? [...existingValue.value] : []
  const index = entries.findIndex((entry) => entry.member === member)
  const current = index === -1 ? 0 : entries[index]!.score
  const next = current + Number(incrementArg)
  if (index === -1) entries.push({ member: member!, score: next })
  else entries[index] = { member: member!, score: next }

  const result = writeKey(afterRead, key!, { type: 'zset', value: entries })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'bulk', value: String(next) } }
}

/**
 * `ZRANGE key start stop [WITHSCORES]` — ascending by score. Negative
 * indices count from the end; an out-of-range slice yields an empty array.
 */
const zrange: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, startArg, stopArg, ...opts] = context.args
  const withScores = opts.some((opt) => opt.toUpperCase() === 'WITHSCORES')
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'array', value: [] } }
  if (record.value.type !== 'zset') return { state, reply: wrongTypeReply() }

  const ordered = sortedAscending(record.value.value)
  const range = resolveRange(ordered.length, startArg!, stopArg!)
  const slice = range ? ordered.slice(range[0], range[1] + 1) : []
  const value = withScores ? slice.flatMap((entry) => [entry.member, String(entry.score)]) : slice.map((entry) => entry.member)
  return { state, reply: { kind: 'array', value } }
}

/** `ZREVRANGE key start stop [WITHSCORES]` — descending by score, i.e. ZRANGE's order reversed. */
const zrevrange: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, startArg, stopArg, ...opts] = context.args
  const withScores = opts.some((opt) => opt.toUpperCase() === 'WITHSCORES')
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'array', value: [] } }
  if (record.value.type !== 'zset') return { state, reply: wrongTypeReply() }

  const ordered = sortedAscending(record.value.value).reverse()
  const range = resolveRange(ordered.length, startArg!, stopArg!)
  const slice = range ? ordered.slice(range[0], range[1] + 1) : []
  const value = withScores ? slice.flatMap((entry) => [entry.member, String(entry.score)]) : slice.map((entry) => entry.member)
  return { state, reply: { kind: 'array', value } }
}

/** `ZSCORE key member` — nil when the key or the member is missing. */
const zscore: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, member] = context.args
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'nil' } }
  if (record.value.type !== 'zset') return { state, reply: wrongTypeReply() }
  const entry = record.value.value.find((e) => e.member === member)
  return { state, reply: entry ? { kind: 'bulk', value: String(entry.score) } : { kind: 'nil' } }
}

/** `ZCARD key` — 0 for a missing key. */
const zcard: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'zset') return { state, reply: wrongTypeReply() }
  return { state, reply: { kind: 'integer', value: record.value.value.length } }
}

function parseScoreBound(arg: string): number {
  if (arg === '-inf') return -Infinity
  if (arg === '+inf') return Infinity
  return Number(arg)
}

/** `ZREMRANGEBYSCORE key min max` — removes members whose score falls in [min, max]. */
const zremrangebyscore: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, minArg, maxArg] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  if (!record) return { state: afterRead, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'zset') return { state: afterRead, reply: wrongTypeReply() }

  const min = parseScoreBound(minArg!)
  const max = parseScoreBound(maxArg!)
  const kept = record.value.value.filter((e) => e.score < min || e.score > max)
  const removed = record.value.value.length - kept.length
  if (removed === 0) return { state: afterRead, reply: { kind: 'integer', value: 0 } }

  if (kept.length === 0) return { state: deleteKey(afterRead, key!).state, reply: { kind: 'integer', value: removed } }
  const result = writeKey(afterRead, key!, { type: 'zset', value: kept })
  return { state: result.state, reply: { kind: 'integer', value: removed } }
}

/** `ZCOUNT key min max` — counts members whose score falls in [min, max]. */
const zcount: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, minArg, maxArg] = context.args
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'zset') return { state, reply: wrongTypeReply() }

  const min = parseScoreBound(minArg!)
  const max = parseScoreBound(maxArg!)
  const count = record.value.value.filter((e) => e.score >= min && e.score <= max).length
  return { state, reply: { kind: 'integer', value: count } }
}

export const handlers = {
  ZADD: zadd,
  ZINCRBY: zincrby,
  ZRANGE: zrange,
  ZREVRANGE: zrevrange,
  ZSCORE: zscore,
  ZCARD: zcard,
  ZREMRANGEBYSCORE: zremrangebyscore,
  ZCOUNT: zcount,
} satisfies Record<string, CommandHandler>
