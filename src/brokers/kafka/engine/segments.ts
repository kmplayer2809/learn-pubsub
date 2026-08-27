import type { KafkaTopicSpec, PartitionState } from './types'

// ---------------------------------------------------------------------------
// Segment rolling và retention — quản lý cách log vật lý được chia thành các
// segment file (mô phỏng), và cách retention xoá segment cũ từ đầu log.
//
// `now` luôn được truyền vào từ ngoài (thời gian ảo của kernel) — không bao giờ
// đọc đồng hồ thật ở đây, xem invariant determinism ở CLAUDE.md.
// ---------------------------------------------------------------------------

type SegmentConfig = KafkaTopicSpec['config']

/**
 * Đưa cấu trúc segment khớp lại với `partition.log` hiện tại. Mọi segment đã
 * `sealed` là lịch sử cố định, không đụng tới — hàm chỉ xét lại phần log thuộc
 * segment ĐANG MỞ (`offset >= segment mở cuối cùng.baseOffset`) và phát lại quyết
 * định roll cho từng record theo đúng thứ tự offset.
 *
 * Vì lý do đó, hàm này an toàn dù được gọi sau MỖI lần `appendRecord` (như một
 * reducer thật sẽ làm) hoặc chỉ gọi một lần sau một loạt append dồn lại (như test
 * `withRecords` ở `segments.test.ts` làm) — kết quả giống hệt nhau, vì nó luôn
 * tính lại từ nguồn sự thật (`partition.log`) thay vì tin vào một bộ đếm byte
 * cộng dồn có thể bị bỏ lỡ giữa hai lần gọi.
 *
 * Roll xảy ra TRƯỚC khi cộng byte của record gây tràn — record đó mở đầu segment
 * mới, không phải record cuối của segment cũ. Điều này khớp với cách Kafka thật
 * không bao giờ để một segment vượt `segment.bytes` chỉ vì trót cộng thêm một
 * record: ngưỡng được kiểm tra trước khi ghi.
 */
export function rollSegments(partition: PartitionState, config: SegmentConfig, now: number): PartitionState {
  const segments = partition.segments
  const open = segments.at(-1)
  // `createPartition` luôn khởi tạo với một segment mở — mảng rỗng không xảy ra
  // trong luồng bình thường, nhưng giữ lại để không mất tính thuần khi caller
  // truyền vào một `partition` đã bị hỏng invariant.
  if (!open) return partition

  const sealedHistory = segments.slice(0, -1) // segment đã sealed từ trước — không đụng tới
  const pending = partition.log.filter((entry) => entry.offset >= open.baseOffset)

  const newlySealed: PartitionState['segments'] = []
  let current = { ...open, bytes: 0 }

  for (const entry of pending) {
    const projected = current.bytes + entry.bytes
    const overBytes = config?.segmentBytes !== undefined && projected > config.segmentBytes
    const overAge = config?.segmentMs !== undefined && now - current.createdAt >= config.segmentMs
    // Chỉ roll nếu segment hiện tại đã có gì đó — một segment vừa mở (bytes 0)
    // không tự seal chính nó chỉ vì record đầu tiên đã đủ lớn để vượt ngưỡng một
    // mình; ngưỡng đó áp cho tổng nhiều record, không chặn một record đơn lẻ.
    if ((overBytes || overAge) && current.bytes > 0) {
      newlySealed.push({ ...current, sealed: true })
      current = { baseOffset: entry.offset, bytes: 0, createdAt: now, sealed: false }
    }
    current = { ...current, bytes: current.bytes + entry.bytes }
  }

  return { ...partition, segments: [...sealedHistory, ...newlySealed, current] }
}

/**
 * Xoá segment đã `sealed` (không bao giờ segment đang mở) khi quá `retentionMs`
 * tuổi, hoặc khi tổng byte của log vượt `retentionBytes` (xoá từ segment cũ nhất
 * cho tới khi vừa hạn mức). Sau khi xoá, `logStartOffset` nhảy lên `baseOffset`
 * của segment còn lại đầu tiên, và mọi record có `offset < logStartOffset` bị
 * cắt khỏi `log` — record còn lại GIỮ NGUYÊN offset tuyệt đối của nó.
 */
export function applyRetention(
  partition: PartitionState,
  config: SegmentConfig,
  now: number,
): { partition: PartitionState; removed: number } {
  if (!config || (config.retentionMs === undefined && config.retentionBytes === undefined)) {
    return { partition, removed: 0 }
  }

  const sealed = partition.segments.filter((s) => s.sealed)
  const open = partition.segments.filter((s) => !s.sealed)

  // Segment cũ nhất trước — `partition.segments` được xây theo thứ tự tạo nên
  // đã sẵn cũ→mới, không cần sort lại.
  const toDelete = new Set<number>() // index trong `sealed`
  let totalBytes = partition.segments.reduce((sum, s) => sum + s.bytes, 0)

  for (let i = 0; i < sealed.length; i++) {
    const s = sealed[i]
    if (!s) continue
    const tooOld = config.retentionMs !== undefined && now - s.createdAt > config.retentionMs
    const tooBig = config.retentionBytes !== undefined && totalBytes > config.retentionBytes
    if (tooOld || tooBig) {
      toDelete.add(i)
      totalBytes -= s.bytes
    } else {
      // Segment cũ nhất còn lại chưa vi phạm hạn mức: mọi segment mới hơn nó
      // vẫn được giữ — retention chỉ xoá liên tục từ đầu, không xoá "lỗ hổng"
      // giữa log.
      break
    }
  }

  if (toDelete.size === 0) return { partition, removed: 0 }

  const survivingSealed = sealed.filter((_, i) => !toDelete.has(i))
  const survivingSegments = [...survivingSealed, ...open]
  const firstSurviving = survivingSegments[0]
  // `open` (segment đang mở) không bao giờ nằm trong `toDelete`, nên luôn còn ít
  // nhất một segment sống sót — `firstSurviving` không thể undefined ở đây.
  const logStartOffset = firstSurviving ? firstSurviving.baseOffset : partition.logStartOffset

  const survivingLog = partition.log.filter((entry) => entry.offset >= logStartOffset)
  const removed = partition.log.length - survivingLog.length

  return {
    partition: { ...partition, segments: survivingSegments, logStartOffset, log: survivingLog },
    removed,
  }
}
