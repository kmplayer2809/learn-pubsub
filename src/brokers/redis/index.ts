import {
  createRedisSimulation,
  type RedisFault,
  type RedisScriptedCommand,
  type RedisState,
  type RedisTopology,
  type RedisValidationIssue,
} from './engine'
import { LESSONS, REDIS_LESSON_GROUPS } from './lessons/registry'
import { KeyspacePanel } from './ui/KeyspacePanel'
import { issueText } from './ui/issueText'
import { NodeConfig } from './ui/NodeConfig'
import { ClientNode, ReplicaNode, SentinelNode, ServerNode } from './ui/nodes'
import { toFlowEdges, toFlowNodes } from './ui/toFlow'
import type { BrokerModule } from '../types'

export const redis: BrokerModule<RedisState, RedisTopology, RedisScriptedCommand, RedisValidationIssue> = {
  id: 'redis',
  label: 'Redis',
  lessonGroups: REDIS_LESSON_GROUPS,
  lessons: LESSONS,
  defaultLessonId: '01-strings',
  emptyTopology: {
    clients: [],
    server: { id: 'redis', label: 'Redis', position: { x: 0, y: 0 } },
  },
  createSimulation: (options) =>
    createRedisSimulation({
      topology: options.topology,
      script: options.script,
      seed: options.seed,
      // See `src/shell/useSimulation.ts:95` — the shell reads any lesson's
      // `.failures` field generically and hands it through opaquely here,
      // the same mechanism RabbitMQ's `ScriptedFailure[]` already relies on.
      failures: options.failures as RedisFault[] | undefined,
      maxEvents: options.maxEvents,
    }),
  nodeTypes: { client: ClientNode, server: ServerNode, replica: ReplicaNode, sentinel: SentinelNode },
  toNodes: (topology, state, highlight) => toFlowNodes(topology, state, highlight),
  // Redis' `toFlowEdges` takes only the topology: a client always has exactly the two
  // edges to and from the server, so no script can change the graph (see `ui/toFlow.ts`).
  toEdges: (topology) => toFlowEdges(topology),
  inFlight: (state) => state.inFlight,
  StatePanel: KeyspacePanel,
  issueText,
  // See RabbitMQ's `metrics` comment (`../rabbitmq/index.ts`) for why this must spread
  // rather than cast: `RedisMetrics` is an interface, so it never gets an implicit index
  // signature and does not structurally satisfy `Record<string, number>` on its own.
  metrics: (state) => ({ ...state.metrics }),
  NodeConfig,
  // No `sandbox`, no `ExportDialog`: Redis has neither yet. Both slots are optional in
  // `BrokerModule`, so they're simply left off rather than stubbed.
}
