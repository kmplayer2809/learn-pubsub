import type { NodeId, RedisState } from './types'

/**
 * The shapes a Redis reply can take, mirroring what `redis-cli` itself would
 * print for each RESP type. This simulation never speaks RESP on the wire —
 * everything stays inside one process — but the journal renders commands and
 * their replies the way a learner would see them in a real terminal, and that
 * means reproducing redis-cli's own formatting rules.
 */
export type Reply =
  | { kind: 'status'; value: string } // OK
  | { kind: 'integer'; value: number } // (integer) 3
  | { kind: 'bulk'; value: string } // "alice"
  | { kind: 'nil' } // (nil)
  | { kind: 'array'; value: string[] } // 1) "a"  2) "b"
  | { kind: 'error'; value: string } // (error) OOM ...

/** Renders a `Reply` the way `redis-cli` prints it. */
export function formatReply(reply: Reply): string {
  switch (reply.kind) {
    case 'status':
      return reply.value
    case 'integer':
      return `(integer) ${reply.value}`
    case 'bulk':
      return `"${reply.value}"`
    case 'nil':
      return '(nil)'
    case 'array':
      if (reply.value.length === 0) return '(empty array)'
      return reply.value.map((entry, index) => `${index + 1}) "${entry}"`).join(' ')
    case 'error':
      return `(error) ${reply.value}`
  }
}

/**
 * A bare (unsigned or signed) integer, e.g. a TTL in seconds or a SCAN
 * cursor. Distinguishing these from free-text values is what lets the
 * journal read like a terminal transcript rather than a wall of quotes.
 */
const BARE_INTEGER = /^-?\d+$/

/**
 * A colon-namespaced token, e.g. `user:1` or `session:9` — the shape this
 * simulation's fixtures (and most real Redis deployments) use for key
 * names. Quoting these would make every journal line about a key noisier
 * without adding information, so they read unquoted like bare integers do.
 *
 * This is a heuristic, not a parse of "which argument is the key": formatCommand
 * has no notion of a command's argument grammar (SET's 2nd argument is a value,
 * DEL's every argument is a key, and so on), only the raw argument strings. A
 * plain, non-namespaced key name (`SET foo bar`) still gets quoted under this
 * rule, same as a value would.
 */
const NAMESPACED_TOKEN = /:/

function needsQuoting(arg: string): boolean {
  return !BARE_INTEGER.test(arg) && !NAMESPACED_TOKEN.test(arg)
}

/** Renders a command and its arguments the way it would read in the journal. */
export function formatCommand(name: string, args: string[]): string {
  const rendered = args.map((arg) => (needsQuoting(arg) ? `"${arg}"` : arg))
  return [name, ...rendered].join(' ')
}

/** Every handler's error reply for touching a key of the wrong type. */
export function wrongTypeReply(): Reply {
  return { kind: 'error', value: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
}

/** Every handler's error reply when `writeKey` refuses a write for lack of memory. */
export function oomReply(): Reply {
  return { kind: 'error', value: "OOM command not allowed when used memory > 'maxmemory'." }
}

/** What a handler receives: the state it must not mutate, and the command's raw arguments. */
export interface CommandContext {
  state: RedisState
  clientId: NodeId
  args: string[]
}

/** What a handler returns: the (possibly new) state, and the reply to journal. */
export interface CommandResult {
  state: RedisState
  reply: Reply
}

export type CommandHandler = (context: CommandContext) => CommandResult
