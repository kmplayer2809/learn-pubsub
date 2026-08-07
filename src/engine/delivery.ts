import { buildReplyEvents, requeueByPriority } from './advanced'
import { addInFlight, clearInFlight, edgeId, log, scheduleEvent, TRAVEL_MS } from './broker'
import { deadLetter } from './dlx'
import { nextFloat } from './rng'
import type { ApplyResult, ConsumerSpec, EngineState, Message, NodeId, SimEvent } from './types'

/** Consumers bound to the queue that are neither crashed nor at their prefetch ceiling. */
export function eligibleConsumers(state: EngineState, queueId: NodeId): ConsumerSpec[] {
  return state.topology.consumers.filter((c) => {
    if (c.queueId !== queueId) return false
    if (state.crashed.includes(c.id)) return false
    const held = state.unacked[c.id]?.length ?? 0
    return c.prefetch === 0 || held < c.prefetch
  })
}

function takeHead(state: EngineState, queueId: NodeId): [Message | undefined, EngineState] {
  const queue = state.queues[queueId] ?? []
  const head = queue[0]
  if (!head) return [undefined, state]
  return [head.message, { ...state, queues: { ...state.queues, [queueId]: queue.slice(1) } }]
}

export function applyDispatch(state: EngineState, event: SimEvent): ApplyResult {
  const queueId = event.payload.queueId as NodeId
  const candidates = eligibleConsumers(state, queueId)
  if (candidates.length === 0) return { state, newEvents: [] }

  const [message, afterTake] = takeHead(state, queueId)
  if (!message) return { state, newEvents: [] }

  // The cursor advances per dispatch, not per delivery. Deliveries land
  // TRAVEL_MS later, so a burst of dispatches would otherwise all read the same
  // stale count and hand every message to the same consumer.
  const cursor = state.roundRobin[queueId] ?? 0
  const consumer = candidates[cursor % candidates.length]!

  let next: EngineState = {
    ...afterTake,
    roundRobin: { ...afterTake.roundRobin, [queueId]: cursor + 1 },
  }
  if (!consumer.autoAck) {
    next = {
      ...next,
      unacked: { ...next.unacked, [consumer.id]: [...(next.unacked[consumer.id] ?? []), message] },
    }
  }
  next = addInFlight(next, message, queueId, consumer.id, 'emerald')

  const [deliverEvent, afterSchedule] = scheduleEvent(next, state.now + TRAVEL_MS, 'deliver', {
    message,
    queueId,
    consumerId: consumer.id,
    // Stamped here, not read at arrival: the message spends TRAVEL_MS on the wire,
    // and a crash inside that window requeues it. applyDeliver compares against the
    // live epoch and drops the hop, or the message is both requeued and acked.
    epoch: state.crashEpoch[consumer.id] ?? 0,
  })
  return { state: afterSchedule, newEvents: [deliverEvent] }
}

export function applyDeliver(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const queueId = event.payload.queueId as NodeId
  const consumerId = event.payload.consumerId as NodeId
  const consumer = state.topology.consumers.find((c) => c.id === consumerId)
  if (!consumer) return { state, newEvents: [] }

  // The consumer crashed between dispatch and arrival. applyConsumerCrash already
  // requeued the message (manual ack) or destroyed it (auto ack), so delivering it
  // now would hand a crashed consumer work the broker has already taken back — and
  // on the manual path the requeued copy is acked a second time after redelivery.
  //
  // The in-flight particle for this hop is deliberately NOT cleared here: the crash
  // that moved the epoch already removed every flight ending at this consumer
  // (advanced.ts applyConsumerCrash), so clearing again is at best a no-op — and at
  // worst wrong, because clearInFlight matches on message id plus edge id alone and
  // would wipe a *newer* hop of the same message if the consumer crashed and
  // recovered within a single TRAVEL_MS interval.
  const epoch = (event.payload.epoch as number) ?? 0
  if (epoch !== (state.crashEpoch[consumerId] ?? 0)) {
    return { state, newEvents: [] }
  }

  let next = clearInFlight(state, message.id, edgeId(queueId, consumerId))
  next = { ...next, metrics: { ...next.metrics, delivered: next.metrics.delivered + 1 } }
  next = log(next, {
    at: state.now,
    type: 'deliver',
    text: `${consumer.label} received ${message.id}${message.redeliveryCount > 0 ? ' (redelivered)' : ''}`,
    nodeId: consumerId,
    messageId: message.id,
  })

  let jitter = 0
  if (consumer.jitterMs > 0) {
    const [f, rng] = nextFloat(next.rng)
    jitter = Math.floor(f * consumer.jitterMs)
    next = { ...next, rng }
  }

  const [doneEvent, afterSchedule] = scheduleEvent(
    next,
    state.now + consumer.processingMs + jitter,
    'consumeDone',
    { message, queueId, consumerId, epoch: state.crashEpoch[consumerId] ?? 0 },
  )
  return { state: afterSchedule, newEvents: [doneEvent] }
}

export function applyConsumeDone(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message
  const queueId = event.payload.queueId as NodeId
  const consumerId = event.payload.consumerId as NodeId
  const consumer = state.topology.consumers.find((c) => c.id === consumerId)
  if (!consumer) return { state, newEvents: [] }

  // The consumer crashed while this message was being processed. The crash already
  // requeued it (manual ack) or destroyed it (auto ack); acking now would confirm work
  // that never finished, and on the manual path would confirm the same message twice.
  const epoch = (event.payload.epoch as number) ?? 0
  if (epoch !== (state.crashEpoch[consumerId] ?? 0)) return { state, newEvents: [] }

  let next = state
  let reject = false
  // An auto-acked message is already gone from the broker; it cannot be
  // rejected or requeued, so no draw is made and no RNG state is consumed.
  if (!consumer.autoAck && consumer.nackRate > 0) {
    const [f, rng] = nextFloat(next.rng)
    reject = f < consumer.nackRate
    next = { ...next, rng }
  }

  const [outcome, afterSchedule] = scheduleEvent(next, state.now, reject ? 'nack' : 'ack', {
    message,
    queueId,
    consumerId,
    requeue: consumer.requeueOnNack,
  })
  return { state: afterSchedule, newEvents: [outcome] }
}

function releaseUnacked(state: EngineState, consumerId: NodeId, messageId: string): EngineState {
  const held = state.unacked[consumerId] ?? []
  return { ...state, unacked: { ...state.unacked, [consumerId]: held.filter((m) => m.id !== messageId) } }
}

export function applyAck(state: EngineState, event: SimEvent): ApplyResult {
  const messageId = (event.payload.messageId as string) ?? (event.payload.message as Message).id
  const consumerId = event.payload.consumerId as NodeId
  const queueId = event.payload.queueId as NodeId

  let next = releaseUnacked(state, consumerId, messageId)
  next = { ...next, metrics: { ...next.metrics, acked: next.metrics.acked + 1 } }
  next = log(next, {
    at: state.now,
    type: 'ack',
    text: `${consumerId} acked ${messageId}`,
    nodeId: consumerId,
    messageId,
  })

  const message = event.payload.message as Message | undefined
  let replyEvents: SimEvent[] = []
  if (message) {
    const [events, afterReply] = buildReplyEvents(next, message, consumerId)
    replyEvents = events
    next = afterReply
  }

  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
  return { state: afterSchedule, newEvents: [...replyEvents, dispatchEvent] }
}

export function applyNack(state: EngineState, event: SimEvent): ApplyResult {
  const message = event.payload.message as Message | undefined
  const messageId = (event.payload.messageId as string) ?? message?.id ?? ''
  const consumerId = event.payload.consumerId as NodeId
  const queueId = event.payload.queueId as NodeId
  const requeue = (event.payload.requeue as boolean) ?? true

  let next = releaseUnacked(state, consumerId, messageId)
  next = { ...next, metrics: { ...next.metrics, nacked: next.metrics.nacked + 1 } }

  // applyConsumeDone always carries the message; a nack without one cannot be requeued.
  if (requeue && message) {
    const redelivered: Message = { ...message, redeliveryCount: message.redeliveryCount + 1 }
    // Task 8 note: on a priority queue this must go back to the head of its own
    // priority band, not the head of the whole queue — see requeueByPriority.
    const spec = state.topology.queues.find((q) => q.id === queueId)
    next = {
      ...next,
      queues: {
        ...next.queues,
        [queueId]: requeueByPriority(
          next.queues[queueId] ?? [],
          { message: redelivered, enqueuedAt: state.now },
          spec?.maxPriority,
        ),
      },
    }
    next = log(next, {
      at: state.now,
      type: 'nack',
      text: `${consumerId} rejected ${messageId}; requeued (attempt ${redelivered.redeliveryCount + 1})`,
      nodeId: consumerId,
      messageId,
    })
  } else {
    next = log(next, {
      at: state.now,
      type: 'nack',
      text: `${consumerId} rejected ${messageId} without requeue`,
      nodeId: consumerId,
      messageId,
    })
    if (message) {
      const dead = deadLetter(next, message, queueId, 'rejected')
      next = dead.state
      const [dispatchAfterDeath, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
      return { state: afterSchedule, newEvents: [...dead.newEvents, dispatchAfterDeath] }
    }
  }

  const [dispatchEvent, afterSchedule] = scheduleEvent(next, state.now, 'dispatch', { queueId })
  return { state: afterSchedule, newEvents: [dispatchEvent] }
}
