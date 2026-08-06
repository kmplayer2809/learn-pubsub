import { insertByPriority } from './advanced'
import { deadLetter, effectiveTtl } from './dlx'
import { createRng } from './rng'
import { resolveDestinations } from './routing'
import type {
  ApplyResult,
  EngineState,
  JournalEntry,
  Message,
  NodeId,
  QueuedMessage,
  SimEvent,
  Topology,
} from './types'

/** Virtual milliseconds a message spends animating along one edge. */
export const TRAVEL_MS = 600

export function edgeId(from: NodeId, to: NodeId): string {
  return `${from}->${to}`
}

export function createEngineState(topology: Topology, seed: number): EngineState {
  const queues: Record<NodeId, QueuedMessage[]> = {}
  for (const q of topology.queues) queues[q.id] = []
  const unacked: Record<NodeId, Message[]> = {}
  for (const c of topology.consumers) unacked[c.id] = []
  const roundRobin: Record<NodeId, number> = {}
  for (const q of topology.queues) roundRobin[q.id] = 0

  return {
    now: 0,
    seq: 0,
    rng: createRng(seed),
    topology,
    queues,
    unacked,
    roundRobin,
    inFlight: [],
    metrics: {
      published: 0,
      routed: 0,
      dropped: 0,
      delivered: 0,
      acked: 0,
      nacked: 0,
      deadLettered: 0,
      expired: 0,
    },
    journal: [],
    crashed: [],
    messageCounter: 0,
  }
}

export function log(state: EngineState, entry: JournalEntry): EngineState {
  return { ...state, journal: [...state.journal, entry] }
}

/** Allocates the next event sequence number, keeping equal timestamps ordered. */
export function nextSeq(state: EngineState): [number, EngineState] {
  return [state.seq + 1, { ...state, seq: state.seq + 1 }]
}

export function scheduleEvent(
  state: EngineState,
  at: number,
  type: SimEvent['type'],
  payload: Record<string, unknown>,
): [SimEvent, EngineState] {
  const [seq, next] = nextSeq(state)
  return [{ at, seq, type, payload }, next]
}

export function addInFlight(
  state: EngineState,
  messageId: string,
  from: NodeId,
  to: NodeId,
  tone: string,
): EngineState {
  return {
    ...state,
    inFlight: [
      ...state.inFlight,
      { messageId, edgeId: edgeId(from, to), fromT: state.now, toT: state.now + TRAVEL_MS, tone },
    ],
  }
}

export function clearInFlight(state: EngineState, messageId: string, edge: string): EngineState {
  return {
    ...state,
    inFlight: state.inFlight.filter((f) => !(f.messageId === messageId && f.edgeId === edge)),
  }
}

export function applyPublish(state: EngineState, event: SimEvent): ApplyResult {
  const publisherId = event.payload.publisherId as NodeId
  const exchangeId = event.payload.exchangeId as NodeId
  const counter = state.messageCounter + 1
  const message: Message = {
    id: `m${counter}`,
    body: (event.payload.body as string) ?? '',
    routingKey: (event.payload.routingKey as string) ?? '',
    headers: (event.payload.headers as Record<string, string>) ?? {},
    priority: (event.payload.priority as number) ?? 0,
    publishedAt: state.now,
    redeliveryCount: 0,
    deathTrail: [],
    persistent: (event.payload.persistent as boolean) ?? false,
    correlationId: event.payload.correlationId as string | undefined,
    replyTo: event.payload.replyTo as NodeId | undefined,
    expirationMs: event.payload.expirationMs as number | undefined,
  }
  const tone = (event.payload.tone as string) ?? 'sky'

  let next: EngineState = {
    ...state,
    messageCounter: counter,
    metrics: { ...state.metrics, published: state.metrics.published + 1 },
  }
  next = addInFlight(next, message.id, publisherId, exchangeId, tone)
  next = log(next, {
    at: state.now,
    type: 'publish',
    text: `${publisherId} published ${message.id} key="${message.routingKey}"`,
    nodeId: publisherId,
    messageId: message.id,
  })

  const [routeEvent, afterSchedule] = scheduleEvent(next, state.now + TRAVEL_MS, 'route', {
    message,
    exchangeId,
    fromId: publisherId,
    tone,
  })
  return { state: afterSchedule, newEvents: [routeEvent] }
}

export function applyRoute(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const exchangeId = event.payload.exchangeId as NodeId
  const fromId = event.payload.fromId as NodeId
  const tone = (event.payload.tone as string) ?? 'sky'

  let next = clearInFlight(state, message.id, edgeId(fromId, exchangeId))

  const exchange = state.topology.exchanges.find((e) => e.id === exchangeId)
  if (!exchange) {
    next = log(next, {
      at: state.now,
      type: 'route',
      text: `exchange ${exchangeId} does not exist; ${message.id} discarded`,
      messageId: message.id,
    })
    return { state: { ...next, metrics: { ...next.metrics, dropped: next.metrics.dropped + 1 } }, newEvents: [] }
  }

  const bindings = state.topology.bindings.filter((b) => b.exchangeId === exchangeId)
  const hits = resolveDestinations(exchange.type, bindings, message)

  if (hits.length === 0) {
    next = log(next, {
      at: state.now,
      type: 'route',
      text: `${message.id} unroutable at ${exchange.label}; dropped`,
      nodeId: exchangeId,
      messageId: message.id,
    })
    return { state: { ...next, metrics: { ...next.metrics, dropped: next.metrics.dropped + 1 } }, newEvents: [] }
  }

  const events: SimEvent[] = []
  for (const binding of hits) {
    next = addInFlight(next, message.id, exchangeId, binding.destinationId, tone)
    if (binding.destinationKind === 'exchange') {
      const [routeEvent, after] = scheduleEvent(next, state.now + TRAVEL_MS, 'route', {
        message,
        exchangeId: binding.destinationId,
        fromId: exchangeId,
        tone,
      })
      next = after
      events.push(routeEvent)
    } else {
      const [enqueueEvent, after] = scheduleEvent(next, state.now + TRAVEL_MS, 'enqueue', {
        message,
        queueId: binding.destinationId,
        fromId: exchangeId,
        tone,
      })
      next = after
      events.push(enqueueEvent)
    }
  }

  next = log(next, {
    at: state.now,
    type: 'route',
    text: `${exchange.label} routed ${message.id} to ${hits.map((h) => h.destinationId).join(', ')}`,
    nodeId: exchangeId,
    messageId: message.id,
  })
  next = { ...next, metrics: { ...next.metrics, routed: next.metrics.routed + 1 } }
  return { state: next, newEvents: events }
}

export function applyEnqueue(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const queueId = event.payload.queueId as NodeId
  const fromId = event.payload.fromId as NodeId

  let next = clearInFlight(state, message.id, edgeId(fromId, queueId))
  const existing = next.queues[queueId] ?? []
  const entry: QueuedMessage = { message, enqueuedAt: state.now }

  const spec = state.topology.queues.find((q) => q.id === queueId)
  next = {
    ...next,
    queues: { ...next.queues, [queueId]: insertByPriority(existing, entry, spec?.maxPriority) },
  }

  const events: SimEvent[] = []

  // drop-head overflow: the oldest message leaves to make room for the new one
  if (spec?.maxLength !== undefined) {
    const current = next.queues[queueId] ?? []
    if (current.length > spec.maxLength) {
      const oldest = current[0]!
      next = { ...next, queues: { ...next.queues, [queueId]: current.slice(1) } }
      const overflow = deadLetter(next, oldest.message, queueId, 'maxlen')
      next = overflow.state
      events.push(...overflow.newEvents)
    }
  }

  // Only schedule a TTL if the message actually survived the overflow check —
  // with maxLength 0 the message we just enqueued is already gone.
  const survived = (next.queues[queueId] ?? []).some((q) => q.message.id === message.id)
  if (spec && survived) {
    const ttl = effectiveTtl(spec, message)
    if (ttl !== undefined) {
      const [expireEvent, afterTtl] = scheduleEvent(next, state.now + ttl, 'ttlExpire', {
        messageId: message.id,
        queueId,
        // Identifies THIS enqueue. A dead-lettered message keeps its id, so a
        // message that cycles back into the same queue would otherwise be killed
        // by the stale TTL event left over from its previous stay.
        enqueuedAt: state.now,
      })
      next = afterTtl
      events.push(expireEvent)
    }
  }

  next = log(next, {
    at: state.now,
    type: 'enqueue',
    text: `${message.id} enqueued in ${queueId} (depth ${(next.queues[queueId] ?? []).length})`,
    nodeId: queueId,
    messageId: message.id,
  })

  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
  events.push(dispatchEvent)
  return { state: afterSchedule, newEvents: events }
}
