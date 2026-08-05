import type { BindingSpec, ExchangeType, Message } from '../types'
import { matchDirect } from './direct'
import { matchFanout } from './fanout'
import { matchHeaders } from './headers'
import { matchTopic } from './topic'

export { matchTopic }

export function matchBinding(
  type: ExchangeType,
  binding: BindingSpec,
  message: Message,
): boolean {
  switch (type) {
    case 'direct':
      return matchDirect(binding, message)
    case 'fanout':
      return matchFanout()
    case 'topic':
      return matchTopic(binding.routingKey ?? '', message.routingKey)
    case 'headers':
      return matchHeaders(binding, message)
  }
}

/** Every matching binding, deduplicated by destination, in binding order. */
export function resolveDestinations(
  type: ExchangeType,
  bindings: readonly BindingSpec[],
  message: Message,
): BindingSpec[] {
  const seen = new Set<string>()
  const hits: BindingSpec[] = []
  for (const binding of bindings) {
    if (!matchBinding(type, binding, message)) continue
    const key = `${binding.destinationKind}:${binding.destinationId}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push(binding)
  }
  return hits
}
