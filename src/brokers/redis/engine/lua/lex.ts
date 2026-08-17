// src/brokers/redis/engine/lua/lex.ts
/**
 * Tokeniser for the subset of Lua this engine's `EVAL` runs — see `eval.ts`'s
 * module doc for exactly which constructs are supported and why. Numbers are
 * integers/decimals only (no hex, no exponents); strings are single- or
 * double-quoted with no escape sequences.
 */
export type TokenType =
  | 'ident' | 'number' | 'string'
  | 'local' | 'if' | 'then' | 'elseif' | 'else' | 'end'
  | 'for' | 'while' | 'do' | 'return'
  | 'and' | 'or' | 'not' | 'true' | 'false' | 'nil'
  | '(' | ')' | '[' | ']' | '.' | ',' | '='
  | '==' | '~=' | '<' | '>' | '<=' | '>='
  | '+' | '-' | '*' | '/'
  | 'eof'

export interface Token {
  type: TokenType
  value: string
  pos: number
}

const KEYWORDS = new Set([
  'local', 'if', 'then', 'elseif', 'else', 'end', 'for', 'while', 'do', 'return',
  'and', 'or', 'not', 'true', 'false', 'nil',
])

export class LuaSyntaxError extends Error {}

export function lex(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = source.length

  while (i < n) {
    const ch = source[i]!

    if (/\s/.test(ch)) { i++; continue }

    if (ch === '-' && source[i + 1] === '-') {
      while (i < n && source[i] !== '\n') i++
      continue
    }

    if (/[0-9]/.test(ch)) {
      let j = i
      while (j < n && /[0-9.]/.test(source[j]!)) j++
      tokens.push({ type: 'number', value: source.slice(i, j), pos: i })
      i = j
      continue
    }

    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < n && source[j] !== quote) j++
      if (j >= n) throw new LuaSyntaxError(`unterminated string starting at ${i}`)
      tokens.push({ type: 'string', value: source.slice(i + 1, j), pos: i })
      i = j + 1
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(source[j]!)) j++
      const word = source.slice(i, j)
      tokens.push({ type: (KEYWORDS.has(word) ? word : 'ident') as TokenType, value: word, pos: i })
      i = j
      continue
    }

    const two = source.slice(i, i + 2)
    if (two === '==' || two === '~=' || two === '<=' || two === '>=') {
      tokens.push({ type: two, value: two, pos: i })
      i += 2
      continue
    }

    if ('()[].,=<>+-*/'.includes(ch)) {
      tokens.push({ type: ch as TokenType, value: ch, pos: i })
      i++
      continue
    }

    throw new LuaSyntaxError(`unexpected character "${ch}" at ${i}`)
  }

  tokens.push({ type: 'eof', value: '', pos: n })
  return tokens
}
