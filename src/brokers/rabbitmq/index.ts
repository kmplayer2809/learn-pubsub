import {
  createSimulation,
  type EngineState,
  type ScriptedAction,
  type ScriptedFailure,
  type Topology,
  type ValidationIssue,
} from './engine'
import { LESSONS, LESSON_GROUPS } from './lessons/registry'
import { SandboxPanel } from './sandbox/SandboxPanel'
import { useSandboxStore } from './sandbox/sandboxStore'
import { InFlightPanel } from './ui/InFlightPanel'
import { useRabbitEditing } from './ui/editing'
import { vietnameseIssueMessage as issueText } from './ui/issueText'
import { ConsumerNode, ExchangeNode, PublisherNode, QueueNode } from './ui/nodes'
import { toFlowEdges, toFlowNodes } from './ui/toFlow'
import type { BrokerModule } from '../types'

// A user-built topology can loop (a DLX pointing back into its own source exchange is
// one keystroke away) and, unlike a lesson script, nobody vetted it. A lower ceiling
// makes a runaway surface `state.halted` before it can bog the tab down.
const SANDBOX_MAX_EVENTS = 20_000

// Sandbox runs are open-ended, but the transport scrubber still needs a finite range to
// draw; this matches the generator's fixed 60-second horizon plus headroom.
const SANDBOX_TRANSPORT_DURATION_MS = 60_000

export const rabbitmq: BrokerModule<EngineState, Topology, ScriptedAction, ValidationIssue> = {
  id: 'rabbitmq',
  label: 'RabbitMQ',
  lessonGroups: LESSON_GROUPS,
  lessons: LESSONS,
  defaultLessonId: '01-hello-world',
  emptyTopology: { publishers: [], exchanges: [], queues: [], consumers: [], bindings: [] },
  createSimulation: (options) =>
    createSimulation({
      topology: options.topology,
      script: options.script,
      // The shell carries `failures` opaquely (it is AMQP-only); this is the one
      // place that knows what shape it really has.
      failures: options.failures as ScriptedFailure[] | undefined,
      seed: options.seed,
      maxEvents: options.maxEvents,
    }),
  nodeTypes: { publisher: PublisherNode, exchange: ExchangeNode, queue: QueueNode, consumer: ConsumerNode },
  toFlow: (topology, state, script, highlight) => ({
    nodes: toFlowNodes(topology, state, highlight),
    edges: toFlowEdges(topology, script),
  }),
  inFlight: (state) =>
    state.inFlight.map((f) => ({
      message: { id: f.message.id, solid: f.message.persistent },
      edgeId: f.edgeId,
      fromT: f.fromT,
      toT: f.toT,
      tone: f.tone,
    })),
  StatePanel: InFlightPanel,
  issueText,
  sandbox: {
    Panel: SandboxPanel,
    getTopology: () => useSandboxStore.getState().topology,
    getScript: () => useSandboxStore.getState().script,
    subscribe: (onStoreChange) => useSandboxStore.subscribe(onStoreChange),
    reset: () => useSandboxStore.getState().reset(),
    maxEvents: SANDBOX_MAX_EVENTS,
    transportDurationMs: SANDBOX_TRANSPORT_DURATION_MS,
    useEditing: useRabbitEditing,
  },
}
