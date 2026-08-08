import { createScheduler, peekTime, popDue, pushAll, type Scheduler } from './clock'
import type { KernelState, SimEvent } from './types'

export const MAX_EVENTS_PER_RUN = 200_000
export const MAX_JOURNAL = 5_000

export interface Simulation<S> {
  advanceTo(t: number): void
  stepOnce(): void
  reset(): void
  nextEventTime(): number | undefined
  snapshot(): S
}

export interface KernelOptions<S extends KernelState, T extends string> {
  createState(): S
  seedEvents(): SimEvent<T>[]
  reducers: Record<T, (state: S, event: SimEvent<T>) => { state: S; newEvents: SimEvent<T>[] }>
  /** Fills in payload fields only knowable from live state (AMQP crash handling). */
  enrich?(event: SimEvent<T>, current: S): SimEvent<T>
  /** True when validation found a fatal issue: the kernel then never dispatches. */
  fatal?: boolean
  maxEvents?: number
}

function capJournal<S extends KernelState>(state: S): S {
  if (state.journal.length <= MAX_JOURNAL) return state
  return { ...state, journal: state.journal.slice(state.journal.length - MAX_JOURNAL) }
}

export function createKernel<S extends KernelState, T extends string>(
  options: KernelOptions<S, T>,
): Simulation<S> {
  let state = options.createState()
  let scheduler: Scheduler<T> = pushAll(createScheduler<T>(), options.seedEvents())
  let processed = 0
  const ceiling = options.maxEvents ?? MAX_EVENTS_PER_RUN

  function run(upTo: number): void {
    // A fatal validation error and a halted run are both terminal: never dispatch.
    if (options.fatal || state.halted) return
    for (;;) {
      // Drain exactly one timestamp per iteration. Events generated while applying
      // "due" land in the scheduler at their own time with a higher seq, so the next
      // iteration picks them up in order instead of leaving them stranded until the
      // whole batch up to `upTo` has been applied.
      const nextTime = peekTime(scheduler)
      if (nextTime === undefined || nextTime > upTo) return
      const [due, rest] = popDue(scheduler, nextTime)
      scheduler = rest
      for (const event of due) {
        // The ceiling counts events across the whole run and must be checked inside
        // this inner loop: a cycle can regenerate events within one popDue batch.
        if (processed >= ceiling) {
          state = { ...state, halted: { reason: `event ceiling of ${ceiling} reached; the topology may loop` } }
          return
        }
        processed++
        const at = { ...state, now: event.at }
        const enriched = options.enrich ? options.enrich(event, at) : event
        const result = options.reducers[event.type](at, enriched)
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
      state = options.createState()
      scheduler = pushAll(createScheduler<T>(), options.seedEvents())
      processed = 0
    },
    nextEventTime() {
      return peekTime(scheduler)
    },
    snapshot() {
      return state
    },
  }
}
