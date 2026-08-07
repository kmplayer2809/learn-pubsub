import { applyConsumerCrash, applyConsumerRecover } from './advanced'
import { applyConfirm, applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { applyAck, applyConsumeDone, applyDeliver, applyDispatch, applyNack } from './delivery'
import { applyDeadLetter, applyTtlExpire } from './dlx'
import type { AmqpEvent, ApplyResult, EngineState, NodeId, SimEventType, Topology } from './types'
import { createKernel, type Simulation } from '../../../shell/kernel/run'
import { validateTopology, type ValidationIssue, type ValidationIssueCode } from './validate'

export * from './types'
export { validateTopology, type ValidationIssue, type ValidationIssueCode }
export { createRng, nextFloat, nextInt, type RngState } from '../../../shell/kernel/rng'
export { MAX_EVENTS_PER_RUN, MAX_JOURNAL, type Simulation } from '../../../shell/kernel/run'

export interface ScriptedAction {
  at: number
  publisherId: NodeId
  exchangeId: NodeId
  routingKey: string
  body: string
  headers?: Record<string, string>
  priority?: number
  correlationId?: string
  replyTo?: NodeId
  tone?: string
  /** Marks the message for disk persistence. Defaults to false, AMQP's own default. */
  persistent?: boolean
}

export interface ScriptedFailure {
  at: number
  consumerId: NodeId
  kind: 'crash' | 'recover'
}

export interface SimulationOptions {
  topology: Topology
  script: ScriptedAction[]
  failures?: ScriptedFailure[]
  seed: number
  /**
   * Overrides MAX_EVENTS_PER_RUN. The Sandbox lowers it so a user-built runaway
   * topology trips the guard in a fraction of a second instead of grinding, and
   * the guard test uses it to prove the halt without processing 200_000 events.
   */
  maxEvents?: number
}

// 'deadLetter' events are never scheduled directly today — deadLetter() in dlx.ts
// routes via a 'route' event instead — but applyDeadLetter exists with the right
// shape, so it is wired here rather than left orphaned behind a no-op stub.
// 'retryBackoff' has no reducer yet in Tasks 5-8; it is reserved for a later task.
const REDUCERS: Record<AmqpEvent['type'], (s: EngineState, e: AmqpEvent) => ApplyResult> = {
  publish: applyPublish,
  route: applyRoute,
  enqueue: applyEnqueue,
  dispatch: applyDispatch,
  deliver: applyDeliver,
  consumeDone: applyConsumeDone,
  ack: applyAck,
  nack: applyNack,
  ttlExpire: applyTtlExpire,
  deadLetter: applyDeadLetter,
  retryBackoff: (s) => ({ state: s, newEvents: [] }),
  consumerCrash: applyConsumerCrash,
  consumerRecover: applyConsumerRecover,
  confirm: applyConfirm,
}

function seedEvents(options: SimulationOptions): AmqpEvent[] {
  let seq = 0
  const publishes = options.script.map<AmqpEvent>((action) => ({
    at: action.at,
    seq: seq++,
    type: 'publish',
    payload: {
      publisherId: action.publisherId,
      exchangeId: action.exchangeId,
      routingKey: action.routingKey,
      body: action.body,
      headers: action.headers ?? {},
      priority: action.priority ?? 0,
      correlationId: action.correlationId,
      replyTo: action.replyTo,
      tone: action.tone ?? 'sky',
      persistent: action.persistent ?? false,
    },
  }))

  const failures = (options.failures ?? []).map<AmqpEvent>((failure) => ({
    at: failure.at,
    seq: seq++,
    type: failure.kind === 'crash' ? 'consumerCrash' : 'consumerRecover',
    payload: { consumerId: failure.consumerId },
  }))

  return [...publishes, ...failures]
}

// Crash events need the messages the consumer currently holds, which is only
// knowable at apply time — so it is read from live state here. Never synthesise a
// placeholder message: a blank stand-in would silently "recover" an empty body and
// make Lesson 7 teach the opposite of the truth.
function enrich(event: AmqpEvent, current: EngineState): AmqpEvent {
  if (event.type !== 'consumerCrash') return event
  const consumerId = event.payload.consumerId as NodeId
  const held = current.unacked[consumerId] ?? []
  return { ...event, payload: { ...event.payload, heldMessages: held } }
}

export function createSimulation(options: SimulationOptions): Simulation<EngineState> & {
  readonly issues: ValidationIssue[]
} {
  const issues = validateTopology(options.topology)
  const sim = createKernel<EngineState, SimEventType>({
    createState: () => createEngineState(options.topology, options.seed),
    seedEvents: () => seedEvents(options),
    reducers: REDUCERS,
    enrich,
    fatal: issues.some((i) => i.severity === 'error'),
    maxEvents: options.maxEvents,
  })
  return Object.assign(sim, { issues })
}
