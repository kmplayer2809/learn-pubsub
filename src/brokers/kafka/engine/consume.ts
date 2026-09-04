import { readFrom } from './log'
import { filterForIsolation, recomputeLastStableOffset } from './transaction'
import { partitionKey, sortedPartitionKeys } from './types'
import type { ConsumerRuntime, KafkaConsumerSpec, KafkaEventType, KafkaState, LogEntry, NodeId, PartitionState } from './types'
import type { SimEvent } from '../../../shell/kernel/types'

// ---------------------------------------------------------------------------
// Consumer path — fetch (`fetchRecords`), vị trí đọc (`resolvePosition`), và
// ba thao tác điều khiển đến từ script (`applyPause`/`applyResume`/`applySeek`).
// Reducer thật gọi các hàm này từ bảng dispatch theo `KafkaEventType`
// (`engine/index.ts`). `fetchRecords` đọc `GroupMember.assignment` THẬT từ
// `group/coordinator.ts` (Task 4, `assignedPartitionKeys` dưới đây) để biết
// đọc partition nào — commit thật (`__consumer_offsets`) vẫn sống ở `group/`
// (`offsets.ts`), không phải file này.
//
// Task 9 (`transaction.ts`, §B5.5): `fetchRecords` lọc record trả về theo
// `consumer.isolationLevel` — `read_committed` cắt tại `lastStableOffset` và
// giấu record thuộc transaction đã abort, `read_uncommitted` đọc nguyên tới
// `highWatermark` như trước Task 9. Logic lọc thật sự sống ở `transaction.ts`
// (`filterForIsolation`/`recomputeLastStableOffset`) — file này chỉ gọi lại.
// ---------------------------------------------------------------------------

/** `max.poll.records` mặc định của consumer Kafka thật. */
const DEFAULT_MAX_POLL_RECORDS = 500

/** `auto.offset.reset` mặc định của consumer Kafka thật là `'latest'`, không phải `'earliest'`. */
const DEFAULT_AUTO_OFFSET_RESET: 'earliest' | 'latest' = 'latest'

/** `isolation.level` mặc định của consumer Kafka thật là `'read_uncommitted'`. */
const DEFAULT_ISOLATION_LEVEL: 'read_uncommitted' | 'read_committed' = 'read_uncommitted'

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

/**
 * Partition consumer NÀY thật sự được PHÉP đọc lần poll này — Task 4 (Ruling D)
 * đổi hẳn nguồn sự thật từ `consumer.subscriptions` (chỉ ở mức TOPIC, không
 * phân biệt member nào trong group đọc partition nào) sang
 * `GroupMember.assignment` THẬT của group coordinator (`group/coordinator.ts`).
 * Group/member không tồn tại (chưa từng `joinGroup`, hoặc test đơn vị gọi
 * `fetchRecords` trực tiếp mà không dựng group) → coi như CHƯA được assign gì
 * — trả rỗng, không fetch bất kỳ partition nào, đúng thực tế một client chưa
 * là thành viên hợp lệ của group thì không được phép fetch. Assignment rỗng
 * GIỮA một vòng rebalance (eager assignor xoá sạch lúc `PreparingRebalance`)
 * cũng rơi vào đúng nhánh này một cách tự nhiên — "không đọc gì trong lúc
 * rebalance" chính là ngữ nghĩa stop-the-world cần có, không phải một trường
 * hợp đặc biệt phải xử lý riêng.
 *
 * Duyệt qua `sortedPartitionKeys(state)` rồi lọc theo assignment — KHÔNG duyệt
 * thẳng thứ tự của `member.assignment` (nó sort theo `(topic, partition)` ở
 * `assignors.ts`, khác tiêu chí sort chuỗi `sortedPartitionKeys` dùng, xem
 * why-comment ở đó) — để giữ ĐÚNG MỘT thứ tự lặp partition xuyên suốt cả file
 * này (§B6), không lệ thuộc thứ tự assignor trả về.
 */
function assignedPartitionKeys(state: KafkaState, consumer: KafkaConsumerSpec): string[] {
  const group = state.groups[consumer.groupId]
  const member = group?.members.find((m) => m.memberId === consumer.id)
  if (!member) return []
  const assigned = new Set(member.assignment.map((p) => partitionKey(p.topic, p.partition)))
  return sortedPartitionKeys(state).filter((key) => assigned.has(key))
}

// --- API ---------------------------------------------------------------

/**
 * Một lần poll của consumer, hai vòng tách biệt trên cùng một `assignedKeys`
 * (mọi partition đã subscribe, theo đúng thứ tự `sortedPartitionKeys` — không
 * lặp thẳng `state.partitions`, đây là chỗ dễ vỡ determinism nhất của file này
 * với consumer subscribe nhiều partition):
 *
 * 1. Gán `position` cho mọi partition chưa có, không phụ thuộc ngân sách còn
 *    lại — xem why-comment ngay trong thân hàm.
 * 2. Đọc thật, tối đa `maxPollRecords` record TỔNG CỘNG cho cả lần gọi — đúng
 *    ngữ nghĩa `max.poll.records` của Kafka thật: giới hạn số record một
 *    `poll()` trả về, không phải số record mỗi partition.
 *
 * Partition đang `paused` bị cả hai vòng bỏ qua. `readFrom` (Task 3, `log.ts`)
 * đã tự chặn ở `highWatermark`; hàm này không lặp lại việc đó, chỉ truyền đúng
 * vị trí đọc xuống.
 */
export function fetchRecords(
  state: KafkaState,
  args: FetchRecordsArgs,
): { state: KafkaState; records: LogEntry[]; newEvents: SimEvent<KafkaEventType>[] } {
  const { consumer, at } = args
  const runtime = getConsumerRuntime(state, consumer.id)
  const maxPollRecords = consumer.maxPollRecords ?? DEFAULT_MAX_POLL_RECORDS
  const autoOffsetReset = consumer.autoOffsetReset ?? DEFAULT_AUTO_OFFSET_RESET
  const isolationLevel = consumer.isolationLevel ?? DEFAULT_ISOLATION_LEVEL

  // Partition "assigned" cho lần poll này — `GroupMember.assignment` THẬT
  // (Task 4, Ruling D), không còn `consumer.subscriptions` ở mức topic. Dùng
  // chung cho cả hai vòng dưới đây để không tính lại và không lệch thứ tự giữa
  // chúng.
  const assignedKeys = assignedPartitionKeys(state, consumer)

  let workingRuntime = runtime

  // Gán vị trí bắt đầu cho MỌI partition đã assign, không pause, TRƯỚC khi
  // tiêu bất kỳ đơn vị `maxPollRecords` nào — tách hẳn khỏi vòng đọc record ở
  // dưới. Kafka thật gán offset bắt đầu ngay khi partition được assign cho
  // consumer, không trì hoãn tới lúc partition đó "có lượt" trong ngân sách
  // record của một poll. Bản trước của hàm này resolve lồng trong vòng ngân
  // sách rồi `break` sớm khi hết budget — một partition bị partition khác ăn
  // hết budget nhiều poll liên tiếp thì không bao giờ được resolve, và tới
  // khi cuối cùng nó "có lượt", `'latest'` neo vào high watermark tại THỜI
  // ĐIỂM MUỘN đó thay vì thời điểm nó lẽ ra phải được gán — mọi record đã
  // tới trong lúc "đói" bị mất trắng, không phục hồi được (bug thật, xem test
  // "partition bị đói ngân sách nhiều lần liên tiếp..."). Vòng này không đọc
  // record, không đụng ngân sách.
  for (const key of assignedKeys) {
    if (workingRuntime.paused.includes(key)) continue // pause: không đụng position, xem applyPause
    const partition = state.partitions[key]
    if (!partition) continue
    const resolved = resolvePosition({
      position: workingRuntime.position[key],
      logStartOffset: partition.logStartOffset,
      highWatermark: partition.highWatermark,
      autoOffsetReset,
    })
    workingRuntime = { ...workingRuntime, position: { ...workingRuntime.position, [key]: resolved } }
  }

  const records: LogEntry[] = []
  let remaining = maxPollRecords
  // Số record bị GIẤU khỏi `read_committed` VÌ thuộc một transaction đã abort —
  // khác record bị cắt bởi LSO (chưa từng thật sự được fetch, xem why-comment ở
  // dưới) và khác control record (không phải "bị bỏ qua", chúng chưa từng là dữ
  // liệu ứng dụng). `metrics.abortedRecordsSkipped` chỉ đếm đúng phần này.
  let abortedSkipped = 0

  for (const key of assignedKeys) {
    if (remaining <= 0) break
    if (workingRuntime.paused.includes(key)) continue
    const rawPartition = state.partitions[key]
    if (!rawPartition) continue

    // `lastStableOffset` chỉ chắc chắn mới ngay sau lần `recomputeLastStableOffset`
    // gần nhất (`transaction.ts`) — không có gì trong đường produce thường
    // (`produce.ts`, ngoài phạm vi Task 9) tự gọi lại nó mỗi lần append. Tính lại
    // NGAY TRƯỚC khi dùng, chỉ khi thật sự cần (`read_committed`) — partition
    // không transactional thì không tốn gì thêm ở nhánh `read_uncommitted`.
    const partition = isolationLevel === 'read_committed' ? recomputeLastStableOffset(rawPartition) : rawPartition

    // Đã được gán ở vòng trên cho mọi partition không pause tới đây —
    // `?? partition.logStartOffset` chỉ là rào chắn kiểu cho
    // `noUncheckedIndexedAccess`, không phải một nhánh thật sự chạy được.
    const position = workingRuntime.position[key] ?? partition.logStartOffset
    const rawFetched = readFrom(partition, position, remaining)
    if (rawFetched.length === 0) continue

    // `read_committed` không bao giờ đọc quá `lastStableOffset` — dù `readFrom` ở
    // trên đã trả record tới tận `highWatermark` (biên của `read_uncommitted`).
    // Cắt NGAY tại đây, TRƯỚC khi cập nhật `position`: một record nằm sau LSO
    // hoàn toàn CHƯA được coi là "đã đọc" — nó phải còn nguyên để lần fetch KẾ
    // TIẾP (sau khi transaction đang treo nó commit/abort) đọc lại đúng chỗ, chứ
    // không phải bị im lặng nhảy qua như thể consumer đã bỏ lỡ nó.
    const consumed =
      isolationLevel === 'read_committed' ? rawFetched.filter((entry) => entry.offset < partition.lastStableOffset) : rawFetched
    if (consumed.length === 0) continue

    workingRuntime = { ...workingRuntime, position: { ...workingRuntime.position, [key]: position + consumed.length } }
    remaining -= consumed.length

    const visible = filterForIsolation(consumed, partition, isolationLevel)
    // Những gì đáng lẽ thấy được nếu bỏ qua riêng luật abort (chỉ còn bị chặn bởi
    // control record, không phải luật này) — hiệu số với `visible` chính là phần
    // luật abort loại thêm.
    const candidateVisible = consumed.filter((entry) => entry.control === undefined)
    abortedSkipped += candidateVisible.length - visible.length

    records.push(...visible)
  }

  workingRuntime = { ...workingRuntime, lastPollAt: at }
  let nextState = putRuntime(state, consumer.id, workingRuntime)
  nextState = {
    ...nextState,
    metrics: {
      ...nextState.metrics,
      recordsConsumed: nextState.metrics.recordsConsumed + records.length,
      abortedRecordsSkipped: nextState.metrics.abortedRecordsSkipped + abortedSkipped,
    },
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
