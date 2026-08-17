import { lex, LuaSyntaxError, type Token, type TokenType } from './lex'

/**
 * The supported Lua subset, end to end: literals (number/string/bool/nil),
 * `KEYS[n]`/`ARGV[n]` indexing, `redis.call`/`redis.pcall`, `local`,
 * assignment to an already-declared local, `if/elseif/else/end`,
 * `while/do/end`, a numeric `for i = a, b[, step] do end`, and `return`. No
 * function definitions, no string/table library beyond `KEYS`/`ARGV`
 * themselves, no closures — see `eval.ts` for where each of these is enforced
 * at evaluation time.
 */
export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'nil' }
  | { kind: 'var'; name: string }
  | { kind: 'index'; target: Expr; index: Expr }
  | { kind: 'field'; target: Expr; name: string }
  | { kind: 'call'; callee: Expr; args: Expr[] }
  | { kind: 'unary'; op: '-' | 'not'; expr: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }

export type Stmt =
  | { kind: 'local'; name: string; expr: Expr }
  | { kind: 'assign'; name: string; expr: Expr }
  | { kind: 'if'; branches: { cond: Expr; body: Stmt[] }[]; elseBody?: Stmt[] }
  | { kind: 'while'; cond: Expr; body: Stmt[] }
  | { kind: 'forNumeric'; varName: string; from: Expr; to: Expr; step?: Expr; body: Stmt[] }
  | { kind: 'return'; expr?: Expr }
  | { kind: 'exprStmt'; expr: Expr }

export type Program = Stmt[]

export function parse(source: string): Program {
  const tokens = lex(source)
  let pos = 0

  const peek = (): Token => tokens[pos]!
  const at = (type: TokenType): boolean => peek().type === type
  const advance = (): Token => tokens[pos++]!
  const expect = (type: TokenType): Token => {
    if (!at(type)) throw new LuaSyntaxError(`expected "${type}" but got "${peek().type}" at ${peek().pos}`)
    return advance()
  }

  function parseProgram(): Program {
    const stmts: Stmt[] = []
    while (!at('eof')) stmts.push(parseStmt())
    return stmts
  }

  function parseBlock(...enders: TokenType[]): Stmt[] {
    const stmts: Stmt[] = []
    while (!enders.some((e) => at(e))) {
      if (at('eof')) throw new LuaSyntaxError(`unexpected end of script, expected one of: ${enders.join(', ')}`)
      stmts.push(parseStmt())
    }
    return stmts
  }

  function parseStmt(): Stmt {
    if (at('local')) {
      advance()
      const name = expect('ident').value
      expect('=')
      return { kind: 'local', name, expr: parseExpr() }
    }
    if (at('if')) {
      advance()
      const branches: { cond: Expr; body: Stmt[] }[] = []
      const cond = parseExpr()
      expect('then')
      branches.push({ cond, body: parseBlock('elseif', 'else', 'end') })
      while (at('elseif')) {
        advance()
        const c = parseExpr()
        expect('then')
        branches.push({ cond: c, body: parseBlock('elseif', 'else', 'end') })
      }
      let elseBody: Stmt[] | undefined
      if (at('else')) {
        advance()
        elseBody = parseBlock('end')
      }
      expect('end')
      return { kind: 'if', branches, elseBody }
    }
    if (at('while')) {
      advance()
      const cond = parseExpr()
      expect('do')
      const body = parseBlock('end')
      expect('end')
      return { kind: 'while', cond, body }
    }
    if (at('for')) {
      advance()
      const varName = expect('ident').value
      expect('=')
      const from = parseExpr()
      expect(',')
      const to = parseExpr()
      let step: Expr | undefined
      if (at(',')) { advance(); step = parseExpr() }
      expect('do')
      const body = parseBlock('end')
      expect('end')
      return { kind: 'forNumeric', varName, from, to, step, body }
    }
    if (at('return')) {
      advance()
      if (at('end') || at('eof') || at('elseif') || at('else')) return { kind: 'return' }
      return { kind: 'return', expr: parseExpr() }
    }
    if (at('ident')) {
      const start = pos
      const name = advance().value
      if (at('=')) {
        advance()
        return { kind: 'assign', name, expr: parseExpr() }
      }
      pos = start
    }
    return { kind: 'exprStmt', expr: parseExpr() }
  }

  function parseExpr(): Expr { return parseOr() }
  function parseOr(): Expr {
    let left = parseAnd()
    while (at('or')) { advance(); left = { kind: 'binary', op: 'or', left, right: parseAnd() } }
    return left
  }
  function parseAnd(): Expr {
    let left = parseComparison()
    while (at('and')) { advance(); left = { kind: 'binary', op: 'and', left, right: parseComparison() } }
    return left
  }
  function parseComparison(): Expr {
    let left = parseAdditive()
    while (at('==') || at('~=') || at('<') || at('>') || at('<=') || at('>=')) {
      const op = advance().type
      left = { kind: 'binary', op, left, right: parseAdditive() }
    }
    return left
  }
  function parseAdditive(): Expr {
    let left = parseMultiplicative()
    while (at('+') || at('-')) {
      const op = advance().type
      left = { kind: 'binary', op, left, right: parseMultiplicative() }
    }
    return left
  }
  function parseMultiplicative(): Expr {
    let left = parseUnary()
    while (at('*') || at('/')) {
      const op = advance().type
      left = { kind: 'binary', op, left, right: parseUnary() }
    }
    return left
  }
  function parseUnary(): Expr {
    if (at('-')) { advance(); return { kind: 'unary', op: '-', expr: parseUnary() } }
    if (at('not')) { advance(); return { kind: 'unary', op: 'not', expr: parseUnary() } }
    return parsePostfix()
  }
  function parsePostfix(): Expr {
    let expr = parsePrimary()
    for (;;) {
      if (at('[')) {
        advance()
        const index = parseExpr()
        expect(']')
        expr = { kind: 'index', target: expr, index }
      } else if (at('.')) {
        advance()
        const name = expect('ident').value
        expr = { kind: 'field', target: expr, name }
      } else if (at('(')) {
        advance()
        const args: Expr[] = []
        if (!at(')')) {
          args.push(parseExpr())
          while (at(',')) { advance(); args.push(parseExpr()) }
        }
        expect(')')
        expr = { kind: 'call', callee: expr, args }
      } else break
    }
    return expr
  }
  function parsePrimary(): Expr {
    if (at('number')) return { kind: 'number', value: Number(advance().value) }
    if (at('string')) return { kind: 'string', value: advance().value }
    if (at('true')) { advance(); return { kind: 'bool', value: true } }
    if (at('false')) { advance(); return { kind: 'bool', value: false } }
    if (at('nil')) { advance(); return { kind: 'nil' } }
    if (at('ident')) return { kind: 'var', name: advance().value }
    if (at('(')) {
      advance()
      const expr = parseExpr()
      expect(')')
      return expr
    }
    throw new LuaSyntaxError(`unexpected token "${peek().type}" at ${peek().pos}`)
  }

  return parseProgram()
}
