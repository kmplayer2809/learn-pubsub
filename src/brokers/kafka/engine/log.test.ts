import { describe, expect, it } from 'vitest'
import { appendRecord, createPartition, readFrom, recomputeHighWatermark } from './log'

const empty = () => createPartition({ topic: 'orders', index: 0, leader: 'b1', replicas: ['b1', 'b2'] })

const push = (p: ReturnType<typeof empty>, value: string) =>
  appendRecord(p, { key: null, value, timestamp: 0, bytes: 10 }).partition

describe('log', () => {
  it('partition mới rỗng: mọi offset bằng 0', () => {
    const p = empty()
    expect(p.leo).toBe(0)
    expect(p.logStartOffset).toBe(0)
    expect(p.highWatermark).toBe(0)
    expect(p.log).toEqual([])
  })

  it('offset cấp tăng dần từ 0 và không bao giờ dùng lại', () => {
    let p = empty()
    const a = appendRecord(p, { key: null, value: 'a', timestamp: 0, bytes: 10 })
    p = a.partition
    const b = appendRecord(p, { key: null, value: 'b', timestamp: 1, bytes: 10 })
    expect(a.offset).toBe(0)
    expect(b.offset).toBe(1)
    expect(b.partition.leo).toBe(2)
  })

  it('append không sửa partition cũ — reducer phải thuần', () => {
    const before = empty()
    appendRecord(before, { key: null, value: 'a', timestamp: 0, bytes: 10 })
    expect(before.log).toHaveLength(0)
    expect(before.leo).toBe(0)
  })

  it('readFrom trả đúng số record tối đa, bắt đầu từ offset yêu cầu', () => {
    let p = empty()
    for (const v of ['a', 'b', 'c', 'd']) p = push(p, v)
    expect(readFrom(p, 1, 2).map((r) => r.value)).toEqual(['b', 'c'])
  })

  it('readFrom không bao giờ trả record vượt quá high watermark', () => {
    let p = empty()
    for (const v of ['a', 'b', 'c']) p = push(p, v)
    // Chưa replica nào bắt kịp: HW vẫn 0, nên consumer không thấy gì. Đây chính
    // là lý do một record vừa ghi xong vẫn "chưa đọc được" trên Kafka thật.
    expect(readFrom({ ...p, highWatermark: 0 }, 0, 10)).toEqual([])
    expect(readFrom({ ...p, highWatermark: 2 }, 0, 10)).toHaveLength(2)
  })

  it('high watermark là LEO nhỏ nhất trong ISR, không phải của leader', () => {
    let p = empty()
    for (const v of ['a', 'b', 'c']) p = push(p, v)
    p = {
      ...p,
      isr: ['b1', 'b2'],
      replicaState: { b1: { leo: 3, lastFetchAt: 0 }, b2: { leo: 1, lastFetchAt: 0 } },
    }
    expect(recomputeHighWatermark(p).highWatermark).toBe(1)
  })

  it('replica ngoài ISR không kéo tụt high watermark', () => {
    let p = empty()
    for (const v of ['a', 'b', 'c']) p = push(p, v)
    p = {
      ...p,
      isr: ['b1'],
      replicaState: { b1: { leo: 3, lastFetchAt: 0 }, b2: { leo: 0, lastFetchAt: 0 } },
    }
    expect(recomputeHighWatermark(p).highWatermark).toBe(3)
  })
})
