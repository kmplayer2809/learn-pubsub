import type { InFlight, JournalEntry, KernelState, SimEvent } from '../../../shell/kernel/types'
export type { InFlight, JournalEntry }
export type AmqpEvent = SimEvent<SimEventType>

export type ExchangeType = 'direct' | 'fanout' | 'topic' | 'headers'
export type QueueKind = 'classic' | 'quorum'
export type NodeId = string

export interface PublisherSpec {
  id: NodeId
  label: string
  position: { x: number; y: number }
}

export interface ExchangeSpec {
  id: NodeId
  label: string
  type: ExchangeType
  position: { x: number; y: number }
}

export interface QueueSpec {
  id: NodeId
  label: string
  kind: QueueKind
  /**
   * A durable queue survives a broker restart, but it only preserves the
   * messages that were themselves `persistent` — a durable queue holding a
   * transient message loses that message on restart just the same. Optional
   * because AMQP's own default is non-durable, and making it required would
   * force a meaningless declaration onto every queue in lessons that never
   * touch durability.
   */
  durable?: boolean
  /** Milliseconds before an unconsumed message is dead-lettered. */
  messageTtlMs?: number
  /** Queue length ceiling; overflow dead-letters the oldest message. */
  maxLength?: number
  /** Exchange id that receives dead-lettered messages. */
  deadLetterExchange?: NodeId
  /** Routing key override used when dead-lettering. */
  deadLetterRoutingKey?: string
  /** Enables priority ordering with values 0..maxPriority. */
  maxPriority?: number
  position: { x: number; y: number }
}

export interface ConsumerSpec {
  id: NodeId
  label: string
  queueId: NodeId
  /** Unacked message ceiling. 0 means unlimited. */
  prefetch: number
  autoAck: boolean
  /** Virtual milliseconds of work per message. */
  processingMs: number
  /** Random jitter added to processingMs, drawn from the seeded PRNG. */
  jitterMs: number
  /** Probability in [0,1] that the consumer rejects a message. */
  nackRate: number
  /** Whether a rejected message is requeued or dead-lettered. */
  requeueOnNack: boolean
  position: { x: number; y: number }
}

export interface BindingSpec {
  id: string
  exchangeId: NodeId
  /** Destination is a queue id, or an exchange id for exchange-to-exchange bindings. */
  destinationId: NodeId
  destinationKind: 'queue' | 'exchange'
  routingKey?: string
  headers?: Record<string, string>
  /** Headers exchange match mode. */
  xMatch?: 'all' | 'any'
}

export interface Topology {
  publishers: PublisherSpec[]
  exchanges: ExchangeSpec[]
  queues: QueueSpec[]
  consumers: ConsumerSpec[]
  bindings: BindingSpec[]
}

export interface Message {
  id: string
  body: string
  routingKey: string
  headers: Record<string, string>
  priority: number
  /** Virtual time the message was first published. */
  publishedAt: number
  /** Incremented every time the message is redelivered. */
  redeliveryCount: number
  /** Queue ids the message has been dead-lettered from, oldest first. */
  deathTrail: NodeId[]
  correlationId?: string
  replyTo?: NodeId
  persistent: boolean
  /** Per-message expiry, overriding the queue TTL when smaller. */
  expirationMs?: number
}

export type SimEventType =
  | 'publish'
  | 'route'
  | 'enqueue'
  | 'dispatch'
  | 'deliver'
  | 'consumeDone'
  | 'ack'
  | 'nack'
  | 'ttlExpire'
  | 'deadLetter'
  | 'retryBackoff'
  | 'consumerCrash'
  | 'consumerRecover'
  | 'confirm'

/** A message currently animating along an edge. */
export interface AmqpInFlight {
  /**
   * The whole message, not its id. An in-flight message has already been removed
   * from its queue and has not yet landed in `unacked`, so this record is the ONLY
   * copy — the same reason `unacked` stores messages. The in-flight panel reads the
   * routing key, priority, and redelivery count from here; there is nowhere else in
   * `EngineState` to look them up while the message is on the wire.
   */
  message: Message
  edgeId: string
  fromT: number
  toT: number
  /** Colour class chosen by the lesson to distinguish streams. */
  tone: string
}

export interface QueuedMessage {
  message: Message
  enqueuedAt: number
}

export interface Metrics {
  published: number
  /**
   * Routing *hops*, not messages and not destinations. applyRoute increments this
   * once per `route` event it handles, so a message fanned out to three queues by
   * one exchange counts 1, while a message crossing an exchange-to-exchange binding
   * counts once per exchange it passes through — an e2e diamond reports `routed 3`
   * for `published 1`. None of the 17 lessons uses an exchange-to-exchange binding,
   * but sandboxStore.addBinding creates one whenever the drag target is an exchange.
   */
  routed: number
  dropped: number
  delivered: number
  acked: number
  nacked: number
  deadLettered: number
  expired: number
  /** Publisher confirms received — one per publish, regardless of fan-out. */
  confirmed: number
}

export interface EngineState extends KernelState {
  topology: Topology
  /** Queue id to its ordered messages. */
  queues: Record<NodeId, QueuedMessage[]>
  /**
   * Consumer id to the messages it currently holds unacked. This stores whole
   * messages, not ids: a dispatched message is removed from its queue, so the
   * unacked table is the ONLY remaining copy. Storing ids alone would leave a
   * consumer crash with nothing to requeue but a blank placeholder, and
   * recovering the message is the entire point of Lesson 7.
   */
  unacked: Record<NodeId, Message[]>
  /**
   * Per-queue round-robin cursor, advanced on every dispatch. It must not be
   * derived from delivery counts: a delivery lands TRAVEL_MS after its dispatch,
   * so a burst of dispatches would all read the same stale count and hand every
   * message to the same consumer.
   */
  roundRobin: Record<NodeId, number>
  inFlight: AmqpInFlight[]
  metrics: Metrics
  /** Consumer ids that are currently crashed and not consuming. */
  crashed: NodeId[]
  /**
   * Per-consumer crash counter, incremented on every crash. A `consumeDone` event is
   * stamped with the epoch that was current when the message was delivered, and is
   * discarded on arrival if the epoch has moved: the work it represents was destroyed
   * by a crash. Reading `crashed` instead would miss a consumer that crashed and
   * recovered inside a single processing interval.
   */
  crashEpoch: Record<NodeId, number>
  /** Monotonic counter used to mint message ids deterministically. */
  messageCounter: number
}

export interface ApplyResult {
  state: EngineState
  newEvents: AmqpEvent[]
}
