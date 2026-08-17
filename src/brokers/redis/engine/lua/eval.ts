import type { Expr, Program, Stmt } from './parse'

/**
 * A tree-walking evaluator over the AST `parse.ts` produces. Deliberately
 * Redis-agnostic: it never imports `Reply` or anything from `../reply`. The
 * bridge between a Lua value and a Redis reply lives in
 * `commands/script.ts`, which is also the only place that supplies the
 * `call` half of `LuaEnv` (wired to `HANDLERS`).
 *
 * Every `local`/`for`/`while`/`if` body shares one flat scope for the whole
 * script — there is no lexical block scoping, no shadowing, no functions, no
 * closures. That is a real simplification versus Lua (a `local` declared
 * inside an `if` "leaks" out of it here), but the two lessons that use this
 * (`13-lua`, `14-distributed-lock`) do not write scripts that would notice.
 */
export type LuaValue = string | number | boolean | null | LuaValue[]

export class LuaRuntimeError extends Error {}

export interface LuaEnv {
  keys: string[]
  argv: string[]
  /** Runs one Redis command. Throws (a `LuaRuntimeError`, typically) on a
   *  Redis-side error — `redis.call` lets that propagate, `redis.pcall`
   *  catches it and yields nil instead, matching real Redis. */
  call: (name: string, args: string[]) => LuaValue
}

class ReturnSignal {
  value: LuaValue
  constructor(value: LuaValue) {
    this.value = value
  }
}

function truthy(v: LuaValue): boolean {
  return v !== null && v !== false
}

function toNumber(v: LuaValue): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  throw new LuaRuntimeError(`cannot coerce ${JSON.stringify(v)} to a number`)
}

function toCommandArg(v: LuaValue): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (v === null || v === false) return ''
  throw new LuaRuntimeError(`cannot use ${JSON.stringify(v)} as a Redis command argument`)
}

export function evalProgram(program: Program, env: LuaEnv): LuaValue {
  const scope = new Map<string, LuaValue>()
  try {
    execBlock(program, scope, env)
  } catch (signal) {
    if (signal instanceof ReturnSignal) return signal.value
    throw signal
  }
  return null
}

function execBlock(stmts: Stmt[], scope: Map<string, LuaValue>, env: LuaEnv): void {
  for (const stmt of stmts) execStmt(stmt, scope, env)
}

function execStmt(stmt: Stmt, scope: Map<string, LuaValue>, env: LuaEnv): void {
  switch (stmt.kind) {
    case 'local':
    case 'assign':
      scope.set(stmt.name, evalExpr(stmt.expr, scope, env))
      return
    case 'if':
      for (const branch of stmt.branches) {
        if (truthy(evalExpr(branch.cond, scope, env))) {
          execBlock(branch.body, scope, env)
          return
        }
      }
      if (stmt.elseBody) execBlock(stmt.elseBody, scope, env)
      return
    case 'while':
      while (truthy(evalExpr(stmt.cond, scope, env))) execBlock(stmt.body, scope, env)
      return
    case 'forNumeric': {
      const from = toNumber(evalExpr(stmt.from, scope, env))
      const to = toNumber(evalExpr(stmt.to, scope, env))
      const step = stmt.step ? toNumber(evalExpr(stmt.step, scope, env)) : 1
      for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
        scope.set(stmt.varName, i)
        execBlock(stmt.body, scope, env)
      }
      return
    }
    case 'return':
      throw new ReturnSignal(stmt.expr ? evalExpr(stmt.expr, scope, env) : null)
    case 'exprStmt':
      evalExpr(stmt.expr, scope, env)
      return
  }
}

function evalExpr(expr: Expr, scope: Map<string, LuaValue>, env: LuaEnv): LuaValue {
  switch (expr.kind) {
    case 'number': return expr.value
    case 'string': return expr.value
    case 'bool': return expr.value
    case 'nil': return null
    case 'var': {
      if (expr.name === 'KEYS') return env.keys
      if (expr.name === 'ARGV') return env.argv
      if (scope.has(expr.name)) return scope.get(expr.name)!
      throw new LuaRuntimeError(`undefined variable "${expr.name}"`)
    }
    case 'index': {
      const target = evalExpr(expr.target, scope, env)
      const index = toNumber(evalExpr(expr.index, scope, env))
      if (!Array.isArray(target)) throw new LuaRuntimeError('attempt to index a non-table value')
      return target[index - 1] ?? null
    }
    case 'field':
      throw new LuaRuntimeError(`unsupported field access ".${expr.name}" (only redis.call/redis.pcall are supported, as a call)`)
    case 'call': {
      const callee = expr.callee
      if (callee.kind === 'field' && callee.target.kind === 'var' && callee.target.name === 'redis') {
        const fn = callee.name
        if (fn !== 'call' && fn !== 'pcall') throw new LuaRuntimeError(`unsupported "redis.${fn}"`)
        const evaluatedArgs = expr.args.map((a) => evalExpr(a, scope, env))
        const [nameArg, ...restArgs] = evaluatedArgs
        const commandName = toCommandArg(nameArg ?? null).toUpperCase()
        const commandArgs = restArgs.map(toCommandArg)
        try {
          return env.call(commandName, commandArgs)
        } catch (err) {
          if (fn === 'pcall') return null
          throw err
        }
      }
      throw new LuaRuntimeError('only redis.call(...) and redis.pcall(...) may be called')
    }
    case 'unary': {
      const value = evalExpr(expr.expr, scope, env)
      return expr.op === 'not' ? !truthy(value) : -toNumber(value)
    }
    case 'binary': {
      if (expr.op === 'and') {
        const left = evalExpr(expr.left, scope, env)
        return truthy(left) ? evalExpr(expr.right, scope, env) : left
      }
      if (expr.op === 'or') {
        const left = evalExpr(expr.left, scope, env)
        return truthy(left) ? left : evalExpr(expr.right, scope, env)
      }
      const left = evalExpr(expr.left, scope, env)
      const right = evalExpr(expr.right, scope, env)
      switch (expr.op) {
        case '+': return toNumber(left) + toNumber(right)
        case '-': return toNumber(left) - toNumber(right)
        case '*': return toNumber(left) * toNumber(right)
        case '/': return toNumber(left) / toNumber(right)
        case '==': return left === right
        case '~=': return left !== right
        case '<': return toNumber(left) < toNumber(right)
        case '>': return toNumber(left) > toNumber(right)
        case '<=': return toNumber(left) <= toNumber(right)
        case '>=': return toNumber(left) >= toNumber(right)
        default: throw new LuaRuntimeError(`unsupported operator "${expr.op}"`)
      }
    }
  }
}
