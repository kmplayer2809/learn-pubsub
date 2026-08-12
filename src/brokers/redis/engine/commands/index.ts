import type { CommandHandler } from '../reply'
import * as hash from './hash'
import * as keyspace from './keyspace'
import * as list from './list'
import * as server from './server'
import * as set from './set'
import * as string from './string'
import * as zset from './zset'

/** The full command dispatch table: every command name the engine understands maps to its handler. */
export const HANDLERS = {
  ...string.handlers,
  ...keyspace.handlers,
  ...hash.handlers,
  ...list.handlers,
  ...set.handlers,
  ...zset.handlers,
  ...server.handlers,
} satisfies Record<string, CommandHandler>

export type RedisCommandName = keyof typeof HANDLERS

export function isCommandName(name: string): name is RedisCommandName {
  return Object.hasOwn(HANDLERS, name)
}
