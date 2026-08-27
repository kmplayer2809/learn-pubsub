import { describe, expect, it } from 'vitest'
import { appendRecord, createPartition, readFrom } from './log'
import { applyRetention, rollSegments } from './segments'

function withRecords(count: number, bytes: number) {
  let p = createPartition({ topic: 'orders', index: 0, leader: 'b1', replicas: ['b1'] })
  for (let i = 0; i < count; i++) {
    p = appendRecord(p, { key: null, value: `v${i}`, timestamp: i * 1000, bytes }).partition
  }
  return p
}

describe('segments', () => {
  it('segment đang mở đóng lại khi vượt segment.bytes', () => {
    const p = rollSegments(withRecords(5, 100), { segmentBytes: 250 }, 5000)
    expect(p.segments.filter((s) => s.sealed).length).toBeGreaterThanOrEqual(1)
    expect(p.segments.at(-1)?.sealed).toBe(false)
  })

  it('retention.ms xoá segment đã đóng và đủ già, kéo logStartOffset lên', () => {
    let p = rollSegments(withRecords(6, 100), { segmentBytes: 200 }, 6000)
    const result = applyRetention(p, { segmentBytes: 200, retentionMs: 2000 }, 10_000)
    expect(result.partition.logStartOffset).toBeGreaterThan(0)
    expect(result.removed).toBeGreaterThan(0)
    expect(result.partition.log[0]?.offset).toBe(result.partition.logStartOffset)
  })

  it('retention không bao giờ xoá segment đang mở — record vừa ghi luôn còn đó', () => {
    const p = rollSegments(withRecords(3, 10), { segmentBytes: 10_000 }, 3000)
    const result = applyRetention(p, { segmentBytes: 10_000, retentionMs: 1 }, 1_000_000)
    expect(result.partition.log).toHaveLength(3)
    expect(result.removed).toBe(0)
  })

  it('không cấu hình retention thì không xoá gì', () => {
    const p = withRecords(4, 10)
    expect(applyRetention(p, undefined, 999_999).removed).toBe(0)
  })

  it('offset vẫn tuyệt đối sau khi retention xoá đầu log — đọc bằng offset, không bằng vị trí mảng', () => {
    let p = rollSegments(withRecords(6, 100), { segmentBytes: 200 }, 6000)
    const { partition } = applyRetention(p, { segmentBytes: 200, retentionMs: 2000 }, 10_000)
    // Record offset 4 và 5 sống sót (xem test retention.ms ở trên): `log` giờ chỉ
    // còn 2 phần tử, nên `log[4]` theo VỊ TRÍ MẢNG chắc chắn `undefined`. Nếu
    // `readFrom` lỡ dùng index thay vì tìm theo offset tuyệt đối, assertion dưới
    // sẽ trả về mảng rỗng thay vì hai record đúng — đây chính là bug offset-vs-
    // array-index mà bài học tồn tại để dạy tránh.
    expect(partition.log).toHaveLength(2)
    expect(partition.log.map((r) => r.offset)).toEqual([4, 5])
    expect(readFrom(partition, 4, 10).map((r) => r.value)).toEqual(['v4', 'v5'])
    // Offset 2 đã bị retention xoá (< logStartOffset 4): không trả về gì, dù nó
    // từng là offset hợp lệ trước khi retention chạy.
    expect(readFrom(partition, 2, 10)).toEqual([])
  })
})
