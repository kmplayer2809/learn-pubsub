import { log, scheduleEvent } from './broker'
import type { ApplyResult, EngineState, Message, NodeId, QueuedMessage, SimEvent } from './types'

/**
 * Inserts ahead of every strictly lower priority entry and behind equals, so
 * messages of equal priority stay first-in-first-out.
 */
export function insertByPriority(
  queue: readonly QueuedMessage[],
  incoming: QueuedMessage,
  maxPriority: number | undefined,
): QueuedMessage[] {
  if (maxPriority === undefined) return [...queue, incoming]
  const index = queue.findIndex((q) => q.message.priority < incoming.message.priority)
  if (index === -1) return [...queue, incoming]
  return [...queue.slice(0, index), incoming, ...queue.slice(index)]
}

/**
 * Returns a rejected or crash-released message to the queue. It goes back to
 * the head, but on a priority queue "the head" means the head of its own
 * priority band: a requeued message must not jump ahead of higher-priority
 * messages that were waiting behind it. Unlike insertByPriority this inserts
 * ahead of equals, because the message had already reached the front once.
 */
export function requeueByPriority(
  queue: readonly QueuedMessage[],
  incoming: QueuedMessage,
  maxPriority: number | undefined,
): QueuedMessage[] {
  if (maxPriority === undefined) return [incoming, ...queue]
  const index = queue.findIndex((q) => q.message.priority <= incoming.message.priority)
  if (index === -1) return [...queue, incoming]
  return [...queue.slice(0, index), incoming, ...queue.slice(index)]
}

export function applyConsumerCrash(state: EngineState, event: SimEvent): ApplyResult {
  const consumerId = event.payload.consumerId as NodeId
  const held = (event.payload.heldMessages as Message[]) ?? []
  const consumer = state.topology.consumers.find((c) => c.id === consumerId)

  let next: EngineState = {
    ...state,
    crashed: state.crashed.includes(consumerId) ? state.crashed : [...state.crashed, consumerId],
    crashEpoch: { ...state.crashEpoch, [consumerId]: (state.crashEpoch[consumerId] ?? 0) + 1 },
    unacked: { ...state.unacked, [consumerId]: [] },
    inFlight: state.inFlight.filter((f) => !f.edgeId.endsWith(`->${consumerId}`)),
  }

  if (consumer && held.length > 0 && !consumer.autoAck) {
    const spec = state.topology.queues.find((q) => q.id === consumer.queueId)
    // Fold from the right so that after each insert-ahead-of-equals the held
    // messages end up in their original order rather than reversed.
    const restored = held.reduceRight<QueuedMessage[]>(
      (acc, m) =>
        requeueByPriority(
          acc,
          { message: { ...m, redeliveryCount: m.redeliveryCount + 1 }, enqueuedAt: state.now },
          spec?.maxPriority,
        ),
      [...(next.queues[consumer.queueId] ?? [])],
    )
    next = { ...next, queues: { ...next.queues, [consumer.queueId]: restored } }
    next = log(next, {
      at: state.now,
      type: 'consumerCrash',
      text: `${consumerId} crashed; ${held.length} unacked message(s) requeued`,
      nodeId: consumerId,
    })
  } else {
    next = log(next, {
      at: state.now,
      type: 'consumerCrash',
      text: consumer?.autoAck
        ? `${consumerId} crashed; in-flight message lost because auto-ack already confirmed it`
        : `${consumerId} crashed with nothing unacked`,
      nodeId: consumerId,
    })
  }

  return { state: next, newEvents: [] }
}

export function applyConsumerRecover(state: EngineState, event: SimEvent): ApplyResult {
  const consumerId = event.payload.consumerId as NodeId
  const consumer = state.topology.consumers.find((c) => c.id === consumerId)

  let next: EngineState = { ...state, crashed: state.crashed.filter((id) => id !== consumerId) }
  next = log(next, {
    at: state.now,
    type: 'consumerRecover',
    text: `${consumerId} recovered and resumed consuming`,
    nodeId: consumerId,
  })

  if (!consumer) return { state: next, newEvents: [] }
  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', {
    queueId: consumer.queueId,
  })
  return { state: afterSchedule, newEvents: [dispatchEvent] }
}

/** Emits the RPC response publish for an acked request, if it asked for one. */
export function buildReplyEvents(
  state: EngineState,
  message: Message,
  consumerId: NodeId,
): [SimEvent[], EngineState] {
  if (!message.replyTo) return [[], state]
  const [replyEvent, next] = scheduleEvent(state, state.now, 'publish', {
    publisherId: consumerId,
    exchangeId: message.replyTo,
    routingKey: message.correlationId ?? '',
    body: `reply to ${message.id}`,
    headers: {},
    correlationId: message.correlationId,
    tone: 'amber',
  })
  return [[replyEvent], next]
}
