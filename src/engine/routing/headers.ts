import type { BindingSpec, Message } from '../types'

export function matchHeaders(binding: BindingSpec, message: Message): boolean {
  const wanted = Object.entries(binding.headers ?? {})
  if (wanted.length === 0) return false
  const mode = binding.xMatch ?? 'all'
  const hit = (k: string, v: string) => message.headers[k] === v
  return mode === 'all' ? wanted.every(([k, v]) => hit(k, v)) : wanted.some(([k, v]) => hit(k, v))
}
