import { applyConsumerCrash, applyConsumerRecover } from './advanced'
import { applyEnqueue, applyPublish, applyRoute, createEngineState } from './broker'
import { createScheduler, peekTime, popDue, pushAll, type Scheduler } from './clock'
import { applyAck, applyConsumeDone, applyDeliver, applyDispatch, applyNack } from './delivery'
import { applyDeadLetter, applyTtlExpire } from './dlx'
import type { ApplyResult, EngineState, NodeId, SimEvent, Topology } from './types'
import { validateTopology, type ValidationIssue } from './validate'

export * from './types'
export { validateTopology, type ValidationIssue }

export const MAX_EVENTS_PER_RUN = 200_000
export const MAX_JOURNAL = 5_000

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

export interface Simulation {
  advanceTo(t: number): void
  stepOnce(): void
  reset(): void
  nextEventTime(): number | undefined
  snapshot(): EngineState
  readonly issues: ValidationIssue[]
}

// 'deadLetter' events are never scheduled directly today — deadLetter() in dlx.ts
// routes via a 'route' event instead — but applyDeadLetter exists with the right
// shape, so it is wired here rather than left orphaned behind a no-op stub.
// 'retryBackoff' has no reducer yet in Tasks 5-8; it is reserved for a later task.
const REDUCERS: Record<SimEvent['type'], (s: EngineState, e: SimEvent) => ApplyResult> = {
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
}

function seedEvents(options: SimulationOptions): SimEvent[] {
  let seq = 0
  const publishes = options.script.map<SimEvent>((action) => ({
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
    },
  }))

  const failures = (options.failures ?? []).map<SimEvent>((failure) => ({
    at: failure.at,
    seq: seq++,
    type: failure.kind === 'crash' ? 'consumerCrash' : 'consumerRecover',
    payload: { consumerId: failure.consumerId },
  }))

  return [...publishes, ...failures]
}

function capJournal(state: EngineState): EngineState {
  if (state.journal.length <= MAX_JOURNAL) return state
  return { ...state, journal: state.journal.slice(state.journal.length - MAX_JOURNAL) }
}

export function createSimulation(options: SimulationOptions): Simulation {
  const issues = validateTopology(options.topology)
  const fatal = issues.some((i) => i.severity === 'error')

  let state: EngineState = createEngineState(options.topology, options.seed)
  let scheduler: Scheduler = pushAll(createScheduler(), seedEvents(options))
  let processed = 0
  const ceiling = options.maxEvents ?? MAX_EVENTS_PER_RUN

  // Crash events need the messages the consumer currently holds, which is only
  // knowable at apply time — so the reducer reads them from live state here.
  function enrich(event: SimEvent, current: EngineState): SimEvent {
    if (event.type !== 'consumerCrash') return event
    const consumerId = event.payload.consumerId as NodeId
    // state.unacked holds whole messages, so this is a straight read. Never
    // synthesise a placeholder message here: a blank stand-in would silently
    // "recover" an empty body and make Lesson 7 teach the opposite of the truth.
    const held = current.unacked[consumerId] ?? []
    return { ...event, payload: { ...event.payload, heldMessages: held } }
  }

  function run(upTo: number): void {
    // Fatal validation errors and a halted run are both terminal: never dispatch.
    if (fatal || state.halted) return
    for (;;) {
      // Drain exactly one timestamp per iteration. Events generated while
      // applying "due" land in the scheduler at their own (possibly earlier
      // or equal) time and carry a higher seq, so the next iteration's
      // peekTime picks them up in the correct order instead of leaving them
      // stranded until the whole batch up to `upTo` has been applied — which
      // is what let a later-timestamped event apply before an earlier one
      // generated mid-batch.
      const nextTime = peekTime(scheduler)
      if (nextTime === undefined || nextTime > upTo) return
      const [due, rest] = popDue(scheduler, nextTime)
      scheduler = rest
      for (const event of due) {
        // The ceiling counts events processed across the whole run, and this check
        // must live inside the inner pop-and-apply loop: a cycle can regenerate
        // events within a single popDue batch, so checking only between advanceTo
        // calls would never catch it.
        if (processed >= ceiling) {
          state = {
            ...state,
            halted: { reason: `event ceiling of ${ceiling} reached; the topology may loop` },
          }
          return
        }
        processed++
        const at: EngineState = { ...state, now: event.at }
        const result = REDUCERS[event.type](at, enrich(event, at))
        state = capJournal(result.state)
        scheduler = pushAll(scheduler, result.newEvents)
      }
    }
  }

  return {
    advanceTo(t) {
      run(t)
      if (!state.halted) state = { ...state, now: Math.max(state.now, t) }
    },
    stepOnce() {
      const next = peekTime(scheduler)
      if (next === undefined) return
      run(next)
      if (!state.halted) state = { ...state, now: next }
    },
    reset() {
      state = createEngineState(options.topology, options.seed)
      scheduler = pushAll(createScheduler(), seedEvents(options))
      processed = 0
    },
    nextEventTime() {
      return peekTime(scheduler)
    },
    snapshot() {
      return state
    },
    issues,
  }
}
