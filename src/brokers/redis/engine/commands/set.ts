import { deleteKey, readKey, writeKey } from '../keyspace'
import type { CommandContext, CommandHandler, CommandResult } from '../reply'
import { oomReply, wrongTypeReply } from '../reply'

/**
 * `SADD key member [member ...]` — members live in an insertion-ordered
 * array, not a JS `Set`: real Redis makes no order guarantee over SMEMBERS,
 * but this engine picks insertion order and holds to it everywhere, which is
 * what makes SMEMBERS/SINTER reproducible run to run. The integer reply
 * counts only members that were not already present — duplicates within one
 * SADD call collapse to a single add, same as a duplicate across two calls.
 */
const sadd: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, ...members] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  const existingValue = record?.value
  if (existingValue && existingValue.type !== 'set') return { state: afterRead, reply: wrongTypeReply() }

  const set: string[] = existingValue && existingValue.type === 'set' ? [...existingValue.value] : []
  let added = 0
  for (const member of members) {
    if (!set.includes(member)) {
      set.push(member)
      added++
    }
  }

  const result = writeKey(afterRead, key!, { type: 'set', value: set })
  if (result.oom) return { state: result.state, reply: oomReply() }
  return { state: result.state, reply: { kind: 'integer', value: added } }
}

/** `SREM key member [member ...]` — removes the given members; the key is deleted once the last member is gone. */
const srem: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, ...members] = context.args
  const { state: afterRead, record } = readKey(context.state, key!)
  if (!record) return { state: afterRead, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'set') return { state: afterRead, reply: wrongTypeReply() }

  const toRemove = new Set(members)
  const remaining = record.value.value.filter((member) => !toRemove.has(member))
  const removed = record.value.value.length - remaining.length

  if (remaining.length === 0) return { state: deleteKey(afterRead, key!).state, reply: { kind: 'integer', value: removed } }
  const result = writeKey(afterRead, key!, { type: 'set', value: remaining })
  return { state: result.state, reply: { kind: 'integer', value: removed } }
}

/** `SMEMBERS key` — every member, in insertion order; empty array for a missing key. */
const smembers: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!)
  if (!record) return { state, reply: { kind: 'array', value: [] } }
  if (record.value.type !== 'set') return { state, reply: wrongTypeReply() }
  return { state, reply: { kind: 'array', value: record.value.value } }
}

/**
 * `SINTER key [key ...]` — members present in every named set, ordered per
 * the FIRST key's insertion order (never a later set's order, and never
 * re-sorted): the point of an insertion-ordered `set` is exactly so this is
 * deterministic. Every key is read through `readKey` — including ones after
 * an already-missing key — so hit/miss accounting and WRONGTYPE checking stay
 * faithful for every argument, not just however many it takes to short-circuit.
 * A missing key makes the whole intersection empty, same as real Redis
 * treating an absent key as an empty set.
 */
const sinter: CommandHandler = (context: CommandContext): CommandResult => {
  let working = context.state
  const sets: string[][] = []
  let anyMissing = false
  for (const key of context.args) {
    const { state: afterRead, record } = readKey(working, key)
    working = afterRead
    if (!record) {
      anyMissing = true
      continue
    }
    if (record.value.type !== 'set') return { state: working, reply: wrongTypeReply() }
    sets.push(record.value.value)
  }

  if (anyMissing) return { state: working, reply: { kind: 'array', value: [] } }
  const [first, ...rest] = sets
  const intersection = (first ?? []).filter((member) => rest.every((set) => set.includes(member)))
  return { state: working, reply: { kind: 'array', value: intersection } }
}

/** `SISMEMBER key member` — 1 or 0. */
const sismember: CommandHandler = (context: CommandContext): CommandResult => {
  const [key, member] = context.args
  const { state, record } = readKey(context.state, key!)
  if (!record) return { state, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'set') return { state, reply: wrongTypeReply() }
  return { state, reply: { kind: 'integer', value: record.value.value.includes(member!) ? 1 : 0 } }
}

/** `SCARD key` — 0 for a missing key. */
const scard: CommandHandler = (context: CommandContext): CommandResult => {
  const [key] = context.args
  const { state, record } = readKey(context.state, key!)
  if (!record) return { state, reply: { kind: 'integer', value: 0 } }
  if (record.value.type !== 'set') return { state, reply: wrongTypeReply() }
  return { state, reply: { kind: 'integer', value: record.value.value.length } }
}

export const handlers = {
  SADD: sadd,
  SREM: srem,
  SMEMBERS: smembers,
  SINTER: sinter,
  SISMEMBER: sismember,
  SCARD: scard,
} satisfies Record<string, CommandHandler>
