import { HANDLERS, isCommandName, type RedisCommandName } from './commands'
import { applyActiveExpire } from './expiry'
import { formatCommand, formatReply, type Reply } from './reply'
import type { BlockedClient, RedisEventType, RedisFlight, RedisState, RedisTopology } from './types'
import {
  validateRedisTopology,
  type RedisIssueCode,
  type RedisScriptedCommand,
  type RedisValidationIssue,
  type UnvalidatedScriptedCommand,
} from './validate'
import { createRng } from '../../../shell/kernel/rng'
import { createKernel, type Simulation } from '../../../shell/kernel/run'
import type { SimEvent } from '../../../shell/kernel/types'

export * from './types'
export {
  validateRedisTopology,
  type RedisIssueCode,
  type RedisScriptedCommand,
  type RedisValidationIssue,
  type UnvalidatedScriptedCommand,
}
export { createRng, nextFloat, nextInt, type RngState } from '../../../shell/kernel/rng'
export { MAX_EVENTS_PER_RUN, MAX_JOURNAL, type Simulation } from '../../../shell/kernel/run'

/** Virtual milliseconds a command or its reply spends animating along one edge. */
export const COMMAND_TRAVEL_MS = 120

/** Real Redis' own default gap between active-expire passes, in ms — mirrors `expiry.ts`. */
const DEFAULT_ACTIVE_EXPIRE_EVERY_MS = 100

/** Flight tone used when a scripted command does not name one. */
const DEFAULT_TONE = 'crimson'

export interface RedisSimulationOptions {
  topology: RedisTopology
  script: RedisScriptedCommand[]
  seed: number
  /** Overrides MAX_EVENTS_PER_RUN — see the RabbitMQ module for why the Sandbox needs this. */
  maxEvents?: number
}

type ReduceResult = { state: RedisState; newEvents: SimEvent<RedisEventType>[] }
type Reducer = (state: RedisState, event: SimEvent<RedisEventType>) => ReduceResult

// --- Payload extraction --------------------------------------------------
// SimEvent.payload is `Record<string, unknown>` by design (the kernel is shared
// across brokers and cannot know Redis' event shapes). These narrow it back to
// concrete types via runtime checks the compiler can trust as type guards,
// rather than `as` assertions: every field a Redis event carries is written by
// this same file (seedEvents / applyCommand / applyReply), so the checks never
// actually fail — they exist so the compiler, not a cast, is the authority.

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`redis engine: payload.${field} is not a string`)
  return value
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return asString(value, field)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function asStringArray(value: unknown, field: string): string[] {
  if (!isStringArray(value)) throw new Error(`redis engine: payload.${field} is not a string[]`)
  return value
}

function asCommandName(value: unknown): RedisCommandName {
  const name = asString(value, 'name')
  if (!isCommandName(name)) throw new Error(`redis engine: "${name}" reached dispatch unvalidated`)
  return name
}

// --- State + sequencing ---------------------------------------------------

function createState(topology: RedisTopology, seed: number): RedisState {
  return {
    now: 0,
    seq: 0,
    rng: createRng(seed),
    journal: [],
    topology,
    keys: {},
    keyOrder: [],
    metrics: { commands: 0, hits: 0, misses: 0, expired: 0, evicted: 0, keysCount: 0, memoryUsed: 0 },
    inFlight: [],
    blocked: [],
    commandCounter: 0,
  }
}

function nextSeq(state: RedisState): [number, RedisState] {
  return [state.seq + 1, { ...state, seq: state.seq + 1 }]
}

/** Drops any `InFlight` whose animation has already arrived as of `state.now`. */
function pruneFlights(state: RedisState): RedisState {
  const kept = state.inFlight.filter((flight) => flight.toT > state.now)
  if (kept.length === state.inFlight.length) return state
  return { ...state, inFlight: kept }
}

// --- Seeding ----------------------------------------------------------------

function seedEvents(options: RedisSimulationOptions): SimEvent<RedisEventType>[] {
  let seq = 0
  const commands: SimEvent<RedisEventType>[] = options.script.map((command, index) => ({
    at: command.at,
    seq: seq++,
    type: 'command',
    payload: {
      clientId: command.clientId,
      name: command.name,
      args: command.args,
      tone: command.tone,
      // Deterministic and stable across replays: derived from the script's own
      // index, never from a counter that could drift between two runs.
      commandId: `cmd-${index}`,
    },
  }))

  // Something has to kick off the active-expire cycle's self-rescheduling loop.
  const activeExpireSeed: SimEvent<RedisEventType> = {
    at: options.topology.server.activeExpireEveryMs ?? DEFAULT_ACTIVE_EXPIRE_EVERY_MS,
    seq: seq++,
    type: 'activeExpire',
    payload: {},
  }

  return [...commands, activeExpireSeed]
}

// --- Reducers ----------------------------------------------------------------

function applyCommand(state: RedisState, event: SimEvent<RedisEventType>): ReduceResult {
  const clientId = asString(event.payload.clientId, 'clientId')
  const name = asCommandName(event.payload.name)
  const args = asStringArray(event.payload.args, 'args')
  const tone = asOptionalString(event.payload.tone, 'tone') ?? DEFAULT_TONE
  const commandId = asString(event.payload.commandId, 'commandId')

  const serverId = state.topology.server.id
  const flight: RedisFlight = {
    message: { id: `${commandId}-out`, label: name, solid: true },
    edgeId: `${clientId}->${serverId}`,
    fromT: state.now,
    toT: state.now + COMMAND_TRAVEL_MS,
    tone,
  }

  const [seq, afterSeq] = nextSeq(state)
  const nextState: RedisState = { ...afterSeq, inFlight: [...state.inFlight, flight] }
  const replyEvent: SimEvent<RedisEventType> = {
    at: state.now + COMMAND_TRAVEL_MS,
    seq,
    type: 'reply',
    payload: { clientId, name, args, tone, commandId },
  }
  return { state: nextState, newEvents: [replyEvent] }
}

function applyReply(state: RedisState, event: SimEvent<RedisEventType>): ReduceResult {
  const clientId = asString(event.payload.clientId, 'clientId')
  const name = asCommandName(event.payload.name)
  const args = asStringArray(event.payload.args, 'args')
  const tone = asOptionalString(event.payload.tone, 'tone') ?? DEFAULT_TONE
  const commandId = asString(event.payload.commandId, 'commandId')

  const handled = HANDLERS[name]({ state, clientId, args })

  // The command was issued and counted the instant the client sent it, same
  // as real Redis — whether it completes now or parks. Parking must not count
  // it again when the client later wakes (applyUnblock does not touch this).
  const withMetrics: RedisState = {
    ...handled.state,
    metrics: { ...handled.state.metrics, commands: handled.state.metrics.commands + 1 },
  }

  if (handled.parked) {
    // The reply has not happened yet: no journal line, no return flight. Only
    // schedule a wake-up if the client didn't ask to block forever — the
    // handler always appends the just-parked entry last, so that's the
    // deadline to schedule against (the `parked` flag already tells us
    // parking happened; this is just finding which entry, not re-detecting
    // whether it did).
    const parkedEntry = withMetrics.blocked[withMetrics.blocked.length - 1]
    if (parkedEntry?.timeoutAt === undefined) return { state: withMetrics, newEvents: [] }

    const [seq, afterSeq] = nextSeq(withMetrics)
    const timeoutEvent: SimEvent<RedisEventType> = {
      at: parkedEntry.timeoutAt,
      seq,
      type: 'unblock',
      payload: {},
    }
    return { state: afterSeq, newEvents: [timeoutEvent] }
  }

  const withJournal: RedisState = {
    ...withMetrics,
    journal: [
      ...withMetrics.journal,
      {
        at: state.now,
        type: 'reply',
        text: `${formatCommand(name, args)} → ${formatReply(handled.reply)}`,
        nodeId: clientId,
        messageId: commandId,
      },
    ],
  }

  const serverId = withJournal.topology.server.id
  const returnFlight: RedisFlight = {
    message: { id: `${commandId}-in`, label: name, solid: false },
    edgeId: `${serverId}->${clientId}`,
    fromT: withJournal.now,
    toT: withJournal.now + COMMAND_TRAVEL_MS,
    tone,
  }
  // No nextSeq call here: the return flight is not a scheduled SimEvent, so
  // there is nothing downstream that needs a fresh seq to tie-break against.
  const withFlight: RedisState = { ...withJournal, inFlight: [...withJournal.inFlight, returnFlight] }

  // A push can hand an element to a client parked on BLPOP. Schedule the wake
  // as its own event rather than resolving it inline, so it goes through the
  // scheduler like everything else and stays ordered against other events at
  // the same timestamp.
  const isPush = name === 'LPUSH' || name === 'RPUSH'
  const pushedKey = args[0]
  const hasWaiter = isPush && pushedKey !== undefined && withFlight.blocked.some((entry) => entry.keys.includes(pushedKey))
  if (!hasWaiter) return { state: withFlight, newEvents: [] }

  const [unblockSeq, afterUnblockSeq] = nextSeq(withFlight)
  const unblockEvent: SimEvent<RedisEventType> = {
    at: withFlight.now,
    seq: unblockSeq,
    type: 'unblock',
    payload: {},
  }
  return { state: afterUnblockSeq, newEvents: [unblockEvent] }
}

/** Builds the return `RedisFlight` a woken or timed-out BLPOP client sees, server back to client. */
function blpopReturnFlight(state: RedisState, entry: BlockedClient): RedisFlight {
  return {
    message: { id: `${entry.commandId}-in`, label: 'BLPOP', solid: false },
    edgeId: `${state.topology.server.id}->${entry.clientId}`,
    fromT: state.now,
    toT: state.now + COMMAND_TRAVEL_MS,
    // BlockedClient carries no tone — the scripted command's tone lived on the
    // event payload, long gone by the time the client wakes — so fall back to
    // the engine's default rather than inventing a per-client one.
    tone: DEFAULT_TONE,
  }
}

function applyUnblock(state: RedisState, _event: SimEvent<RedisEventType>): ReduceResult {
  let working = state

  // Wakes before timeouts — but only within this one call. Both exits resolving
  // in the same reducer invocation means an arriving element beats a deadline
  // that has just passed, which is the friendlier lesson.
  //
  // It does NOT mean a push always wins a tie. A timeout is armed as its own
  // `unblock` event when the client parks, so it carries a lower `seq` than any
  // reply generated later; a push whose reply lands on exactly the deadline
  // therefore sorts second and finds the client already gone, leaving its
  // element unclaimed in the list. Deterministic, defensible (the timeout was
  // armed first), and a one-millisecond window no lesson should sit on
  // deliberately — but do not read the ordering here as a guarantee.
  for (;;) {
    const woken = nextWakeable(working)
    if (!woken) break

    const { index, entry, key } = woken
    const popped = HANDLERS.LPOP({ state: working, clientId: entry.clientId, args: [key] })
    // `nextWakeable` only ever names a key that currently holds a non-empty
    // list, so LPOP always pops a real element here — never nil. The fallback
    // exists purely so this stays a type guard rather than an `as` assertion.
    const poppedValue = popped.reply.kind === 'bulk' ? popped.reply.value : ''
    const reply: Reply = { kind: 'array', value: [key, poppedValue] }

    working = {
      ...popped.state,
      blocked: popped.state.blocked.filter((_, i) => i !== index),
      journal: [
        ...popped.state.journal,
        {
          at: working.now,
          type: 'unblock',
          text: `${formatCommand('BLPOP', entry.args)} → ${formatReply(reply)}`,
          nodeId: entry.clientId,
          messageId: entry.commandId,
        },
      ],
      inFlight: [...popped.state.inFlight, blpopReturnFlight(working, entry)],
    }
  }

  // Then timeouts: any remaining entry whose deadline has passed exits with a
  // nil, even though no push ever showed up for it.
  const timedOut = working.blocked.filter((entry) => entry.timeoutAt !== undefined && entry.timeoutAt <= working.now)
  for (const entry of timedOut) {
    working = {
      ...working,
      blocked: working.blocked.filter((candidate) => candidate !== entry),
      journal: [
        ...working.journal,
        {
          at: working.now,
          type: 'unblock',
          text: `${formatCommand('BLPOP', entry.args)} → ${formatReply({ kind: 'nil' })}`,
          nodeId: entry.clientId,
          messageId: entry.commandId,
        },
      ],
      inFlight: [...working.inFlight, blpopReturnFlight(working, entry)],
    }
  }

  return { state: working, newEvents: [] }
}

/** The oldest blocked client whose watched key currently holds an element, if any. */
function nextWakeable(state: RedisState): { index: number; entry: BlockedClient; key: string } | undefined {
  for (let index = 0; index < state.blocked.length; index++) {
    const entry = state.blocked[index]!
    const key = entry.keys.find((candidate) => {
      const record = state.keys[candidate]
      return record !== undefined && record.value.type === 'list' && record.value.value.length > 0
    })
    if (key !== undefined) return { index, entry, key }
  }
  return undefined
}

function withPrune(reducer: Reducer): Reducer {
  return (state, event) => reducer(pruneFlights(state), event)
}

// `evict` has no reducer body yet: eviction happens inline inside `writeKey`,
// and nothing schedules an `evict` event today. The type exists so the
// Sandbox can surface a manual, FLUSH-style eviction later without widening
// `RedisEventType` again.
const REDUCERS: Record<RedisEventType, Reducer> = {
  command: withPrune(applyCommand),
  reply: withPrune(applyReply),
  activeExpire: withPrune(applyActiveExpire),
  evict: withPrune((state) => ({ state, newEvents: [] })),
  unblock: withPrune(applyUnblock),
}

export function createRedisSimulation(
  options: RedisSimulationOptions,
): Simulation<RedisState> & { readonly issues: RedisValidationIssue[] } {
  const issues = validateRedisTopology(options.topology, options.script)
  const sim = createKernel<RedisState, RedisEventType>({
    createState: () => createState(options.topology, options.seed),
    seedEvents: () => seedEvents(options),
    reducers: REDUCERS,
    fatal: issues.some((issue) => issue.severity === 'error'),
    maxEvents: options.maxEvents,
  })
  return Object.assign(sim, { issues })
}
