import { HANDLERS, isCommandName } from './index'
import { LuaSyntaxError } from '../lua/lex'
import { evalProgram, LuaRuntimeError, type LuaValue } from '../lua/eval'
import { parse } from '../lua/parse'
import type { CommandContext, CommandHandler, CommandResult, Reply } from '../reply'

function replyToLua(reply: Reply): LuaValue {
  switch (reply.kind) {
    case 'status': return reply.value
    case 'integer': return reply.value
    case 'bulk': return reply.value
    case 'nil': return false // real Redis maps a nil reply to Lua false
    case 'array': return reply.value
    case 'error': throw new LuaRuntimeError(reply.value)
    case 'multi': return reply.value
  }
}

function luaToReply(value: LuaValue): Reply {
  if (value === null || value === false) return { kind: 'nil' }
  if (typeof value === 'number') return { kind: 'integer', value: Math.trunc(value) }
  if (typeof value === 'string') return { kind: 'bulk', value }
  if (Array.isArray(value)) return { kind: 'array', value: value.map((v) => (v === null || v === false ? '' : String(v))) }
  return { kind: 'integer', value: 1 } // bare `true`
}

/**
 * `EVAL script numkeys key [key ...] arg [arg ...]`. Every `redis.call`
 * inside `script` dispatches through the very same `HANDLERS` table every
 * other command uses (see the circular-import note in `commands/tx.ts`,
 * which this file shares) — there is exactly one place command semantics
 * live, never a second implementation for "commands run from Lua".
 *
 * Because this handler runs the whole interpreter synchronously inside one
 * `applyReply` call and schedules no new kernel event, the script's effects
 * all land as a single step nothing else in the simulation can interleave
 * with — the mechanism behind "Lua scripts are atomic" here.
 */
const evalCommand: CommandHandler = (context: CommandContext): CommandResult => {
  const [script, numKeysArg, ...rest] = context.args
  const numKeys = Number(numKeysArg)
  if (!Number.isInteger(numKeys) || numKeys < 0) {
    return { state: context.state, reply: { kind: 'error', value: 'ERR value is not an integer or out of range' } }
  }
  const keys = rest.slice(0, numKeys)
  const argv = rest.slice(numKeys)

  let working = context.state
  try {
    const program = parse(script!)
    const result = evalProgram(program, {
      keys,
      argv,
      call: (name, args) => {
        if (!isCommandName(name)) throw new LuaRuntimeError(`Unknown Redis command called from script: '${name}'`)
        const handled = HANDLERS[name]({ state: working, clientId: context.clientId, args, commandId: context.commandId })
        working = handled.state
        return replyToLua(handled.reply)
      },
    })
    return { state: working, reply: luaToReply(result) }
  } catch (err) {
    if (err instanceof LuaSyntaxError) {
      return { state: context.state, reply: { kind: 'error', value: `ERR Error compiling script: ${err.message}` } }
    }
    if (err instanceof LuaRuntimeError) {
      return { state: working, reply: { kind: 'error', value: `ERR ${err.message}` } }
    }
    throw err
  }
}

export const handlers = {
  EVAL: evalCommand,
} satisfies Record<string, CommandHandler>
