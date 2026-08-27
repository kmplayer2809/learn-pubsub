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
})
