import { addInFlight, log, scheduleEvent, TRAVEL_MS } from './broker'
import type { AmqpEvent, ApplyResult, EngineState, Message, NodeId, QueueSpec } from './types'

export type DeathReason = 'rejected' | 'expired' | 'maxlen'

export function effectiveTtl(queue: QueueSpec, message: Message): number | undefined {
  const ttls = [queue.messageTtlMs, message.expirationMs].filter(
    (t): t is number => typeof t === 'number',
  )
  return ttls.length === 0 ? undefined : Math.min(...ttls)
}

/**
 * Routes a message out of `fromQueueId` into that queue's dead-letter exchange.
 * Drops it when no dead-letter exchange is configured, matching RabbitMQ.
 */
export function deadLetter(
  state: EngineState,
  message: Message,
  fromQueueId: NodeId,
  reason: DeathReason,
): ApplyResult {
  const queue = state.topology.queues.find((q) => q.id === fromQueueId)
  const target = queue?.deadLetterExchange

  if (!queue || !target) {
    const dropped = log(
      { ...state, metrics: { ...state.metrics, dropped: state.metrics.dropped + 1 } },
      {
        at: state.now,
        type: 'deadLetter',
        text: `${message.id} ${reason} in ${fromQueueId} with no dead-letter exchange; dropped`,
        nodeId: fromQueueId,
        messageId: message.id,
      },
    )
    return { state: dropped, newEvents: [] }
  }

  const carried: Message = {
    ...message,
    routingKey: queue.deadLetterRoutingKey ?? message.routingKey,
    deathTrail: [...message.deathTrail, fromQueueId],
    redeliveryCount: 0,
    headers: {
      ...message.headers,
      'x-death-reason': reason,
      'x-death-count': String(message.deathTrail.length + 1),
    },
  }

  let next: EngineState = {
    ...state,
    metrics: { ...state.metrics, deadLettered: state.metrics.deadLettered + 1 },
  }
  // `carried`, not `message`: this hop is the post-death copy travelling to the
  // dead-letter exchange, and the in-flight panel reads routing key, priority and
  // redelivery count straight off InFlight.message. Animating the pre-death copy
  // showed stale values for the whole hop, exactly when a learner is looking to see
  // what dead-lettering changed. The id is untouched, so clearInFlight still matches.
  next = addInFlight(next, carried, fromQueueId, target, 'rose')
  next = log(next, {
    at: state.now,
    type: 'deadLetter',
    text: `${message.id} ${reason}; dead-lettered from ${queue.label} to ${target}`,
    nodeId: fromQueueId,
    messageId: message.id,
  })

  const [routeEvent, afterSchedule] = scheduleEvent(next, state.now + TRAVEL_MS, 'route', {
    message: carried,
    exchangeId: target,
    fromId: fromQueueId,
    tone: 'rose',
  })
  return { state: afterSchedule, newEvents: [routeEvent] }
}

export function applyTtlExpire(state: EngineState, event: AmqpEvent): ApplyResult {
  const messageId = event.payload.messageId as string
  const queueId = event.payload.queueId as NodeId
  const queue = state.queues[queueId] ?? []
  // Match the exact enqueue this event was scheduled for. Ids survive
  // dead-lettering, so a message that cycles back into this queue would be
  // killed early by the stale TTL event from its previous stay.
  const enqueuedAt = event.payload.enqueuedAt as number
  const index = queue.findIndex((q) => q.message.id === messageId && q.enqueuedAt === enqueuedAt)

  // The message was consumed before its TTL fired; nothing to expire.
  if (index === -1) return { state, newEvents: [] }

  const without: EngineState = {
    ...state,
    // Remove exactly ONE entry — the one this event was scheduled for — not every
    // entry matching. `(id, enqueuedAt)` is not unique: a symmetric fan-in through
    // two exchanges reaches this queue by two paths of equal length, so both copies
    // land in the same millisecond and share both fields. Each copy gets its own
    // ttlExpire, so filtering on the pair still destroyed both on the first event
    // while dead-lettering and counting only one — the second copy vanished with no
    // journal line and no metric. Splicing by index lets the second event find and
    // dead-letter the copy it owns.
    queues: {
      ...state.queues,
      [queueId]: [...queue.slice(0, index), ...queue.slice(index + 1)],
    },
    metrics: { ...state.metrics, expired: state.metrics.expired + 1 },
  }
  return deadLetter(without, queue[index]!.message, queueId, 'expired')
}

export function applyDeadLetter(state: EngineState, event: AmqpEvent): ApplyResult {
  const message = event.payload.message as Message
  const fromQueueId = event.payload.queueId as NodeId
  const reason = (event.payload.reason as DeathReason) ?? 'rejected'
  return deadLetter(state, message, fromQueueId, reason)
}
