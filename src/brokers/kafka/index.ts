import {
  createKafkaSimulation,
  type KafkaFault,
  type KafkaScriptedCommand,
  type KafkaState,
  type KafkaTopology,
  type KafkaValidationIssue,
} from './engine'
import { KAFKA_LESSON_GROUPS, LESSONS } from './lessons/registry'
import { LogPanel } from './ui/LogPanel'
import { issueText } from './ui/issueText'
import { NodeConfig } from './ui/NodeConfig'
import { BrokerNode, ConsumerGroupNode, ConsumerNode, PartitionNode, ProducerNode } from './ui/nodes'
import { toFlowEdges, toFlowNodes } from './ui/toFlow'
import type { BrokerModule } from '../types'

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
  // Chưa có `sandbox`, chưa có `ExportDialog` — cả hai là slot optional trong
  // `BrokerModule`, nên để trống chứ không stub. Plan sau bổ sung.
}
