import { appendRecord, estimateBytes, recomputeHighWatermark } from './log'
import { pickPartition } from './partitioner'
import { partitionKey } from './types'
import type { KafkaEventType, KafkaProducerSpec, KafkaState, KafkaTopicSpec, NodeId, PartitionState, ProducerRuntime } from './types'
import type { JournalEntry, SimEvent } from '../../../shell/kernel/types'

// ---------------------------------------------------------------------------
// Producer path — batching (`enqueueRecord`), flush (`flushBatch`), và cách
// `acks` quyết định khi nào một produce coi là xong (`checkIsrSufficient`,
// `isAckSatisfied`). Reducer thật gọi các hàm này từ bảng dispatch theo
// `KafkaEventType` — đó là Task 6, chưa nối ở đây. File này chỉ đảm bảo
// state/event sinh ra đúng.
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

// Tách làm hai thay vì một `resolveAcks` gộp chung (bản trước của file này):
// ISR có đủ hay không không cần offset — nó đúng/sai TRƯỚC khi append, dùng
// làm gate cho `acks=all`. HW đã vượt offset hay chưa chỉ có ý nghĩa SAU khi
// append. Gộp hai câu hỏi vào một hàm buộc gate tiền-append phải bịa ra một
// `offset` không tồn tại — vô hại hôm nay vì nhánh ISR luôn short-circuit
// trước, nhưng là một bẫy nằm chờ: một lần sửa sau (rất có thể Task 11, retry)
// tin vào `.satisfied` từ lệnh gọi tiền-append sẽ nhận một `false` sai mà
// không có lỗi kiểu nào báo trước.
export interface CheckIsrSufficientArgs {
  topic: KafkaTopicSpec
  partition: number
}

export interface IsAckSatisfiedArgs {
  acks: 0 | 1 | 'all'
  topic: KafkaTopicSpec
  partition: number
  /** Offset của record mới nhất vừa append — hàm này chỉ có ý nghĩa GỌI SAU
   *  khi append đã xảy ra. */
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
 * Gate dùng TRƯỚC khi append cho `acks=all`: ISR có đủ `minInsyncReplicas`
 * không, không liên quan gì tới offset — real Kafka's `Partition.
 * appendRecordsToLeader` cũng từ chối ở đúng bước này, trước khi chạm log của
 * leader, nên không có ghi một phần nào xảy ra trên nhánh này.
 */
export function checkIsrSufficient(
  state: KafkaState,
  args: CheckIsrSufficientArgs,
): { ok: boolean; error?: 'NOT_ENOUGH_REPLICAS' } {
  const partition = getPartitionState(state, partitionKey(args.topic.name, args.partition))
  const minInsyncReplicas = args.topic.config?.minInsyncReplicas ?? 1
  if (partition.isr.length < minInsyncReplicas) {
    return { ok: false, error: 'NOT_ENOUGH_REPLICAS' }
  }
  return { ok: true }
}

/**
 * Gọi SAU khi append đã xảy ra, để xác nhận response thật. `acks=1` chỉ cần
 * leader đã append — không đợi follower, nên luôn `true` ngay khi hàm được
 * gọi. `acks=all` cần HW đã vượt qua offset vừa ghi; ở plan này chưa có
 * replication (Task 3's design: mỗi `appendRecord` coi như đã tới toàn bộ ISR
 * ngay lập tức), nên nhánh đó luôn `true` — plan sau thay `appendRecord` bằng
 * follower fetch thật, lúc đó hàm này mới có thể trả `false` một cách hợp lệ,
 * và chữ ký không cần đổi.
 */
export function isAckSatisfied(state: KafkaState, args: IsAckSatisfiedArgs): boolean {
  if (args.acks !== 'all') return true
  const partition = getPartitionState(state, partitionKey(args.topic.name, args.partition))
  return partition.highWatermark > args.offset
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
    const batches = withoutBatch(r.batches, pKey)
    // KIP-480: sticky partitioner đổi partition khi batch ĐÓNG (đầy hoặc hết
    // linger), không phải khi request thành công — spec §B5.1 dòng 437: "gắn
    // với một partition tới khi batch đầy hoặc linger.ms hết, rồi mới đổi".
    // `flushBatch` là nơi duy nhất biết một batch vừa đóng, nên reset thuộc về
    // đây, cho MỌI nhánh gọi `clearBatch` (leader offline, NOT_ENOUGH_REPLICAS,
    // hay append thành công) — batch đã đóng dù request sau đó có lỗi hay
    // không. So khớp đúng partition trước khi xoá: một record có key (không hề
    // đụng stickyPartition) flush ở partition khác không được phép xoá sticky
    // đang dính ở một partition khác.
    const clearedRuntime: ProducerRuntime = { ...r, batches }
    // Xoá hẳn property thay vì gán `undefined` tường minh — "chưa từng chọn"
    // là trạng thái vắng mặt, không phải một giá trị (xem ProducerRuntime ở
    // types.ts và testState.ts).
    if (r.stickyPartition === partition) delete clearedRuntime.stickyPartition
    return putRuntime(s, producer.id, clearedRuntime)
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
    const gate = checkIsrSufficient(state, { topic, partition })
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
  // `appendRecord` (log.ts) chỉ cập nhật `replicaState` của LEADER, và tự đặt
  // `highWatermark = leo` trực tiếp — đúng cho trường hợp một replica, nhưng
  // với nhiều replica thì `recomputeHighWatermark` (min LEO trên ISR) sẽ đọc
  // lại `replicaState` của follower vẫn còn kẹt ở giá trị khởi tạo (`leo: 0`)
  // vì plan này chưa có reducer follower-fetch nào từng đụng tới nó — kéo HW
  // tụt về 0 dù `appendRecord` vừa đặt đúng. Rule 6 của brief nói thẳng: "ở
  // plan này chưa có replication nên replicaState của MỌI replica được coi là
  // bắt kịp ngay" — tức phần việc "coi như bắt kịp" đó thuộc về `produce.ts`
  // (nơi duy nhất gọi `recomputeHighWatermark` ở plan này), không phải một
  // hành vi ẩn bên trong `appendRecord`. Plan sau thay đoạn này bằng follower
  // fetch thật cập nhật `replicaState` theo thời gian, và dòng dưới đây biến
  // mất.
  const caughtUpReplicaState = Object.fromEntries(
    workingPartition.replicas.map((replicaId) => [replicaId, { leo: workingPartition.leo, lastFetchAt: at }]),
  )
  workingPartition = { ...workingPartition, replicaState: { ...workingPartition.replicaState, ...caughtUpReplicaState } }
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

  // ISR đã được gate ở trên cho `acks=all`, và `acks=1` không cần ISR — tới
  // đây không còn đường nào tạo lỗi nữa trong plan này, nên response luôn
  // thành công. `isAckSatisfied` vẫn được gọi (thay vì bỏ qua) để giữ đúng chỗ
  // móc vào cho plan sau, khi nó có thể thật sự trả `false`.
  const satisfied = isAckSatisfied(next, { acks, topic, partition, offset: lastOffset })
  const [seq, afterSeq] = nextSeq(next)
  const extra = satisfied ? { offset: lastOffset } : {}
  return {
    state: afterSeq,
    newEvents: [responseEvent(seq, at + PRODUCE_RESPONSE_TRAVEL_MS, producer.id, topic.name, partition, extra)],
  }
}
