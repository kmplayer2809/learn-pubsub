import { HANDLERS, isCommandName } from './index'
import type { CommandContext, CommandHandler, CommandResult, Reply } from '../reply'
import { formatReply } from '../reply'
import type { NodeId, RedisState } from '../types'

/**
 * `HANDLERS` is imported from `./index`, which is the module that builds
 * `HANDLERS` by merging this file's own `handlers` export into it — a genuine
 * circular import. It works because ES module bindings are live: this file
 * only *reads* `HANDLERS` from inside `exec`'s function body, never at module
 * top level, and by the time any script actually runs (long after the whole
 * module graph has finished loading), `./index`'s `HANDLERS` constant has
 * been fully assigned.
 */

export function isInTransaction(state: RedisState, clientId: NodeId): boolean {
  return clientId in state.txQueues
}

export function queueCommand(state: RedisState, clientId: NodeId, name: string, args: string[]): RedisState {
  const existing = state.txQueues[clientId] ?? []
  return { ...state, txQueues: { ...state.txQueues, [clientId]: [...existing, { name, args }] } }
}

const multi: CommandHandler = (context: CommandContext): CommandResult => {
  if (context.clientId in context.state.txQueues) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR MULTI calls can not be nested' } }
  }
  return {
    state: { ...context.state, txQueues: { ...context.state.txQueues, [context.clientId]: [] } },
    reply: { kind: 'status', value: 'OK' },
  }
}

const discard: CommandHandler = (context: CommandContext): CommandResult => {
  if (!(context.clientId in context.state.txQueues)) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR DISCARD without MULTI' } }
  }
  const nextQueues = { ...context.state.txQueues }
  delete nextQueues[context.clientId]
  const nextWatched = { ...context.state.watched }
  delete nextWatched[context.clientId]
  return { state: { ...context.state, txQueues: nextQueues, watched: nextWatched }, reply: { kind: 'status', value: 'OK' } }
}

/** `WATCH key [key ...]` — records each key's current version. Repeated calls
 *  add to (or refresh) the watched set rather than replacing it, matching real
 *  Redis. Not allowed once inside MULTI, same as real Redis. */
const watch: CommandHandler = (context: CommandContext): CommandResult => {
  if (context.clientId in context.state.txQueues) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR WATCH inside MULTI is not allowed' } }
  }
  const existing = context.state.watched[context.clientId] ?? []
  const merged = [...existing]
  for (const key of context.args) {
    const version = context.state.keyVersions[key] ?? 0
    const index = merged.findIndex((w) => w.key === key)
    if (index === -1) merged.push({ key, version })
    else merged[index] = { key, version }
  }
  return {
    state: { ...context.state, watched: { ...context.state.watched, [context.clientId]: merged } },
    reply: { kind: 'status', value: 'OK' },
  }
}

/**
 * `EXEC` — runs every queued command in order against a single running
 * `state`, all inside this one handler call. `engine/index.ts`'s `applyReply`
 * calls handlers synchronously and schedules no new kernel event for this, so
 * nothing else in the simulation can interleave between the queued commands —
 * that is the entire mechanism behind "MULTI/EXEC is atomic" here.
 */
const exec: CommandHandler = (context: CommandContext): CommandResult => {
  const queued = context.state.txQueues[context.clientId]
  if (queued === undefined) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR EXEC without MULTI' } }
  }

  const nextQueues = { ...context.state.txQueues }
  delete nextQueues[context.clientId]
  const nextWatched = { ...context.state.watched }
  delete nextWatched[context.clientId]
  const cleared: RedisState = { ...context.state, txQueues: nextQueues, watched: nextWatched }

  const watchedKeys = context.state.watched[context.clientId] ?? []
  const dirty = watchedKeys.some((w) => (context.state.keyVersions[w.key] ?? 0) !== w.version)
  if (dirty) return { state: cleared, reply: { kind: 'nil' } }

  let working = cleared
  const replies: Reply[] = []
  for (const command of queued) {
    if (!isCommandName(command.name)) continue // unreachable: only validated commands are ever queued
    const handled = HANDLERS[command.name]({ state: working, clientId: context.clientId, args: command.args, commandId: context.commandId })
    working = handled.state
    replies.push(handled.reply)
  }

  return { state: working, reply: { kind: 'multi', value: replies.map(formatReply) } }
}

export const handlers = {
  MULTI: multi,
  EXEC: exec,
  DISCARD: discard,
  WATCH: watch,
} satisfies Record<string, CommandHandler>
