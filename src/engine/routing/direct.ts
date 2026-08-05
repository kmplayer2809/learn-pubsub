import type { BindingSpec, Message } from '../types'

export function matchDirect(binding: BindingSpec, message: Message): boolean {
  return (binding.routingKey ?? '') === message.routingKey
}
