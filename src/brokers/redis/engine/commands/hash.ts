import { deleteKey, readKey, writeKey } from '../keyspace'
import type { CommandContext, CommandHandler, CommandResult } from '../reply'
import { oomReply, wrongTypeReply } from '../reply'

/**
 * `HSET key field value [field value ...]` — creates the hash if the key is
 * missing, replies WRONGTYPE if it already holds something else. The integer
 * reply counts only *new* fields, not fields that already existed and simply
 * got their value overwritten — matching real Redis's HSET return value.
 */
const hset: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, ...pairs] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  // Narrowed through a plain local rather than the `record.value.type` chain
  // directly: TS does not retain discriminated-union narrowing on a nested
  // property path across a later re-test of the same chain (see string.ts's INCR).
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'hash') return { state: afterRead, reply: wrongTypeReply() }

  const fields: Record<string, string> = existingValue && existingValue.type === 'hash' ? { ...existingValue.value } : {}
  let added = 0
  for (let i = 0; i < pairs.length; i += 2) {
    const field = pairs[i]!
    const value = pairs[i + 1]!
    if (!Object.hasOwn(fields, field)) added++
    fields[field] = value
  }

  const result = writeKey(afterRead, key!, { type: 'hash', value: fields })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: added } }
}

/** `HGET key field` — nil for a missing key or a missing field, WRONGTYPE for a non-hash key. */
const hget: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, field] = context.args
  const { state, record } = readKey(context.state, key!)
  if (!record) return { state, reply: { kind: 'nil' } }
  if (record.value.type !== 'hash') return { state, reply: wrongTypeReply() }
  const value = record.value.value[field!]
  return { state, reply: value === undefined ? { kind: 'nil' } : { kind: 'bulk', value } }
}

/** `HGETALL key` — every field/value pair, flattened, in insertion order; empty array for a missing key. */
const hgetall: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!)
  if (!record) return { state, reply: { kind: 'array', value: [] } }
  if (record.value.type !== 'hash') return { state, reply: wrongTypeReply() }
  const flattened = Object.entries(record.value.value).flat()
  return { state, reply: { kind: 'array', value: flattened } }
}

/**
 * `HDEL key field [field ...]` — removes the given fields and reports how
 * many actually existed. Redis never keeps an empty hash around, so once the
 * last field is gone the key is deleted outright rather than left as `{}`.
 */
const hdel: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, ...fieldsToRemove] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  if (!record) return { state: afterRead, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'hash') return { state: afterRead, reply: wrongTypeReply() }

  const fields = { ...record.value.value }
  let removed = 0
  for (const field of fieldsToRemove) {
    if (Object.hasOwn(fields, field)) {
      delete fields[field]
      removed++
    }
  }

  if (Object.keys(fields).length === 0) {
    return { state: deleteKey(afterRead, key!).state, reply: { kind: 'integer', value: removed } }
  }
  const result = writeKey(afterRead, key!, { type: 'hash', value: fields })
  return { state: result.state, reply: { kind: 'integer', value: removed } }
}

/**
 * `HINCRBY key field increment` — creates the field at `increment` when
 * absent, otherwise parses the existing value as a base-10 integer and adds
 * to it. Mirrors INCR's error, scoped to "hash value" per real Redis.
 */
const hincrby: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, field, incrementArg] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'hash') return { state: afterRead, reply: wrongTypeReply() }

  const fields: Record<string, string> = existingValue && existingValue.type === 'hash' ? { ...existingValue.value } : {}
  const current = Object.hasOwn(fields, field!) ? fields[field!]! : '0'
  if (!/^-?\d+$/.test(current)) {
    return { state: afterRead, reply: { kind: 'error', value: 'ERR hash value is not an integer' } }
  }

  const next = Number(current) + Number(incrementArg)
  fields[field!] = String(next)
  const result = writeKey(afterRead, key!, { type: 'hash', value: fields })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: next } }
}

export const handlers = {
  HSET: hset,
  HGET: hget,
  HGETALL: hgetall,
  HDEL: hdel,
  HINCRBY: hincrby,
} satisfies Record<string, CommandHandler>
