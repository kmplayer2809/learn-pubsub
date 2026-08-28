import { appendRecord, estimateBytes, recomputeHighWatermark } from './log'
import { pickPartition } from './partitioner'
import { partitionKey } from './types'
import type { KafkaEventType, KafkaProducerSpec, KafkaState, KafkaTopicSpec, NodeId, PartitionState, ProducerRuntime } from './types'
import type { JournalEntry, SimEvent } from '../../../shell/kernel/types'

// ---------------------------------------------------------------------------
// Producer path — batching (`enqueueRecord`), flush (`flushBatch`), retry và
// idempotence (`assignProducerId`, `checkSequence`, Task 11), và cách `acks`
// quyết định khi nào một produce coi là xong (`checkIsrSufficient`,
// `isAckSatisfied`). Reducer thật (`engine/index.ts`) gọi các hàm này từ bảng
// dispatch theo `KafkaEventType`. File này chỉ đảm bảo state/event sinh ra đúng.
// ---------------------------------------------------------------------------

// Kafka thật mặc định 16 KiB — một batch nhỏ hơn ngưỡng này không bao giờ flush
// vì đầy, chỉ flush khi hết `linger.ms`.
const DEFAULT_BATCH_SIZE_BYTES = 16_384

// `max.in.flight.requests.per.connection` mặc định của Kafka thật.
const DEFAULT_MAX_IN_FLIGHT = 5

/**
 * Backoff cố định cho `produce-retry` — Kafka thật dùng `retry.backoff.ms` (mặc
 * định 100ms) cộng jitter; bài học ở đây không cần độ trung thực đó, chỉ cần một
 * độ trễ đủ để tách rõ "lần gửi lại" khỏi "lần gửi đầu" trên trục thời gian ảo.
 */
export const PRODUCE_RETRY_BACKOFF_MS = 200

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
  /** Lần thử thứ mấy — `0` (mặc định) là lần gửi đầu tiên. So với `producer.retries`
   *  để quyết định retry tiếp hay trả lỗi hẳn (`retries = 0` ⇒ không bao giờ retry). */
  attempt?: number
  /**
   * Chỉ có khi đây là một lần retry của một batch đã bị dọn khỏi accumulator
   * (nhánh `maxInFlight > 1` trong `flushBatch`) — nội dung cần gửi lại nằm ở đây,
   * KHÔNG đọc từ `runtime.batches[pKey]`: chỗ đó rất có thể đang gom một batch MỚI,
   * không liên quan, cho lần gửi tiếp theo. Vắng mặt (`undefined`) nghĩa là đọc từ
   * accumulator như một flush bình thường.
   */
  retryRecords?: ProducerRuntime['batches'][string]['records']
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
 * Cấp `producerId` (PID) số, tăng dần, cho một producer idempotent — mô phỏng
 * InitProducerId thật của Kafka (broker cấp PID trước khi producer gửi record đầu
 * tiên). Lười và idempotent-với-chính-nó: gọi lại trên một producer đã có PID chỉ
 * trả nguyên giá trị cũ, không cấp thêm. Đếm trong `KafkaState.nextProducerId`,
 * KHÔNG dùng RNG — PID không cần ngẫu nhiên, chỉ cần duy nhất và xác định.
 * `epoch` luôn `0` ở plan này: transaction/epoch-bump là một plan sau (§B5.5).
 */
export function assignProducerId(
  state: KafkaState,
  producerId: NodeId,
): { state: KafkaState; producerId: number; epoch: number } {
  const runtime = getProducerRuntime(state, producerId)
  if (runtime.producerId !== undefined) {
    return { state, producerId: runtime.producerId, epoch: runtime.epoch ?? 0 }
  }
  const assigned = state.nextProducerId
  const nextState = putRuntime(
    { ...state, nextProducerId: assigned + 1 },
    producerId,
    { ...runtime, producerId: assigned, epoch: 0 },
  )
  return { state: nextState, producerId: assigned, epoch: 0 }
}

export type SequenceCheckResult = 'ok' | 'duplicate' | 'out-of-order'

/**
 * So khớp sequence của một record với sequence cuối broker đã CHẤP NHẬN cho đúng
 * `producerId` này trên partition này (`PartitionState.producerState`) — đúng cách
 * Kafka thật chặn duplicate và ép thứ tự cho idempotent producer:
 *   - `sequence === lastSequence + 1` ⇒ `'ok'`: đúng cái tiếp theo được mong đợi.
 *   - `sequence <= lastSequence` ⇒ `'duplicate'`: broker đã thấy record này rồi
 *     (hoặc cũ hơn) — một retry lặp lại vô hại, không ghi lần hai.
 *   - `sequence > lastSequence + 1` ⇒ `'out-of-order'`: nhảy cóc — một record ĐỨNG
 *     TRƯỚC nó (theo sequence) chưa từng tới broker. Từ chối thẳng, không bao giờ
 *     âm thầm ghi rồi để lỗ hổng lại phía sau.
 * Producer chưa từng gửi gì cho `producerId` này trên partition này thì coi
 * `lastSequence` là `-1` — sequence `0` (số đầu tiên `assignProducerId`/
 * `enqueueRecord` từng gán) khớp đúng `-1 + 1`.
 */
export function checkSequence(
  partition: PartitionState,
  record: { producerId: number; sequence: number },
): SequenceCheckResult {
  const lastSequence = partition.producerState[record.producerId]?.lastSequence ?? -1
  if (record.sequence === lastSequence + 1) return 'ok'
  if (record.sequence <= lastSequence) return 'duplicate'
  return 'out-of-order'
}

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

  // Producer idempotent cần một PID trước khi có thể gán sequence — gán MỘT LẦN,
  // lười, đúng lúc `.send()` được gọi (không phải lúc flush): hai batch cùng
  // partition hoàn toàn có thể race nhau lúc flush (retry, `maxInFlight > 1` —
  // xem `flushBatch`), nhưng thứ tự app gọi `.send()` thì không bao giờ mơ hồ. Đó
  // là nơi DUY NHẤT sequence có thể gán một cách xác định.
  const idAssignment = producer.idempotent ? assignProducerId(state, producer.id) : undefined
  const baseState = idAssignment?.state ?? state
  const assignedProducerId = idAssignment?.producerId

  const runtime = getProducerRuntime(baseState, producer.id)

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

  // Sequence tăng dần mỗi record được app gọi enqueue cho producer idempotent —
  // không phải mỗi record broker chấp nhận. Gán TRƯỚC khi biết batch này rồi sẽ
  // thành công, thất bại, hay phải retry: đúng cách client Kafka thật giữ số thứ
  // tự ổn định qua mọi lần gửi lại, và là lý do `checkSequence` (`flushBatch`) có
  // thể phát hiện một batch khác đã "chen ngang" trước nó (nhánh `out-of-order`).
  let sequence: number | undefined
  if (assignedProducerId !== undefined) {
    sequence = nextRuntime.nextSequence[pKey] ?? 0
    nextRuntime = { ...nextRuntime, nextSequence: { ...nextRuntime.nextSequence, [pKey]: sequence + 1 } }
  }
  const record = {
    key,
    value,
    headers,
    timestamp: at,
    bytes,
    ...(assignedProducerId !== undefined ? { producerId: assignedProducerId, sequence } : {}),
  }

  const existing = nextRuntime.batches[pKey]
  const events: SimEvent<KafkaEventType>[] = []
  let workingState = baseState
  let batchBytes: number
  let openedAt: number

  if (!existing) {
    batchBytes = bytes
    openedAt = at
    const lingerMs = producer.lingerMs ?? 0
    const [seq, afterSeq] = nextSeq(baseState)
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
  const attempt = args.attempt ?? 0
  const runtime = getProducerRuntime(state, producer.id)
  const pKey = partitionKey(topic.name, partition)

  // Nguồn record cho lần gửi này: một retry đã bị dọn khỏi accumulator
  // (`maxInFlight > 1`, xem `retryOrTerminal` bên dưới) đọc từ `args.retryRecords`
  // — `fromAccumulator = false` từ đây trở xuống nghĩa là hàm này KHÔNG được đụng
  // `runtime.batches[pKey]` ở bất kỳ đâu, vì chỗ đó có thể đang gom một batch MỚI,
  // không liên quan tới lần retry này. Mọi lần gọi khác đọc accumulator như cũ.
  const fromAccumulator = args.retryRecords === undefined
  const batch = args.retryRecords !== undefined ? { records: args.retryRecords, bytes: 0, openedAt: at } : runtime.batches[pKey]

  if (!batch || batch.records.length === 0) {
    return { state, newEvents: [] }
  }

  const partitionState = getPartitionState(state, pKey)
  const acks = producer.acks ?? 'all'
  const leaderOffline = state.brokersOnline[partitionState.leader] === false
  const retries = producer.retries ?? Number.POSITIVE_INFINITY
  const maxInFlight = producer.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT

  const clearBatch = (s: KafkaState): KafkaState => {
    if (!fromAccumulator) return s // batch này không sống trong accumulator — không có gì để dọn
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

  // Dùng chung cho fault produce-error VÀ cho `checkSequence` trả `out-of-order`
  // (bên dưới) — cả hai đều là "lần gửi này thất bại, có nên thử lại không". Nếu
  // còn ngân sách `retries`: hẹn `produce-retry`, và với `maxInFlight > 1` dọn
  // batch khỏi accumulator để record enqueue TIẾP THEO mở một batch MỚI thay vì
  // nối đuôi (chính là chỗ hai batch có thể hoàn tất KHÔNG theo thứ tự — cố ý, đó
  // là điều bài 10 dạy). Với `maxInFlight <= 1`, KHÔNG dọn batch: record enqueue
  // tiếp theo nối vào batch đang chờ retry, nên khi retry cuối cùng thành công,
  // mọi record đi ra theo ĐÚNG thứ tự đã enqueue. Hết ngân sách retry (kể cả
  // `retries = 0` ngay từ lần thử đầu) thì lỗi thật, không thử lại nữa.
  const retryOrTerminal = (
    s: KafkaState,
    remaining: ProducerRuntime['batches'][string]['records'],
    errorCode: string,
  ): { state: KafkaState; newEvents: SimEvent<KafkaEventType>[] } => {
    if (attempt < retries) {
      const [seq, afterSeq] = nextSeq(s)
      let nextState = afterSeq
      let payloadRecords: ProducerRuntime['batches'][string]['records'] | undefined
      if (maxInFlight <= 1) {
        payloadRecords = undefined
      } else {
        nextState = clearBatch(nextState)
        payloadRecords = remaining
      }
      nextState = { ...nextState, metrics: { ...nextState.metrics, retries: nextState.metrics.retries + 1 } }
      const retryEvent: SimEvent<KafkaEventType> = {
        at: at + PRODUCE_RETRY_BACKOFF_MS,
        seq,
        type: 'produce-retry',
        payload: {
          producerId: producer.id,
          topic: topic.name,
          partition,
          attempt: attempt + 1,
          ...(payloadRecords !== undefined ? { records: payloadRecords } : {}),
        },
      }
      return { state: nextState, newEvents: [retryEvent] }
    }
    const cleared = clearBatch(s)
    const [seq, afterSeq] = nextSeq(cleared)
    return {
      state: afterSeq,
      newEvents: [responseEvent(seq, at + PRODUCE_RESPONSE_TRAVEL_MS, producer.id, topic.name, partition, { error: errorCode })],
    }
  }

  // Fault produce-error (Task 11, kích hoạt bởi `applyProduceErrorArm` ở
  // `engine/index.ts`) — buộc lần gửi NÀY thất bại, tiêu một đơn vị ngân sách
  // `pendingErrors` bất kể sau đó retry hay trả lỗi hẳn. Kiểm tra TRƯỚC mọi gate
  // khác (leader offline, ISR): đây là fault được script cố ý gọi ra, không phải
  // hệ quả của trạng thái cluster.
  const pendingErrors = runtime.pendingErrors ?? 0
  if (pendingErrors > 0) {
    const faulted = putRuntime(state, producer.id, { ...runtime, pendingErrors: pendingErrors - 1 })
    return retryOrTerminal(faulted, batch.records, 'PRODUCE_ERROR')
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

  // ISR đủ (hoặc acks không cần ISR): append record trong batch, theo đúng thứ tự
  // đã enqueue — offset cấp tăng dần, không xáo trộn trong một batch. Record có
  // `producerId`/`sequence` (producer idempotent) phải qua `checkSequence` trước:
  // `'duplicate'` thì bỏ qua (không ghi lần hai, không tiêu offset); `'out-of-order'`
  // thì DỪNG NGAY — record này (và mọi record sau nó trong batch, luôn liền
  // sequence) chưa thể vào log, phải retry (xem `retryOrTerminal`). Vì sequence
  // trong một batch liền nhau (`enqueueRecord`), chỉ record ĐẦU TIÊN chưa xử lý có
  // thể là `'out-of-order'` — một khi nó qua được, mọi record sau tự động `'ok'`.
  let workingPartition = partitionState
  let lastOffset = partitionState.leo - 1
  let bytesWritten = 0
  let appendedCount = 0
  let duplicatesSkipped = 0
  let outOfOrderAt = -1
  let idx = 0
  for (const record of batch.records) {
    if (record.producerId !== undefined && record.sequence !== undefined) {
      const check = checkSequence(workingPartition, { producerId: record.producerId, sequence: record.sequence })
      if (check === 'out-of-order') {
        outOfOrderAt = idx
        break
      }
      if (check === 'duplicate') {
        duplicatesSkipped++
        idx++
        continue
      }
    }
    const appended = appendRecord(workingPartition, {
      key: record.key,
      value: record.value,
      timestamp: record.timestamp,
      bytes: record.bytes,
      headers: record.headers,
      producerId: record.producerId,
      // `runtime` ở đây CỐ Ý là snapshot chụp ở đầu hàm, không phải trạng thái
      // hiện tại — vô hại hôm nay vì epoch luôn `0` suốt đời chạy (chưa có
      // transaction/epoch-bump ở plan này), nhưng một khi plan sau thêm khả năng
      // epoch đổi GIỮA một lần gọi `flushBatch` (ví dụ fencing một producer zombie
      // giữa lúc nó đang gửi), đọc `runtime.epoch` ở đây sẽ stamp epoch CŨ lên một
      // record — phải đọc lại `getProducerRuntime(state, producer.id).epoch` tại
      // đúng thời điểm append, không phải biến `runtime` đóng gói từ đầu hàm.
      producerEpoch: record.producerId !== undefined ? (runtime.epoch ?? 0) : undefined,
      sequence: record.sequence,
    })
    workingPartition = appended.partition
    lastOffset = appended.offset
    bytesWritten += record.bytes
    appendedCount++
    if (record.producerId !== undefined && record.sequence !== undefined) {
      // Cùng snapshot `runtime` (đầu hàm), cùng cái bẫy đã ghi ở `producerEpoch`
      // phía trên.
      workingPartition = {
        ...workingPartition,
        producerState: { ...workingPartition.producerState, [record.producerId]: { epoch: runtime.epoch ?? 0, lastSequence: record.sequence } },
      }
    }
    idx++
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
      recordsProduced: state.metrics.recordsProduced + appendedCount,
      bytesProduced: state.metrics.bytesProduced + bytesWritten,
      duplicatesPrevented: state.metrics.duplicatesPrevented + duplicatesSkipped,
    },
  }
  if (appendedCount > 0) {
    next = pushJournal(next, { at, type: 'produce', text: `${pKey}: +${appendedCount} record`, nodeId: producer.id })
  }

  if (outOfOrderAt !== -1) {
    // Phần đuôi từ `outOfOrderAt` trở đi bị broker từ chối (sequence nhảy cóc) —
    // coi như một lần gửi thất bại cần retry/lỗi hẳn, KHÔNG đi qua đường thành
    // công bên dưới (không dọn batch qua `clearBatch` ở đây — `retryOrTerminal` tự
    // quyết định điều đó tuỳ `maxInFlight`).
    return retryOrTerminal(next, batch.records.slice(outOfOrderAt), 'OUT_OF_ORDER_SEQUENCE')
  }

  next = clearBatch(next)

  if (acks === 0) {
    // Ghi journal, cộng metrics — nhưng không sinh `produce-response`: acks=0
    // không có khái niệm chờ phản hồi. Cũng là lý do fault `ack-lost` không thể
    // áp dụng ở đây — không có response nào để "mất" khi vốn dĩ chẳng có response.
    return { state: next, newEvents: [] }
  }

  // Fault `ack-lost` (Task 11 fix round) — append ĐÃ thành công (record đã nằm
  // trong log, `next` phản ánh đúng điều đó), nhưng response quay về producer bị
  // buộc "mất". Producer coi như timeout, resend CHÍNH batch vừa gửi — dùng lại
  // `batch.records` đã có sẵn (producerId/sequence gốc của nó, nếu có) thay vì
  // dựng lại. Khi retry đó tới `flushBatch` lần nữa, `checkSequence` sẽ thấy đúng
  // sequence đã được CHẤP NHẬN rồi ⇒ `'duplicate'`, không ghi lần hai — đây là
  // đường DUY NHẤT `duplicatesPrevented` có thể tăng qua một lượt chạy kernel đầy
  // đủ, không cần test tự tiêm state. Producer KHÔNG idempotent thì record trong
  // `batch.records` không có `producerId`/`sequence`, nên lần retry này append lại
  // vô điều kiện — một duplicate THẬT, đúng cặp đối chứng bài 09 cần.
  const pendingAckLosses = runtime.pendingAckLosses ?? 0
  if (pendingAckLosses > 0) {
    const freshRuntime = getProducerRuntime(next, producer.id) // KHÔNG spread `runtime` gốc — nó còn giữ batch CHƯA bị `clearBatch` dọn
    const lost = putRuntime(next, producer.id, { ...freshRuntime, pendingAckLosses: pendingAckLosses - 1 })
    const [seq, afterSeq] = nextSeq(lost)
    const retryEvent: SimEvent<KafkaEventType> = {
      at: at + PRODUCE_RETRY_BACKOFF_MS,
      seq,
      type: 'produce-retry',
      payload: { producerId: producer.id, topic: topic.name, partition, attempt: attempt + 1, records: batch.records },
    }
    return {
      state: { ...afterSeq, metrics: { ...afterSeq.metrics, retries: afterSeq.metrics.retries + 1 } },
      newEvents: [retryEvent],
    }
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
