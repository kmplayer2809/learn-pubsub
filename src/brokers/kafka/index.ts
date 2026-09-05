import {
  createKafkaSimulation,
  type KafkaFault,
  type KafkaScriptedCommand,
  type KafkaState,
  type KafkaTopology,
  type KafkaValidationIssue,
} from './engine'
import { KAFKA_LESSON_GROUPS, LESSONS } from './lessons/registry'
import { ExportDialog } from './sandbox/ExportDialog'
import { SandboxPanel } from './sandbox/SandboxPanel'
import { getScript, getTopology, resetSandbox, subscribe } from './sandbox/kafkaStore'
import { LogPanel } from './ui/LogPanel'
import { onConnect, onNodesChange } from './ui/editing'
import { issueText } from './ui/issueText'
import { NodeConfig } from './ui/NodeConfig'
import { BrokerNode, ConsumerGroupNode, ConsumerNode, PartitionNode, ProducerNode } from './ui/nodes'
import { toFlowEdges, toFlowNodes } from './ui/toFlow'
import type { BrokerModule } from '../types'

// A user-built topology can loop and, unlike a lesson script, nobody vetted it — mirrors
// RabbitMQ's own `SANDBOX_MAX_EVENTS` reasoning in `rabbitmq/index.ts`.
const SANDBOX_MAX_EVENTS = 20_000

// Sandbox runs are open-ended; this just gives the transport scrubber a finite range to
// draw, same role as RabbitMQ's `SANDBOX_TRANSPORT_DURATION_MS`.
const SANDBOX_TRANSPORT_DURATION_MS = 60_000

export const kafka: BrokerModule<KafkaState, KafkaTopology, KafkaScriptedCommand, KafkaValidationIssue> = {
  id: 'kafka',
  label: 'Kafka',
  lessonGroups: KAFKA_LESSON_GROUPS,
  lessons: LESSONS,
  defaultLessonId: '01-topic-partition',
  emptyTopology: {
    brokers: [], topics: [], producers: [], consumers: [], controllerBrokerId: 'b1',
  },
  createSimulation: (options) =>
    createKafkaSimulation({
      topology: options.topology,
      script: options.script,
      seed: options.seed,
      failures: options.failures as KafkaFault[] | undefined,
      maxEvents: options.maxEvents,
    }),
  nodeTypes: {
    producer: ProducerNode,
    broker: BrokerNode,
    partition: PartitionNode,
    consumer: ConsumerNode,
    consumerGroup: ConsumerGroupNode,
  },
  toNodes: (topology, state, highlight) => toFlowNodes(topology, state, highlight),
  // Edge của Kafka chỉ phụ thuộc topology: producer nối tới mọi partition của topic
  // nó ghi, consumer nối tới mọi partition nó subscribe. Cạnh nào đang "sống" là
  // việc của `inFlight`, không phải của edge — nên script không đổi được đồ thị.
  toEdges: (topology) => toFlowEdges(topology),
  inFlight: (state) => state.inFlight,
  StatePanel: LogPanel,
  issueText,
  // Spread chứ không cast: `KafkaMetrics` là interface nên không có index signature
  // ngầm, và tự nó không thoả `Record<string, number>` về mặt cấu trúc.
  metrics: (state) => ({ ...state.metrics }),
  NodeConfig,
  ExportDialog,
  sandbox: {
    Panel: SandboxPanel,
    getTopology,
    getScript,
    subscribe,
    reset: resetSandbox,
    maxEvents: SANDBOX_MAX_EVENTS,
    transportDurationMs: SANDBOX_TRANSPORT_DURATION_MS,
    editing: { onNodesChange, onConnect },
  },
}
