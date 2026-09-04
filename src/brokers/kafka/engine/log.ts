import type { LogEntry, NodeId, PartitionState } from './types'

// ---------------------------------------------------------------------------
// Log per-partition — append-only, offset tuyệt đối, không bao giờ đánh lại số.
//
// `logStartOffset` khác `leo` khác `highWatermark`:
//   - `leo` (log end offset): offset mà append kế tiếp sẽ nhận.
//   - `highWatermark`: offset cao nhất consumer được phép đọc — min(LEO) trên ISR.
//   - `logStartOffset`: tăng khi retention xoá record ở đầu log (xem `segments.ts`).
// Sau khi retention xoá N record đầu, record còn lại GIỮ NGUYÊN offset cũ — không
// renumber. `readFrom` vì vậy phải tìm theo offset tuyệt đối, không phải theo vị
// trí mảng: `log[0]` không còn chắc là offset 0 sau bất kỳ lần xoá nào.
// ---------------------------------------------------------------------------

export function createPartition(args: { topic: string; index: number; leader: NodeId; replicas: NodeId[] }): PartitionState {
  const { topic, index, leader, replicas } = args
  const replicaState: Record<NodeId, { leo: number; lastFetchAt: number }> = {}
  for (const r of replicas) replicaState[r] = { leo: 0, lastFetchAt: 0 }
  return {
    topic,
    index,
    leader,
    replicas,
    isr: replicas,
    log: [],
    logStartOffset: 0,
    leo: 0,
    highWatermark: 0,
    lastStableOffset: 0,
    replicaState,
    segments: [{ baseOffset: 0, bytes: 0, createdAt: 0, sealed: false }],
    leaderEpoch: 0,
    producerState: {},
    pendingAcks: [],
  }
}

/**
 * Task 8 (Ā): trước đây hàm này TỰ đặt `highWatermark: leo` — coi mỗi append là
 * "đã tới ISR" ngay lập tức, vì plan trước chưa có follower fetch thật. Giờ
 * `replicaFetch` (`replication.ts`) đã chạy thật và tự cập nhật
 * `replicaState` của follower theo thời gian, nên nguồn sự thật duy nhất cho
 * `highWatermark` phải là `recomputeHighWatermark` (dựa trên `isr`/
 * `replicaState`), KHÔNG còn hardcode `leo` nữa.
 *
 * Với partition một replica (`isr` chỉ có đúng `leader`) hành vi không đổi:
 * dòng dưới đây vẫn cập nhật `replicaState[leader]` ngay tại đây, nên
 * `recomputeHighWatermark` cho `min(LEO trên isr) = leo` tức khắc — `acks=1`/
 * `acks=all` ở mọi lesson `replicationFactor: 1` (01-16) tiếp tục xong ngay,
 * không đổi thời điểm phản hồi. Chỉ partition NHIỀU replica mới thấy
 * `highWatermark` tụt lại sau `leo` cho tới khi follower thật sự fetch kịp —
 * xem test "readFrom không bao giờ trả record vượt quá high watermark".
 */
export function appendRecord(partition: PartitionState, record: Omit<LogEntry, 'offset'>): { partition: PartitionState; offset: number } {
  const offset = partition.leo
  const entry: LogEntry = { ...record, offset }
  const leo = offset + 1
  const next: PartitionState = recomputeHighWatermark({
    ...partition,
    log: [...partition.log, entry],
    leo,
    replicaState: {
      ...partition.replicaState,
      [partition.leader]: { leo, lastFetchAt: record.timestamp },
    },
  })
  return { partition: next, offset }
}

// `offset` ở đây là offset tuyệt đối — so khớp bằng trường `entry.offset` của
// từng record, không phải vị trí trong mảng `log`. Đây chính là chỗ dễ sai nhất
// của file này sau bất kỳ lần retention nào xoá record đầu: `log[0]` không còn
// chắc là offset 0.
export function readFrom(partition: PartitionState, offset: number, maxRecords: number): LogEntry[] {
  // Offset đã bị retention xoá (< logStartOffset): Kafka thật trả lỗi
  // OffsetOutOfRange, nhưng ở mức engine thuần này chỉ cần trả rỗng — caller quyết
  // định có coi đó là lỗi hay không (ví dụ áp dụng `auto.offset.reset`). Đây phải
  // là một nhánh RÕ RÀNG, không phải "kẹp" `offset` lên `logStartOffset` rồi lặng
  // lẽ đọc tiếp — kẹp như vậy sẽ trả dữ liệu bắt đầu từ chỗ khác offset caller
  // yêu cầu mà không hề báo hiệu, khiến caller không thể phân biệt "đọc đúng chỗ"
  // với "đã bị retention cắt".
  if (offset < partition.logStartOffset) return []

  const result: LogEntry[] = []
  for (const entry of partition.log) {
    if (entry.offset < offset) continue
    // Không bao giờ vượt high watermark — record vừa ghi mà chưa replica nào bắt
    // kịp thì vẫn "chưa tồn tại" với consumer, đúng bảo đảm read-committed-visible
    // của Kafka thật.
    if (entry.offset >= partition.highWatermark) break
    result.push(entry)
    if (result.length >= maxRecords) break
  }
  return result
}

// HW = min(LEO của mọi replica trong ISR). ISR rỗng (mọi replica rớt) thì giữ
// nguyên HW cũ thay vì tụt về 0 hoặc Infinity — trong plan này (chưa có
// replication thật) ISR luôn bằng `replicas` trừ khi test override, nên nhánh
// rỗng chỉ là an toàn cho tương lai, không phải đường đi chính.
export function recomputeHighWatermark(partition: PartitionState): PartitionState {
  if (partition.isr.length === 0) return partition
  let min: number | undefined
  for (const brokerId of partition.isr) {
    const state = partition.replicaState[brokerId]
    const leo = state?.leo ?? 0
    if (min === undefined || leo < min) min = leo
  }
  return { ...partition, highWatermark: min ?? partition.highWatermark }
}

// 40 byte là overhead xấp xỉ của record batch header trong Kafka thật (varint
// length, CRC, attributes, timestamp delta...). Số này chỉ cần ổn định — dùng cho
// so sánh với `segment.bytes`/`retention.bytes`, không phải để tái hiện wire
// format thật.
export function estimateBytes(key: string | null, value: string | null): number {
  return (key?.length ?? 0) + (value?.length ?? 0) + 40
}
