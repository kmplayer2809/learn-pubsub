import { appendRecord, estimateBytes, recomputeHighWatermark } from './log'
import { pickPartition } from './partitioner'
import { partitionKey } from './types'
import type { KafkaEventType, KafkaProducerSpec, KafkaState, KafkaTopicSpec, NodeId, PartitionState, ProducerRuntime } from './types'
import type { JournalEntry, SimEvent } from '../../../shell/kernel/types'

// ---------------------------------------------------------------------------
// Producer path — batching (`enqueueRecord`), flush (`flushBatch`), và cách
// `acks` quyết định khi nào một produce coi là xong (`resolveAcks`). Reducer
// thật gọi các hàm này từ bảng dispatch theo `KafkaEventType` — đó là Task 6,
// chưa nối ở đây. File này chỉ đảm bảo state/event sinh ra đúng.
// ---------------------------------------------------------------------------

// Kafka thật mặc định 16 KiB — một batch nhỏ hơn ngưỡng này không bao giờ flush
// vì đầy, chỉ flush khi hết `linger.ms`.
const DEFAULT_BATCH_SIZE_BYTES = 16_384

/**
 * Round trip mạng ảo cho `produce-response` quay lại producer sau khi leader
 * (và, với `acks=all`, ISR) đã ghi xong — cùng vai trò với `TRAVEL_MS`
 * (RabbitMQ, `broker.ts`) / `COMMAND_TRAVEL_MS` (Redis, `engine/index.ts`), chỉ
 * đặt tên riêng vì request produce là khái niệm của riêng Kafka.
 */
export const PRODUCE_RESPONSE_TRAVEL_MS = 50

export interface EnqueueArgs {
  producer: KafkaProducerSpec
  topic: KafkaTopicSpec
  key: string | null
  value: string | null
  headers?: Record<string, string>
  /** Partition chỉ định tường minh trong script — bỏ qua partitioner hoàn toàn. */
  partition?: number
  at: number
}

export interface FlushBatchArgs {
  producer: KafkaProducerSpec
  topic: KafkaTopicSpec
  partition: number
  at: number
}

export interface ResolveAcksArgs {
  acks: 0 | 1 | 'all'
  topic: KafkaTopicSpec
  partition: number
  /** Offset của record mới nhất trong batch vừa flush — chỉ có ý nghĩa SAU khi
   *  append; gọi trước khi append (gate ISR trong `flushBatch`) thì chỉ nhánh
   *  `.error` được đọc, giá trị `offset` lúc đó không quan trọng. */
  offset: number
}

// --- Tiện ích thuần nội bộ --------------------------------------------------

function nextSeq(state: KafkaState): [number, KafkaState] {
  return [state.seq + 1, { ...state, seq: state.seq + 1 }]
}

function pushJournal(state: KafkaState, entry: JournalEntry): KafkaState {
  return { ...state, journal: [...state.journal, entry] }
}

function getProducerRuntime(state: KafkaState, id: NodeId): ProducerRuntime {
  const runtime = state.producers[id]
  if (!runtime) throw new Error(`kafka engine: unknown producer ${id}`)
  return runtime
}

function getPartitionState(state: KafkaState, key: string): PartitionState {
  const partition = state.partitions[key]
  if (!partition) throw new Error(`kafka engine: unknown partition ${key}`)
  return partition
}

function putRuntime(state: KafkaState, id: NodeId, runtime: ProducerRuntime): KafkaState {
  return { ...state, producers: { ...state.producers, [id]: runtime } }
}

function withoutBatch(batches: ProducerRuntime['batches'], key: string): ProducerRuntime['batches'] {
  const next = { ...batches }
  delete next[key]
  return next
}

function responseEvent(
  seq: number,
  at: number,
  producerId: NodeId,
  topic: string,
  partition: number,
  extra: Record<string, unknown>,
): SimEvent<KafkaEventType> {
  return {
    at,
    seq,
    type: 'produce-response',
    payload: { producerId, topic, partition, ...extra },
  }
}

// --- API ---------------------------------------------------------------

/**
 * Đưa một record vào batch accumulator của producer. Trả về event `batch-flush`
 * mới **chỉ khi** batch vừa được mở: một batch chỉ cần đúng một hẹn giờ flush,
 * và hẹn thêm lần nữa cho record thứ hai sẽ flush cùng batch đó hai lần.
 */
export function enqueueRecord(
  state: KafkaState,
  args: EnqueueArgs,
): { state: KafkaState; newEvents: SimEvent<KafkaEventType>[] } {
  const { producer, topic, key, value, headers, at } = args
  const runtime = getProducerRuntime(state, producer.id)

  let partition: number
  let nextRuntime = runtime
  if (args.partition !== undefined) {
    // Partition chỉ định tường minh: bỏ qua partitioner hoàn toàn, và vì vậy
    // không đụng tới roundRobinCounter/stickyPartition/rng — chúng chỉ đổi khi
    // partitioner thực sự chạy.
    partition = args.partition
  } else {
    const picked = pickPartition({
      key,
      partitionCount: topic.partitions,
      partitioner: producer.partitioner ?? 'default',
      roundRobinCounter: runtime.roundRobinCounter,
      stickyPartition: runtime.stickyPartition,
      rng: runtime.rng,
    })
    partition = picked.partition
    // `nextSticky` có thể là `undefined` một cách có chủ đích (xem
    // partitioner.ts) — ghi nguyên trạng thái đó xuống `ProducerRuntime`, không
    // bao giờ `?? 0`/`?? runtime.stickyPartition`. Ép nó thành số ở CHÍNH chỗ
    // này là bug đã xảy ra thật: caller "sửa lại" giá trị an toàn mà
    // `pickPartition` cẩn thận trả về.
    nextRuntime = {
      ...runtime,
      roundRobinCounter: picked.nextRoundRobinCounter,
      stickyPartition: picked.nextSticky,
      rng: picked.rng,
    }
  }

  const pKey = partitionKey(topic.name, partition)
  const bytes = estimateBytes(key, value)
  const record = { key, value, headers, timestamp: at, bytes }

  const existing = nextRuntime.batches[pKey]
  const events: SimEvent<KafkaEventType>[] = []
  let workingState = state
  let batchBytes: number
  let openedAt: number

  if (!existing) {
    batchBytes = bytes
    openedAt = at
    const lingerMs = producer.lingerMs ?? 0
    const [seq, afterSeq] = nextSeq(state)
    workingState = afterSeq
    events.push({ at: at + lingerMs, seq, type: 'batch-flush', payload: { producerId: producer.id, topic: topic.name, partition } })
  } else {
    batchBytes = existing.bytes + bytes
    openedAt = existing.openedAt
  }

  // Trigger đầy batch độc lập với trigger linger ở trên — cả hai có thể cùng
  // nhắm một batch (ví dụ record đầu tiên đã đủ lớn để vượt batchSize). Đó là
  // lý do `flushBatch` phải chịu được bị gọi hai lần cho cùng một batch: không
  // có cơ chế huỷ event nào ở kernel để rút lại hẹn giờ linger khi size đã lo
  // xong việc flush trước.
  const batchSize = producer.batchSize ?? DEFAULT_BATCH_SIZE_BYTES
  if (batchBytes >= batchSize) {
    const [seq, afterSeq] = nextSeq(workingState)
    workingState = afterSeq
    events.push({ at, seq, type: 'batch-flush', payload: { producerId: producer.id, topic: topic.name, partition } })
  }

  const records = existing ? [...existing.records, record] : [record]
  nextRuntime = { ...nextRuntime, batches: { ...nextRuntime.batches, [pKey]: { records, bytes: batchBytes, openedAt } } }

  return { state: putRuntime(workingState, producer.id, nextRuntime), newEvents: events }
}

/**
 * `acks=1`/`acks=all` chỉ cần trả lời "satisfied" — không tự sinh event, không
 * tự append. `flushBatch` gọi hàm này cả TRƯỚC khi append (gate ISR không đủ
 * cho `acks=all`, chỉ nhánh `.error` được đọc) lẫn SAU khi append (xác nhận
 * response thật). Ở plan này chưa có replication (Task 3's design: mỗi
 * `appendRecord` coi như đã tới toàn bộ ISR ngay lập tức), nên nhánh
 * HW-vs-offset sau khi append luôn `true` — plan sau thay `appendRecord` bằng
 * follower fetch thật, lúc đó nhánh này mới có thể `false` một cách hợp lệ, và
 * chữ ký hàm không cần đổi.
 */
export function resolveAcks(
  state: KafkaState,
  args: ResolveAcksArgs,
): { satisfied: boolean; error?: 'NOT_ENOUGH_REPLICAS' } {
  if (args.acks !== 'all') {
    // acks=0 không chờ ai gọi hàm này thay mặt nó; acks=1 chỉ cần leader đã
    // append — không đợi follower, nên luôn thoả ngay khi hàm được gọi.
    return { satisfied: true }
  }
  const partition = getPartitionState(state, partitionKey(args.topic.name, args.partition))
  const minInsyncReplicas = args.topic.config?.minInsyncReplicas ?? 1
  if (partition.isr.length < minInsyncReplicas) {
    return { satisfied: false, error: 'NOT_ENOUGH_REPLICAS' }
  }
  return { satisfied: partition.highWatermark > args.offset }
}

/**
 * Flush toàn bộ batch đang gom cho một `(producer, topic, partition)`. An toàn
 * khi gọi trên một batch đã rỗng (đã flush trước đó) — no-op, xem
 * `enqueueRecord` vì sao điều đó bắt buộc phải đúng.
 */
export function flushBatch(
  state: KafkaState,
  args: FlushBatchArgs,
): { state: KafkaState; newEvents: SimEvent<KafkaEventType>[] } {
  const { producer, topic, partition, at } = args
  const runtime = getProducerRuntime(state, producer.id)
  const pKey = partitionKey(topic.name, partition)
  const batch = runtime.batches[pKey]

  if (!batch || batch.records.length === 0) {
    return { state, newEvents: [] }
  }

  const partitionState = getPartitionState(state, pKey)
  const acks = producer.acks ?? 'all'
  const leaderOffline = state.brokersOnline[partitionState.leader] === false

  const clearBatch = (s: KafkaState): KafkaState => {
    const r = getProducerRuntime(s, producer.id)
    return putRuntime(s, producer.id, { ...r, batches: withoutBatch(r.batches, pKey) })
  }

  if (leaderOffline) {
    const cleared = clearBatch(state)
    // acks=0 không chờ phản hồi và không biết leader đang chết — producer coi
    // như đã gửi xong dù record chưa từng chạm log. Đây chính là mất dữ liệu im
    // lặng mà bài 06 dạy: không lỗi, không retry, chỉ mất.
    if (acks === 0) return { state: cleared, newEvents: [] }
    const [seq, afterSeq] = nextSeq(cleared)
    return {
      state: afterSeq,
      newEvents: [responseEvent(seq, at + PRODUCE_RESPONSE_TRAVEL_MS, producer.id, topic.name, partition, { error: 'LEADER_NOT_AVAILABLE' })],
    }
  }

  if (acks === 'all') {
    const gate = resolveAcks(state, { acks: 'all', topic, partition, offset: partitionState.leo })
    if (gate.error === 'NOT_ENOUGH_REPLICAS') {
      const cleared = clearBatch(state)
      const [seq, afterSeq] = nextSeq(cleared)
      return {
        state: afterSeq,
        newEvents: [responseEvent(seq, at + PRODUCE_RESPONSE_TRAVEL_MS, producer.id, topic.name, partition, { error: gate.error })],
      }
    }
  }

  // ISR đủ (hoặc acks không cần ISR): append toàn bộ record trong batch, theo
  // đúng thứ tự đã enqueue — offset cấp tăng dần, không xáo trộn trong một batch.
  let workingPartition = partitionState
  let lastOffset = partitionState.leo - 1
  let bytesWritten = 0
  for (const record of batch.records) {
    const appended = appendRecord(workingPartition, {
      key: record.key,
      value: record.value,
      timestamp: record.timestamp,
      bytes: record.bytes,
      headers: record.headers,
    })
    workingPartition = appended.partition
    lastOffset = appended.offset
    bytesWritten += record.bytes
  }
  workingPartition = recomputeHighWatermark(workingPartition)

  let next: KafkaState = {
    ...state,
    partitions: { ...state.partitions, [pKey]: workingPartition },
    metrics: {
      ...state.metrics,
      recordsProduced: state.metrics.recordsProduced + batch.records.length,
      bytesProduced: state.metrics.bytesProduced + bytesWritten,
    },
  }
  next = pushJournal(next, { at, type: 'produce', text: `${pKey}: +${batch.records.length} record`, nodeId: producer.id })
  next = clearBatch(next)

  if (acks === 0) {
    // Ghi journal, cộng metrics — nhưng không sinh `produce-response`: acks=0
    // không có khái niệm chờ phản hồi.
    return { state: next, newEvents: [] }
  }

  const resolved = resolveAcks(next, { acks, topic, partition, offset: lastOffset })
  const [seq, afterSeq] = nextSeq(next)
  const extra = resolved.error ? { error: resolved.error } : { offset: lastOffset }
  return {
    state: afterSeq,
    newEvents: [responseEvent(seq, at + PRODUCE_RESPONSE_TRAVEL_MS, producer.id, topic.name, partition, extra)],
  }
}
