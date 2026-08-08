import type { CommandHandler } from '../reply'
import * as keyspace from './keyspace'
import * as string from './string'

/** The full command dispatch table: every command name the engine understands maps to its handler. */
export const HANDLERS = {
  ...string.handlers,
  ...keyspace.handlers,
} satisfies Record<string, CommandHandler>

export type RedisCommandName = keyof typeof HANDLERS

export function isCommandName(name: string): name is RedisCommandName {
  return Object.hasOwn(HANDLERS, name)
}
