import { createRng } from '../../../shell/kernel/rng'
import { createPartition } from './log'
import { partitionKey } from './types'
import type { KafkaProducerSpec, KafkaState, KafkaTopicSpec } from './types'

/**
 * Điểm khởi đầu cho mọi test `produce.ts`: một topic `orders` một partition, một
 * broker `b1` vừa leader vừa replica duy nhất, một producer `p1` mặc định — theo
 * đúng mẫu `emptyState` của `src/brokers/redis/engine/testState.ts`. Test tự
 * override từng phần khi cần nhiều partition/replica/producer khác nhau, hoặc
 * chỉnh trực tiếp partition trả về (như `log.test.ts` làm với `isr`/`replicaState`)
 * khi cần một tổ hợp mà tham số ở đây không phủ tới.
 */
export function testState(overrides?: {
  topics?: KafkaTopicSpec[]
  producers?: KafkaProducerSpec[]
  /** Danh sách replica dùng cho MỌI partition được tạo — mặc định chỉ `['b1']`. */
  replicas?: string[]
  brokersOnline?: Record<string, boolean>
}): KafkaState {
  const topics = overrides?.topics ?? [{ name: 'orders', partitions: 1, replicationFactor: 1 }]
  const producers = overrides?.producers ?? [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 } }]
  const replicas = overrides?.replicas ?? ['b1']
  const leader = replicas[0] ?? 'b1'

  const partitions: KafkaState['partitions'] = {}
  for (const topic of topics) {
    for (let index = 0; index < topic.partitions; index++) {
      partitions[partitionKey(topic.name, index)] = createPartition({ topic: topic.name, index, leader, replicas })
    }
  }

  const producerRuntimes: KafkaState['producers'] = {}
  for (const producer of producers) {
    producerRuntimes[producer.id] = {
      batches: {},
      inFlightRequests: 0,
      nextSequence: {},
      roundRobinCounter: 0,
      // `stickyPartition` cố tình để trống (không gán `undefined` tường minh) —
      // "chưa từng chọn" là trạng thái vắng mặt property, không phải một giá trị.
      rng: createRng(1),
    }
  }

  // Merge, không thay thế: một override một phần như `{ b1: false }` với
  // nhiều replica phải chỉ tắt `b1`, các broker còn lại vẫn `true` mặc định —
  // thay thế hoàn toàn sẽ để chúng `undefined`, và `=== false` đọc `undefined`
  // là "không offline", một footgun im lặng cho test nhiều replica.
  const brokersOnline = {
    ...Object.fromEntries(replicas.map((r) => [r, true])),
    ...(overrides?.brokersOnline ?? {}),
  }

  return {
    now: 0,
    seq: 0,
    rng: createRng(1),
    journal: [],
    partitions,
    groups: {},
    producers: producerRuntimes,
    consumers: {},
    brokersOnline,
    controller: { brokerId: leader, epoch: 0 },
    metrics: {
      recordsProduced: 0,
      recordsConsumed: 0,
      bytesProduced: 0,
      rebalances: 0,
      commits: 0,
      retries: 0,
      duplicatesPrevented: 0,
      underReplicatedPartitions: 0,
      lagTotal: 0,
      abortedRecordsSkipped: 0,
      recordsExpired: 0,
      recordsCompacted: 0,
    },
    inFlight: [],
    nextProducerId: 0,
  }
}
