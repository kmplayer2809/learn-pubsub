import { describe, expect, it } from 'vitest'
import { createRng } from '../../../shell/kernel/rng'
import { pickPartition } from './partitioner'

const rng = createRng(1)

describe('pickPartition', () => {
  it('default: cùng key luôn về cùng partition', () => {
    const first = pickPartition({ key: 'user-42', partitionCount: 6, partitioner: 'default', roundRobinCounter: 0, rng })
    const second = pickPartition({ key: 'user-42', partitionCount: 6, partitioner: 'default', roundRobinCounter: 99, rng })
    expect(first.partition).toBe(second.partition)
  })

  it('default: partition luôn nằm trong khoảng hợp lệ', () => {
    for (const key of ['a', 'user-1', 'user-2', 'order-9999', 'đơn-hàng-7']) {
      const { partition } = pickPartition({ key, partitionCount: 3, partitioner: 'default', roundRobinCounter: 0, rng })
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(3)
    }
  })

  it('round-robin: key null rải đều lần lượt', () => {
    let counter = 0
    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      const result = pickPartition({ key: null, partitionCount: 3, partitioner: 'round-robin', roundRobinCounter: counter, rng })
      seen.push(result.partition)
      counter = result.nextRoundRobinCounter
    }
    expect(seen).toEqual([0, 1, 2, 0, 1, 2])
  })

  it('sticky: key null bám nguyên một partition cho tới khi được đổi', () => {
    const first = pickPartition({ key: null, partitionCount: 4, partitioner: 'sticky', roundRobinCounter: 0, rng })
    const second = pickPartition({
      key: null, partitionCount: 4, partitioner: 'sticky', roundRobinCounter: 0,
      stickyPartition: first.partition, rng: first.rng,
    })
    expect(second.partition).toBe(first.partition)
  })

  it('key có giá trị thì partitioner nào cũng hash, không rải đều', () => {
    const a = pickPartition({ key: 'k', partitionCount: 5, partitioner: 'round-robin', roundRobinCounter: 0, rng })
    const b = pickPartition({ key: 'k', partitionCount: 5, partitioner: 'sticky', roundRobinCounter: 3, rng })
    expect(a.partition).toBe(b.partition)
  })

  // Fix round 1: nhánh record có key, và nhánh round-robin, không thiết lập
  // stickiness — chúng phải trả nguyên trạng thái sticky đang có, kể cả khi đó
  // là "chưa từng chọn" (undefined). `?? 0` từng biến "chưa chọn" thành partition
  // 0, và nếu caller thread giá trị đó tiếp, producer 'sticky' dính cứng vào
  // partition 0 mà chưa hề gọi rng — hot partition giả.
  it('sticky: record có key không thiết lập sticky partition khi chưa có sticky nào', () => {
    const result = pickPartition({ key: 'user-1', partitionCount: 4, partitioner: 'sticky', roundRobinCounter: 0, rng })
    expect(result.nextSticky).toBeUndefined()
  })

  it('sticky: thread nextSticky=undefined tiếp thì lần null-key sau vẫn phải pick thật (rng chạy)', () => {
    const keyed = pickPartition({ key: 'user-1', partitionCount: 4, partitioner: 'sticky', roundRobinCounter: 0, rng })
    expect(keyed.nextSticky).toBeUndefined()

    const nullKeyed = pickPartition({
      key: null, partitionCount: 4, partitioner: 'sticky', roundRobinCounter: 0,
      stickyPartition: keyed.nextSticky, rng: keyed.rng,
    })
    // rng phải thực sự tiến lên — nếu nhánh pick trả `rng: rng` (bug) thay vì
    // `rng: nextRng`, state sẽ y hệt state đầu vào và assertion này thất bại.
    expect(nullKeyed.rng).not.toEqual(keyed.rng)
    expect(nullKeyed.nextSticky).toBe(nullKeyed.partition)
  })

  // rng threading trên nhánh fresh-sticky-pick: test sticky-retention ở trên đi
  // qua nhánh early-return (stickyPartition đã có) nên không đọc/ghi rng — một
  // bug trả `rng: rng` thay vì `rng: nextRng` ở nhánh pick sẽ lọt qua nó. Test
  // này buộc phải chạm nhánh pick thật và quan sát rng đổi + kết quả pick đổi.
  it('sticky: fresh pick (chưa có sticky) phải tiến rng, không đứng yên mãi mãi', () => {
    let current = rng
    const partitions: number[] = []
    for (let i = 0; i < 8; i++) {
      const inputRng = current
      const result = pickPartition({
        key: null, partitionCount: 4, partitioner: 'sticky', roundRobinCounter: 0,
        stickyPartition: undefined, rng: current,
      })
      // rng đầu ra không được trùng rng đầu vào của chính lần gọi này —
      // bắt lỗi `rng: rng` (state đứng yên) ngay ở lần gọi đầu tiên.
      expect(result.rng).not.toEqual(inputRng)
      partitions.push(result.partition)
      current = result.rng
    }
    // Với rng đứng yên, mỗi lần pick sẽ ra đúng một partition lặp lại mãi.
    // rng tiến thật thì qua 8 lần pick trên 4 partition, phải xuất hiện ít nhất
    // hai giá trị khác nhau — đây là assertion mà `rng: rng` genuinely fail.
    expect(new Set(partitions).size).toBeGreaterThan(1)
  })
})
