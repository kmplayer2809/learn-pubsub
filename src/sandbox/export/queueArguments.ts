import type { QueueSpec } from '../../engine'

/**
 * The `arguments` a real broker expects for a queue's optional AMQP knobs, as
 * already-quoted `'key': value` source fragments in a fixed order. Shared by
 * both `amqplib.ts` and `nestjs.ts` so the two generators can never drift on
 * which `QueueSpec` field maps to which `x-*` argument, or on how it's quoted.
 */
export function queueArgumentEntries(queue: QueueSpec | undefined): string[] {
  if (!queue) return []
  const args: string[] = []
  if (queue.messageTtlMs !== undefined) args.push(`'x-message-ttl': ${queue.messageTtlMs}`)
  if (queue.maxLength !== undefined) args.push(`'x-max-length': ${queue.maxLength}`)
  if (queue.deadLetterExchange) args.push(`'x-dead-letter-exchange': '${queue.deadLetterExchange}'`)
  if (queue.deadLetterRoutingKey) args.push(`'x-dead-letter-routing-key': '${queue.deadLetterRoutingKey}'`)
  if (queue.maxPriority !== undefined) args.push(`'x-max-priority': ${queue.maxPriority}`)
  if (queue.kind === 'quorum') args.push(`'x-queue-type': 'quorum'`)
  return args
}
