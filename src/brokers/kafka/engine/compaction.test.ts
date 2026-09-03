import { describe, expect, it } from 'vitest'
import { createPartition } from './log'
import { compact } from './compaction'
import type { LogEntry, PartitionState } from './types'

// Xây `PartitionState` trực tiếp thay vì qua `appendRecord`/`rollSegments` — test
// này cần kiểm soát chính xác record nào nằm trong segment sealed và record nào
// nằm trong segment đang mở, chứ không cần mô phỏng lại logic roll thật.
function withLog(entries: LogEntry[], segments: PartitionState['segments'], logStartOffset = 0): PartitionState {
  const base = createPartition({ topic: 'orders', index: 0, leader: 'b1', replicas: ['b1'] })
  const leo = entries.length > 0 ? Math.max(...entries.map((e) => e.offset)) + 1 : 0
  return { ...base, log: entries, segments, logStartOffset, leo, highWatermark: leo }
}

function entry(offset: number, key: string | null, value: string | null): LogEntry {
  return { offset, key, value, timestamp: offset * 1000, bytes: 10 }
}

describe('compaction', () => {
  it('giữ lại bản ghi cuối của mỗi key, xoá bản cũ hơn', () => {
    const partition = withLog(
      [entry(0, 'a', 'v1'), entry(1, 'b', 'w1'), entry(2, 'a', 'v2')],
      [{ baseOffset: 0, bytes: 30, createdAt: 0, sealed: true }, { baseOffset: 3, bytes: 0, createdAt: 3000, sealed: false }],
    )

    const { partition: result, removed } = compact(partition, 10_000)

    expect(result.log.map((e) => [e.key, e.value])).toEqual([
      ['b', 'w1'],
      ['a', 'v2'],
    ])
    expect(removed).toBe(1)
  })

  it('không đụng tới record trong segment đang mở — Kafka cũng vậy', () => {
    const partition = withLog(
      [entry(0, 'x', 'v0'), entry(1, 'x', 'v1'), entry(2, 'x', 'v2'), entry(3, 'y', 'v3')],
      [{ baseOffset: 0, bytes: 20, createdAt: 0, sealed: true }, { baseOffset: 2, bytes: 20, createdAt: 2000, sealed: false }],
    )

    const { partition: result, removed } = compact(partition, 10_000)

    // Sealed: offset 0 và 1 cùng key 'x' — chỉ offset 1 (mới nhất trong phần
    // sealed) sống sót. Open (offset 2, 3): giữ nguyên toàn bộ dù 'x' cũng
    // xuất hiện lại ở đó — compaction không xét record ngoài segment sealed.
    expect(result.log.map((e) => e.offset)).toEqual([1, 2, 3])
    expect(result.log.find((e) => e.offset === 2)).toEqual(entry(2, 'x', 'v2'))
    expect(result.log.find((e) => e.offset === 3)).toEqual(entry(3, 'y', 'v3'))
    expect(removed).toBe(1)
  })

  it('record không key được giữ nguyên, compaction không biết gộp chúng theo gì', () => {
    const partition = withLog(
      [entry(0, null, 'a'), entry(1, null, 'b'), entry(2, null, 'c')],
      [{ baseOffset: 0, bytes: 30, createdAt: 0, sealed: true }, { baseOffset: 3, bytes: 0, createdAt: 3000, sealed: false }],
    )

    const { partition: result, removed } = compact(partition, 10_000)

    expect(result.log).toHaveLength(3)
    expect(result.log.map((e) => e.value)).toEqual(['a', 'b', 'c'])
    expect(removed).toBe(0)
  })

  it('tombstone (value = null) xoá hẳn key khỏi log sau khi compact', () => {
    const partition = withLog(
      [entry(0, 'k', 'v1'), entry(1, 'k', null), entry(2, 'j', 'z')],
      [{ baseOffset: 0, bytes: 30, createdAt: 0, sealed: true }, { baseOffset: 3, bytes: 0, createdAt: 3000, sealed: false }],
    )

    const { partition: result, removed } = compact(partition, 10_000)

    expect(result.log.some((e) => e.key === 'k')).toBe(false)
    expect(result.log.map((e) => [e.key, e.value])).toEqual([['j', 'z']])
    expect(removed).toBe(2)
  })

  it('offset của record còn lại giữ nguyên, không đánh số lại', () => {
    const partition = withLog(
      [entry(0, 'a', 'v1'), entry(1, 'b', 'w1'), entry(2, 'a', 'v2')],
      [{ baseOffset: 0, bytes: 30, createdAt: 0, sealed: true }, { baseOffset: 3, bytes: 0, createdAt: 3000, sealed: false }],
    )

    const { partition: result } = compact(partition, 10_000)

    // Log còn lại có "lỗ" offset (thiếu 0) — không bị dồn lại thành [0, 1].
    expect(result.log.map((e) => e.offset)).toEqual([1, 2])
  })

  it('logStartOffset không đổi khi compaction chạy — nó chỉ đổi bởi retention', () => {
    const partition = withLog(
      [entry(5, 'a', 'v1'), entry(6, 'b', 'w1'), entry(7, 'a', 'v2')],
      [{ baseOffset: 5, bytes: 30, createdAt: 0, sealed: true }, { baseOffset: 8, bytes: 0, createdAt: 3000, sealed: false }],
      5,
    )

    const { partition: result } = compact(partition, 10_000)

    expect(result.logStartOffset).toBe(5)
  })
})
