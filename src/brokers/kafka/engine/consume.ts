import { readFrom } from './log'
import { partitionKey, sortedPartitionKeys } from './types'
import type { ConsumerRuntime, KafkaConsumerSpec, KafkaEventType, KafkaState, LogEntry, NodeId, PartitionState } from './types'
import type { SimEvent } from '../../../shell/kernel/types'

// ---------------------------------------------------------------------------
// Consumer path — fetch (`fetchRecords`), vị trí đọc (`resolvePosition`), và
// ba thao tác điều khiển đến từ script (`applyPause`/`applyResume`/`applySeek`).
// Reducer thật (Task 6) gọi các hàm này từ bảng dispatch theo `KafkaEventType`,
// chưa nối ở đây. Group coordinator, rebalance, commit thật (`__consumer_offsets`)
// là `group/` — một plan sau (P4), không phải file này.
// ---------------------------------------------------------------------------

/** `max.poll.records` mặc định của consumer Kafka thật. */
const DEFAULT_MAX_POLL_RECORDS = 500

/** `auto.offset.reset` mặc định của consumer Kafka thật là `'latest'`, không phải `'earliest'`. */
const DEFAULT_AUTO_OFFSET_RESET: 'earliest' | 'latest' = 'latest'

/**
 * `auto.offset.reset` chỉ có tác dụng khi consumer **không có** position hợp lệ:
 * lần đầu vào group, hoặc position đã rơi dưới `logStartOffset` vì retention xoá
 * mất đoạn đó. Nó không phải "đọc từ đâu mỗi lần poll" — hiểu nhầm đó là lý do
 * lesson 05 tồn tại.
 */
export function resolvePosition(args: {
  position?: number
  logStartOffset: number
  highWatermark: number
  autoOffsetReset: 'earliest' | 'latest'
}): number {
  const { position, logStartOffset, highWatermark, autoOffsetReset } = args
  if (position !== undefined && position >= logStartOffset) return position
  return autoOffsetReset === 'earliest' ? logStartOffset : highWatermark
}

export interface FetchRecordsArgs {
  consumer: KafkaConsumerSpec
  at: number
}

export interface PauseResumeArgs {
  consumerId: NodeId
  topic: string
  partition: number
}

export interface SeekArgs {
  consumerId: NodeId
  topic: string
  partition: number
  offset: number | 'earliest' | 'latest'
}

// --- Tiện ích thuần nội bộ --------------------------------------------------

function nextSeq(state: KafkaState): [number, KafkaState] {
  return [state.seq + 1, { ...state, seq: state.seq + 1 }]
}

function getConsumerRuntime(state: KafkaState, id: NodeId): ConsumerRuntime {
  const runtime = state.consumers[id]
  if (!runtime) throw new Error(`kafka engine: unknown consumer ${id}`)
  return runtime
}

function getPartitionState(state: KafkaState, key: string): PartitionState {
  const partition = state.partitions[key]
  if (!partition) throw new Error(`kafka engine: unknown partition ${key}`)
  return partition
}

function putRuntime(state: KafkaState, id: NodeId, runtime: ConsumerRuntime): KafkaState {
  return { ...state, consumers: { ...state.consumers, [id]: runtime } }
}

// --- API ---------------------------------------------------------------

/**
 * Một lần poll của consumer. Đi qua mọi partition đã subscribe theo đúng thứ tự
 * `sortedPartitionKeys` (không lặp thẳng `state.partitions` — đây là chỗ dễ vỡ
 * determinism nhất của file này với consumer subscribe nhiều partition), bỏ qua
 * partition đang `paused`, đọc tối đa `maxPollRecords` record TỔNG CỘNG cho cả
 * lần gọi — đúng ngữ nghĩa `max.poll.records` của Kafka thật: giới hạn số record
 * một `poll()` trả về, không phải số record mỗi partition.
 *
 * `readFrom` (Task 3, `log.ts`) đã tự chặn ở `highWatermark`; hàm này không lặp
 * lại việc đó, chỉ truyền đúng vị trí đọc xuống.
 */
export function fetchRecords(
  state: KafkaState,
  args: FetchRecordsArgs,
): { state: KafkaState; records: LogEntry[]; newEvents: SimEvent<KafkaEventType>[] } {
  const { consumer, at } = args
  const runtime = getConsumerRuntime(state, consumer.id)
  const maxPollRecords = consumer.maxPollRecords ?? DEFAULT_MAX_POLL_RECORDS
  const autoOffsetReset = consumer.autoOffsetReset ?? DEFAULT_AUTO_OFFSET_RESET
  const subscribed = new Set(consumer.subscriptions)

  const records: LogEntry[] = []
  let workingRuntime = runtime
  let remaining = maxPollRecords

  for (const key of sortedPartitionKeys(state)) {
    if (remaining <= 0) break
    const partition = state.partitions[key]
    if (!partition || !subscribed.has(partition.topic)) continue
    // Partition đang pause: không đụng gì tới `position` của nó — pause không
    // phải seek, xem `applyPause`.
    if (workingRuntime.paused.includes(key)) continue

    const resolved = resolvePosition({
      position: workingRuntime.position[key],
      logStartOffset: partition.logStartOffset,
      highWatermark: partition.highWatermark,
      autoOffsetReset,
    })

    const fetched = readFrom(partition, resolved, remaining)
    // Luôn ghi lại vị trí mới dù `fetched` rỗng: đây chính là chỗ
    // `auto.offset.reset` "chốt" một lần. Lần poll sau, position đã hợp lệ
    // (>= logStartOffset) nên `resolvePosition` không áp lại earliest/latest
    // nữa — kể cả khi lần này chưa đọc được record nào (ví dụ `latest` mà
    // chưa có record mới, hoặc partition vừa hết record khả dụng dưới HW).
    workingRuntime = { ...workingRuntime, position: { ...workingRuntime.position, [key]: resolved + fetched.length } }

    if (fetched.length === 0) continue
    records.push(...fetched)
    remaining -= fetched.length
  }

  workingRuntime = { ...workingRuntime, lastPollAt: at }
  let nextState = putRuntime(state, consumer.id, workingRuntime)
  nextState = {
    ...nextState,
    metrics: { ...nextState.metrics, recordsConsumed: nextState.metrics.recordsConsumed + records.length },
  }

  const newEvents: SimEvent<KafkaEventType>[] = []
  if (records.length > 0) {
    // Poll rỗng không sinh `process-done`: không có record nào được giao thì
    // không có gì để "xử lý" trong `processingMs` — sinh event cho một lô rỗng
    // sẽ báo hiệu công việc xảy ra ở nơi không hề có record nào cả.
    const processingMs = consumer.processingMs ?? 0
    const [seq, afterSeq] = nextSeq(nextState)
    nextState = afterSeq
    newEvents.push({
      at: at + processingMs,
      seq,
      type: 'process-done',
      payload: { consumerId: consumer.id, count: records.length },
    })
  }

  return { state: nextState, records, newEvents }
}

/**
 * Partition trong `runtime.paused` bị `fetchRecords` bỏ qua hoàn toàn: `position`
 * giữ nguyên, không đọc, không cập nhật. Pause không phải seek — đó là lý do
 * `applyPause` không đụng tới `position`, chỉ thêm khoá vào danh sách tạm dừng.
 */
export function applyPause(state: KafkaState, args: PauseResumeArgs): KafkaState {
  const runtime = getConsumerRuntime(state, args.consumerId)
  const key = partitionKey(args.topic, args.partition)
  if (runtime.paused.includes(key)) return state // pause một partition đã pause là no-op
  return putRuntime(state, args.consumerId, { ...runtime, paused: [...runtime.paused, key] })
}

export function applyResume(state: KafkaState, args: PauseResumeArgs): KafkaState {
  const runtime = getConsumerRuntime(state, args.consumerId)
  const key = partitionKey(args.topic, args.partition)
  return putRuntime(state, args.consumerId, { ...runtime, paused: runtime.paused.filter((k) => k !== key) })
}

/**
 * Seek chỉ đặt lại `position`, không đọc, không sinh event — khác hẳn
 * `fetchRecords`. `'earliest'`/`'latest'` phân giải ngay tại thời điểm gọi, qua
 * đúng `logStartOffset`/`highWatermark` hiện tại của partition, không trì hoãn
 * tới lần fetch kế tiếp (lúc đó hai giá trị này có thể đã đổi).
 *
 * Một offset số tường minh được ghi thẳng xuống, kể cả khi nó nằm ngoài
 * `[logStartOffset, highWatermark]` — giống Kafka thật: seek không lỗi ngay lập
 * tức, `readFrom` ở lần fetch kế tiếp mới là chỗ hành vi đó lộ ra (rỗng nếu dưới
 * `logStartOffset`, rỗng vì chưa tới `highWatermark` nếu ở phía trên).
 */
export function applySeek(state: KafkaState, args: SeekArgs): KafkaState {
  const { consumerId, topic, partition, offset } = args
  const key = partitionKey(topic, partition)
  const partitionState = getPartitionState(state, key)
  const runtime = getConsumerRuntime(state, consumerId)

  const resolved =
    offset === 'earliest' ? partitionState.logStartOffset : offset === 'latest' ? partitionState.highWatermark : offset

  return putRuntime(state, consumerId, { ...runtime, position: { ...runtime.position, [key]: resolved } })
}
