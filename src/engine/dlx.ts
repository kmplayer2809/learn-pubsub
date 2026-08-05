import { addInFlight, log, scheduleEvent, TRAVEL_MS } from './broker'
import type { ApplyResult, EngineState, Message, NodeId, QueueSpec, SimEvent } from './types'

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
  next = addInFlight(next, message.id, fromQueueId, target, 'rose')
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

export function applyTtlExpire(state: EngineState, event: SimEvent): ApplyResult {
  const messageId = event.payload.messageId as string
  const queueId = event.payload.queueId as NodeId
  const queue = state.queues[queueId] ?? []
  // A message held unacked by a consumer is no longer in the queue array at
  // all, so presence here is sufficient — there is no unacked flag to check.
  const entry = queue.find((q) => q.message.id === messageId)

  // The message was consumed before its TTL fired; nothing to expire.
  if (!entry) return { state, newEvents: [] }

  const without: EngineState = {
    ...state,
    queues: { ...state.queues, [queueId]: queue.filter((q) => q.message.id !== messageId) },
    metrics: { ...state.metrics, expired: state.metrics.expired + 1 },
  }
  return deadLetter(without, entry.message, queueId, 'expired')
}

export function applyDeadLetter(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const fromQueueId = event.payload.queueId as NodeId
  const reason = (event.payload.reason as DeathReason) ?? 'rejected'
  return deadLetter(state, message, fromQueueId, reason)
}
