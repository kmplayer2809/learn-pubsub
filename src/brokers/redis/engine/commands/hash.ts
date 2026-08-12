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
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  // Narrowed through a plain local rather than the `record.value.type` chain
  // directly: TS does not retain discriminated-union narrowing on a nested
  // property path across a later re-test of the same chain (see string.ts's INCR).
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'hash') return { state: afterRead, reply: wrongTypeReply() }

  const fields: Record<string, string> = existingValue && existingValue.type === 'hash' ? { ...existingValue.value } : {}
  // Fields keep the position they were first set at — Object key order sorts
  // all-digit field names numerically regardless of insertion order (see
  // types.ts's `fieldOrder` doc), so this array is the only source of truth
  // HGETALL is allowed to iterate.
  const fieldOrder: string[] = existingValue && existingValue.type === 'hash' ? [...existingValue.fieldOrder] : []
  let added = 0
  for (let i = 0; i < pairs.length; i += 2) {
    const field = pairs[i]!
    const value = pairs[i + 1]!
    if (!Object.hasOwn(fields, field)) {
      added++
      fieldOrder.push(field)
    }
    fields[field] = value
  }

  const result = writeKey(afterRead, key!, { type: 'hash', value: fields, fieldOrder })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: added } }
}

/** `HGET key field` — nil for a missing key or a missing field, WRONGTYPE for a non-hash key. */
const hget: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, field] = context.args
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'nil' } }
  if (record.value.type !== 'hash') return { state, reply: wrongTypeReply() }
  const value = record.value.value[field!]
  return { state, reply: value === undefined ? { kind: 'nil' } : { kind: 'bulk', value } }
}

/** `HGETALL key` — every field/value pair, flattened, in insertion order; empty array for a missing key. */
const hgetall: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!, 'read')
  if (!record) return { state, reply: { kind: 'array', value: [] } }
  if (record.value.type !== 'hash') return { state, reply: wrongTypeReply() }
  // Narrowed through a plain local for the same reason HSET is (see its
  // comment): TS won't carry the `type === 'hash'` narrowing into the
  // flatMap callback's closure otherwise.
  const hash = record.value
  // fieldOrder, not Object.entries: plain-object key enumeration sorts
  // all-digit field names numerically ahead of insertion order.
  const flattened = hash.fieldOrder.flatMap((field) => [field, hash.value[field]!])
  return { state, reply: { kind: 'array', value: flattened } }
}

/**
 * `HDEL key field [field ...]` — removes the given fields and reports how
 * many actually existed. Redis never keeps an empty hash around, so once the
 * last field is gone the key is deleted outright rather than left as `{}`.
 */
const hdel: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, ...fieldsToRemove] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  if (!record) return { state: afterRead, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'hash') return { state: afterRead, reply: wrongTypeReply() }

  const fields = { ...record.value.value }
  const fieldOrder = [...record.value.fieldOrder]
  let removed = 0
  for (const field of fieldsToRemove) {
    if (Object.hasOwn(fields, field)) {
      delete fields[field]
      const index = fieldOrder.indexOf(field)
      if (index !== -1) fieldOrder.splice(index, 1)
      removed++
    }
  }

  if (Object.keys(fields).length === 0) {
    return { state: deleteKey(afterRead, key!).state, reply: { kind: 'integer', value: removed } }
  }
  const result = writeKey(afterRead, key!, { type: 'hash', value: fields, fieldOrder })
  return { state: result.state, reply: { kind: 'integer', value: removed } }
}

/**
 * `HINCRBY key field increment` — creates the field at `increment` when
 * absent, otherwise parses the existing value as a base-10 integer and adds
 * to it. Mirrors INCR's error, scoped to "hash value" per real Redis.
 */
const hincrby: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, field, incrementArg] = context.args
  const { state: afterRead, record } = readKey(context.state, key!, 'write')
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'hash') return { state: afterRead, reply: wrongTypeReply() }

  const fields: Record<string, string> = existingValue && existingValue.type === 'hash' ? { ...existingValue.value } : {}
  const fieldOrder: string[] = existingValue && existingValue.type === 'hash' ? [...existingValue.fieldOrder] : []
  const isNewField = !Object.hasOwn(fields, field!)
  const current = isNewField ? '0' : fields[field!]!
  if (!/^-?\d+$/.test(current)) {
    return { state: afterRead, reply: { kind: 'error', value: 'ERR hash value is not an integer' } }
  }

  const next = Number(current) + Number(incrementArg)
  fields[field!] = String(next)
  if (isNewField) fieldOrder.push(field!)
  const result = writeKey(afterRead, key!, { type: 'hash', value: fields, fieldOrder })
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
