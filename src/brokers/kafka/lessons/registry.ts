import type { LessonGroupSpec } from '../../../shell/lesson/types'
import type { KafkaLesson } from './types'
import { topicPartition } from './01-topic-partition'
import { brokerCluster } from './02-broker-cluster'
import { keyPartitioning } from './03-key-partitioning'
import { produceConsume } from './04-produce-consume'
import { offsets } from './05-offsets'
import { acks } from './06-acks'
import { batchingLinger } from './07-batching-linger'
import { partitioner } from './08-partitioner'
import { idempotentProducer } from './09-idempotent-producer'
import { orderingRetries } from './10-ordering-retries'
import { consumerGroup } from './11-consumer-group'
import { rebalance } from './12-rebalance'
import { assignors } from './13-assignors'
import { commitStrategies } from './14-commit-strategies'
import { consumerLag } from './15-consumer-lag'
import { maxPollInterval } from './16-max-poll-interval'
import { replicationIsr } from './17-replication-isr'
import { minInsyncReplicas } from './18-min-insync-replicas'
import { leaderElection } from './19-leader-election'
import { retention } from './20-retention'
import { compaction } from './21-compaction'

export const KAFKA_LESSON_GROUPS: LessonGroupSpec[] = [
  { id: 'basics', label: 'Cơ bản' },
  { id: 'producer', label: 'Producer' },
  { id: 'consumer', label: 'Consumer & Group' },
  { id: 'durability', label: 'Độ bền' },
  { id: 'advanced', label: 'Nâng cao' },
]

/** Thứ tự sidebar cũng là thứ tự dạy: mỗi bài giả định các bài phía trên nó. */
export const LESSONS: KafkaLesson[] = [
  topicPartition,
  brokerCluster,
  keyPartitioning,
  produceConsume,
  offsets,
  acks,
  batchingLinger,
  partitioner,
  idempotentProducer,
  orderingRetries,
  consumerGroup,
  rebalance,
  assignors,
  commitStrategies,
  consumerLag,
  maxPollInterval,
  replicationIsr,
  minInsyncReplicas,
  leaderElection,
  retention,
  compaction,
]
