import type { BindingSpec, Message } from '../types'

export function matchHeaders(binding: BindingSpec, message: Message): boolean {
  const wanted = Object.entries(binding.headers ?? {})
  const mode = binding.xMatch ?? 'all'
  // RabbitMQ folds the criteria list with an accumulator seeded true for `all`
  // and false for `any`. With no criteria the seed survives: `all` matches
  // everything (vacuous AND), `any` matches nothing (vacuous OR).
  if (wanted.length === 0) return mode === 'all'
  const hit = (k: string, v: string) => message.headers[k] === v
  return mode === 'all' ? wanted.every(([k, v]) => hit(k, v)) : wanted.some(([k, v]) => hit(k, v))
}
