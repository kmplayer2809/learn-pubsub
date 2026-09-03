import type { LogEntry, PartitionState } from './types'

// ---------------------------------------------------------------------------
// Log compaction (`cleanup.policy=compact`) — với mỗi key, chỉ giữ lại bản ghi
// MỚI NHẤT trong log; mọi bản cũ hơn của cùng key bị xoá. Record không key
// (`key === null`) không có gì để gộp theo nên luôn được giữ, bất kể có bao
// nhiêu record không key khác. Một tombstone (`value === null`) làm nốt nhiệm
// vụ xoá mọi bản cũ hơn của cùng key rồi tự xoá luôn chính nó — sau compact,
// key đó biến mất hoàn toàn khỏi log.
//
// Duyệt log NGƯỢC từ cuối: lần gặp đầu tiên của một key theo chiều duyệt ngược
// chính là bản ghi MỚI NHẤT theo offset thật — giữ nó, bỏ mọi lần gặp sau đó
// (tức cũ hơn). Đây là cách rẻ nhất để tìm "bản mới nhất của mỗi key" mà không
// cần hai lượt duyệt hay một map offset->index riêng.
//
// Chỉ record thuộc segment ĐÃ `sealed` mới được xét — segment đang mở (nếu có,
// luôn là phần tử cuối `partition.segments` khi chưa sealed) không bao giờ bị
// đụng tới, kể cả khi nó chứa record trùng key với phần đã compact. Đây đúng
// hành vi Kafka thật: compaction không bao giờ chạm segment active.
//
// Offset KHÔNG được đánh số lại (cùng nguyên tắc với `applyRetention`,
// `segments.ts`): record còn lại giữ nguyên offset tuyệt đối, để lại "lỗ"
// trong dãy offset — consumer phải chịu được điều đó. `logStartOffset` cũng
// không đổi ở đây; nó chỉ do retention cập nhật, compaction không phải việc
// của nó.
// ---------------------------------------------------------------------------

/**
 * `now` nằm trong chữ ký để khớp hình dạng chung với các hàm dọn log khác
 * (`applyRetention` nhận `now` để so tuổi segment) và để chỗ sẵn cho một cấu
 * hình kiểu độ trễ xoá tombstone sau này nếu plan cần tới — nhưng quyết định
 * giữ/xoá record ở hàm này chỉ phụ thuộc key và việc record có nằm trong
 * segment đã sealed hay không, không phụ thuộc thời gian ảo hiện tại, nên
 * tham số chưa được đọc ở thân hàm.
 */
export function compact(partition: PartitionState, _now: number): { partition: PartitionState; removed: number } {
  const lastSegment = partition.segments.at(-1)
  const openBaseOffset = lastSegment && !lastSegment.sealed ? lastSegment.baseOffset : undefined

  // Ranh giới giữa phần "đã sealed, được xét" và phần "đang mở, giữ nguyên".
  // `partition.log` luôn tăng dần theo offset (append-only), nên điểm đầu tiên
  // có offset >= baseOffset của segment mở chính là ranh giới đó.
  const boundary =
    openBaseOffset === undefined
      ? partition.log.length
      : (() => {
          const idx = partition.log.findIndex((e) => e.offset >= openBaseOffset)
          return idx === -1 ? partition.log.length : idx
        })()

  const eligible = partition.log.slice(0, boundary)
  const untouched = partition.log.slice(boundary)

  const seenKeys = new Set<string>()
  const keptReversed: LogEntry[] = []

  for (let i = eligible.length - 1; i >= 0; i--) {
    const record = eligible[i]
    if (!record) continue

    if (record.key === null || record.key === undefined) {
      keptReversed.push(record)
      continue
    }

    if (seenKeys.has(record.key)) continue // bản cũ hơn của một key đã gặp — xoá

    seenKeys.add(record.key)
    if (record.value === null) continue // tombstone: đã làm nhiệm vụ, tự xoá luôn
    keptReversed.push(record)
  }

  keptReversed.reverse()
  const survivingLog = [...keptReversed, ...untouched]
  const removed = partition.log.length - survivingLog.length

  return { partition: { ...partition, log: survivingLog }, removed }
}
