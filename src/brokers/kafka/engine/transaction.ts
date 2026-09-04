import { appendRecord, estimateBytes } from './log'
import { sortedPartitionKeys } from './types'
import type { KafkaState, LogEntry, NodeId, PartitionState, ProducerRuntime } from './types'

// ---------------------------------------------------------------------------
// Transaction — marker, last stable offset (LSO), và lọc theo `isolationLevel`
// (§B5.5). Ba việc:
//
//   1. `beginTransaction`/`commitTransaction`/`abortTransaction`: máy trạng thái
//      transaction của MỘT producer, gõ đúng `ProducerRuntime.txnState` đã khai
//      từ trước — ghi CONTROL RECORD (`LogEntry.control`) vào MỌI partition
//      producer đó đã ghi trong transaction này, cùng một lượt, không "nửa vời"
//      (một số partition commit, số khác chưa) — xem why-comment ở `endTransaction`.
//   2. `recomputeLastStableOffset`: LSO của MỘT partition — offset thấp nhất còn
//      thuộc một transaction chưa resolve (chưa có control record), hoặc
//      `highWatermark` nếu không partition nào đang mở transaction cả. Hàm THUẦN,
//      không tự ghi lại vào `KafkaState` — `PartitionState.lastStableOffset` chỉ
//      chắc chắn mới ngay sau khi hàm này chạy; xem why-comment ở
//      `consume.ts`'s `fetchRecords` về việc gọi lại nó NGAY TRƯỚC khi lọc, vì
//      không có chỗ nào trong đường produce thường (`produce.ts`, ngoài phạm vi
//      task này) gọi nó lại mỗi lần append.
//   3. `filterForIsolation`: từ một danh sách record thô (đã đọc tới đâu đó, ví
//      dụn `readFrom` tới `highWatermark`), trả về đúng những gì MỘT
//      `isolationLevel` cụ thể được phép thấy — never a control record, và với
//      `read_committed` thì còn cắt tại LSO và bỏ record thuộc transaction đã
//      abort.
// ---------------------------------------------------------------------------

function getProducerRuntime(state: KafkaState, id: NodeId): ProducerRuntime {
  const runtime = state.producers[id]
  if (!runtime) throw new Error(`kafka engine: unknown producer ${id}`)
  return runtime
}

function putProducerRuntime(state: KafkaState, id: NodeId, runtime: ProducerRuntime): KafkaState {
  return { ...state, producers: { ...state.producers, [id]: runtime } }
}

export interface BeginTransactionArgs {
  producerId: NodeId
  at: number
}

export interface EndTransactionArgs {
  producerId: NodeId
  at: number
}

/**
 * Mở một transaction mới cho producer này. Kafka thật gọi `InitProducerId` rồi
 * bump `producerEpoch` khi `transactional.id` đã tồn tại — plan này chỉ cần một
 * `txnId` xác định (deterministic), DUY NHẤT cho lần mở này so với mọi lần mở
 * khác của CÙNG producer: ghép `producerId` với thời điểm ảo `at`. Không dùng
 * RNG/thời gian thật (không `Math.random`/`Date.now`) — đúng bất biến
 * determinism của `engine/**` (`CLAUDE.md`); hai lần `beginTransaction` cùng
 * `at` cho cùng một producer là lỗi kịch bản (không transaction nào kết thúc
 * trước khi mở lại), không phải trường hợp hàm này cần tự vệ.
 */
export function beginTransaction(state: KafkaState, args: BeginTransactionArgs): KafkaState {
  const { producerId, at } = args
  const runtime = getProducerRuntime(state, producerId)
  const txnId = `${producerId}-txn-${at}`
  return putProducerRuntime(state, producerId, { ...runtime, txnState: 'Ongoing', currentTxnId: txnId })
}

// Overhead ước lượng của một control record — không key/value thật (`key: null,
// value: null`), chỉ có phần header giống mọi record khác (`estimateBytes`,
// `log.ts`).
const CONTROL_RECORD_BYTES = estimateBytes(null, null)

/**
 * Partition này có ÍT NHẤT một record của `txnId` mà CHƯA có control record nào
 * resolve nó — tức producer thật sự đã ghi vào partition này trong transaction
 * đang mở, và transaction đó chưa từng kết thúc trên partition này. `endTransaction`
 * dùng nó để biết partition nào cần một control record mới — một partition
 * producer chưa từng đụng tới trong transaction này thì không có gì để đóng.
 */
function partitionHasOpenTxnRecord(partition: PartitionState, txnId: string): boolean {
  let hasData = false
  let resolved = false
  for (const entry of partition.log) {
    if (entry.txnId !== txnId) continue
    if (entry.control !== undefined) resolved = true
    else hasData = true
  }
  return hasData && !resolved
}

/**
 * Dùng chung cho cả `commitTransaction` và `abortTransaction` — hai hàm chỉ khác
 * nhau ở `outcome` ghi vào `LogEntry.control`, mọi thứ khác giống hệt nhau,
 * quan trọng nhất là: quét TẤT CẢ partition (`sortedPartitionKeys`, §B6 — không
 * lặp thẳng `Object.keys`), ghi control record vào MỌI partition đang có
 * transaction này còn mở, trong CÙNG một lượt gọi. Đây chính là chỗ đảm bảo
 * "một transaction trên nhiều partition commit/abort cùng nhau, không nửa vời"
 * — không có nhánh nào ghi xong một phần partition rồi dừng giữa chừng, không
 * event nào khác len vào giữa lúc hàm này chạy (nó là một lần gọi hàm thuần,
 * không phải nhiều event tách rời).
 */
function endTransaction(state: KafkaState, args: EndTransactionArgs, outcome: 'commit' | 'abort'): KafkaState {
  const { producerId, at } = args
  const runtime = getProducerRuntime(state, producerId)
  const txnId = runtime.currentTxnId
  // Không có transaction nào đang mở — no-op an toàn thay vì throw: một lesson
  // lỡ gọi commit/abort không đúng lúc không nên làm sập cả simulation, cùng
  // triết lý với `applyResume` một partition chưa từng pause.
  if (txnId === undefined) return state

  let partitions = state.partitions
  for (const key of sortedPartitionKeys(state)) {
    const partition = partitions[key]
    if (!partition) continue
    if (!partitionHasOpenTxnRecord(partition, txnId)) continue
    const { partition: withMarker } = appendRecord(partition, {
      key: null,
      value: null,
      timestamp: at,
      bytes: CONTROL_RECORD_BYTES,
      txnId,
      control: outcome,
    })
    partitions = { ...partitions, [key]: recomputeLastStableOffset(withMarker) }
  }

  // Xoá `currentTxnId` bằng destructure-bỏ, không gán `undefined` tường minh —
  // cùng quy ước `stickyPartition` (`types.ts`): "chưa có transaction nào" là
  // trạng thái VẮNG MẶT property, không phải một giá trị `undefined` cụ thể.
  const { currentTxnId: _currentTxnId, ...runtimeWithoutTxnId } = runtime
  return {
    ...state,
    partitions,
    producers: { ...state.producers, [producerId]: { ...runtimeWithoutTxnId, txnState: 'Empty' } },
  }
}

export function commitTransaction(state: KafkaState, args: EndTransactionArgs): KafkaState {
  return endTransaction(state, args, 'commit')
}

export function abortTransaction(state: KafkaState, args: EndTransactionArgs): KafkaState {
  return endTransaction(state, args, 'abort')
}

/**
 * LSO = offset THẤP NHẤT còn thuộc một transaction chưa resolve, hoặc
 * `highWatermark` nếu không có transaction nào đang mở trên partition này.
 * "Resolve" nghĩa là có một record `control` (`'commit'` hoặc `'abort'` — cả
 * hai đều đóng transaction, khác nhau chỉ ở việc record dữ liệu có được
 * `filterForIsolation` cho `read_committed` thấy hay không) cùng `txnId` xuất
 * hiện SAU đó trong log.
 *
 * Hàm THUẦN, chỉ đọc `partition.log`/`partition.highWatermark` — không cần gì
 * từ `KafkaState` (không biết producer nào đang mở gì), đúng chữ ký
 * `(partition) => PartitionState` mà `filterForIsolation`/`consume.ts` cần: LSO
 * là một thuộc tính CỦA PARTITION, suy ra hoàn toàn từ nội dung log của chính
 * nó, không phải một thứ phải tra cứu qua producer runtime.
 *
 * Cắt tại LSO áp dụng cho MỌI record ở offset đó trở lên, không chỉ record
 * thuộc transaction đang mở — đúng ngữ nghĩa Kafka thật: một consumer
 * `read_committed` không thể biết chắc trạng thái cuối cùng của bất kỳ điều gì
 * ở SAU điểm còn treo, nên toàn bộ phần log từ đó trở đi bị giữ lại, kể cả
 * record hoàn toàn không transactional.
 */
export function recomputeLastStableOffset(partition: PartitionState): PartitionState {
  const resolvedTxnIds = new Set<string>()
  for (const entry of partition.log) {
    if (entry.control !== undefined && entry.txnId !== undefined) resolvedTxnIds.add(entry.txnId)
  }

  let lastStableOffset = partition.highWatermark
  for (const entry of partition.log) {
    if (entry.control !== undefined) continue // control record tự nó không "mở" gì
    if (entry.txnId === undefined) continue // record không transactional, không ảnh hưởng LSO
    if (resolvedTxnIds.has(entry.txnId)) continue
    if (entry.offset < lastStableOffset) lastStableOffset = entry.offset
  }

  return { ...partition, lastStableOffset }
}

/**
 * Lọc một danh sách record THÔ (đã đọc từ log, ví dụ qua `readFrom` tới
 * `highWatermark`) xuống đúng những gì `isolationLevel` này được phép thấy.
 *
 * Control record KHÔNG BAO GIỜ tới tầng ứng dụng, ở CẢ HAI isolation level —
 * đó là bookkeeping nội bộ broker (đánh dấu một transaction đã commit/abort),
 * không phải dữ liệu producer từng gửi.
 *
 * `read_uncommitted`: thấy mọi thứ khác, kể cả record thuộc transaction đã
 * abort — đúng nghĩa "chưa cam kết", client tự chịu trách nhiệm có thể thấy dữ
 * liệu rồi biến mất.
 *
 * `read_committed`: thêm hai lớp lọc — cắt tại `partition.lastStableOffset`
 * (record ở offset đó trở lên CHƯA từng được coi là "đã đọc", xem why-comment ở
 * `recomputeLastStableOffset`), và bỏ record có `txnId` thuộc một transaction
 * đã kết thúc bằng abort (tra trực tiếp trong `partition.log`, không chỉ trong
 * `records` truyền vào — control record resolve một txnId có thể nằm NGOÀI cửa
 * sổ record đang lọc).
 */
export function filterForIsolation(
  records: LogEntry[],
  partition: PartitionState,
  isolationLevel: 'read_uncommitted' | 'read_committed',
): LogEntry[] {
  if (isolationLevel === 'read_uncommitted') {
    return records.filter((entry) => entry.control === undefined)
  }

  const abortedTxnIds = new Set<string>()
  for (const entry of partition.log) {
    if (entry.control === 'abort' && entry.txnId !== undefined) abortedTxnIds.add(entry.txnId)
  }

  return records.filter((entry) => {
    if (entry.control !== undefined) return false
    if (entry.offset >= partition.lastStableOffset) return false
    if (entry.txnId !== undefined && abortedTxnIds.has(entry.txnId)) return false
    return true
  })
}
