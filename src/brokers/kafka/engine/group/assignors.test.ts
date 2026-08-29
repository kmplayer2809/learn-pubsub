import { describe, expect, it } from 'vitest'
import { assign, revocationsFor } from './assignors'
import type { GroupMember, TopicPartition } from '../types'

const member = (id: string, subscriptions: string[], assignment: TopicPartition[] = []): GroupMember => ({
  memberId: id, subscriptions, assignment, lastHeartbeatAt: 0, lastPollAt: 0,
})

const partitions = (topic: string, count: number): TopicPartition[] =>
  Array.from({ length: count }, (_, index) => ({ topic, partition: index }))

describe('assign', () => {
  it('range: chia liên tiếp theo topic, member đầu ôm phần dư', () => {
    const result = assign('range', [member('c1', ['t']), member('c2', ['t'])], partitions('t', 5))
    expect(result.c1?.map((p) => p.partition)).toEqual([0, 1, 2])
    expect(result.c2?.map((p) => p.partition)).toEqual([3, 4])
  })

  it('range lệch tải khi số partition không chia hết — đó là nhược điểm bài 13 dạy', () => {
    const result = assign('range', [member('c1', ['t']), member('c2', ['t']), member('c3', ['t'])], partitions('t', 4))
    expect(result.c1).toHaveLength(2)
    expect(result.c2).toHaveLength(1)
    expect(result.c3).toHaveLength(1)
  })

  it('round-robin: rải xen kẽ, cân hơn range trên cùng đầu vào', () => {
    const result = assign('round-robin', [member('c1', ['t']), member('c2', ['t'])], partitions('t', 5))
    expect(result.c1?.map((p) => p.partition)).toEqual([0, 2, 4])
    expect(result.c2?.map((p) => p.partition)).toEqual([1, 3])
  })

  it('round-robin rải qua nhiều topic như một danh sách phẳng', () => {
    const result = assign('round-robin', [member('c1', ['a', 'b']), member('c2', ['a', 'b'])],
      [...partitions('a', 2), ...partitions('b', 2)])
    expect(result.c1).toHaveLength(2)
    expect(result.c2).toHaveLength(2)
  })

  it('sticky: giữ tối đa assignment cũ khi thêm member mới', () => {
    const previous = [member('c1', ['t'], partitions('t', 4))]
    const result = assign('sticky', [...previous, member('c2', ['t'])], partitions('t', 4))
    expect(result.c1).toHaveLength(2)
    expect(result.c2).toHaveLength(2)
    // Hai partition c1 giữ lại phải là partition nó đang có, không phải hai cái bất kỳ.
    for (const tp of result.c1!) expect(previous[0]!.assignment.some((p) => p.partition === tp.partition)).toBe(true)
  })

  it('sticky vẫn cân bằng: chênh lệch giữa member nhiều nhất và ít nhất không quá 1', () => {
    const result = assign('sticky',
      [member('c1', ['t'], partitions('t', 7)), member('c2', ['t']), member('c3', ['t'])], partitions('t', 7))
    const sizes = Object.values(result).map((a) => a.length).sort()
    expect(sizes.at(-1)! - sizes[0]!).toBeLessThanOrEqual(1)
  })

  it('cooperative-sticky cho ra cùng assignment cuối như sticky', () => {
    const members = [member('c1', ['t'], partitions('t', 4)), member('c2', ['t'])]
    expect(assign('cooperative-sticky', members, partitions('t', 4)))
      .toEqual(assign('sticky', members, partitions('t', 4)))
  })

  it('revocationsFor chỉ liệt kê partition thực sự đổi chủ', () => {
    const previous = { c1: partitions('t', 4), c2: [] as TopicPartition[] }
    const next = { c1: partitions('t', 2), c2: [{ topic: 't', partition: 2 }, { topic: 't', partition: 3 }] }
    expect(revocationsFor(previous, next)).toEqual({ c1: [{ topic: 't', partition: 2 }, { topic: 't', partition: 3 }] })
  })

  it('mọi assignor: không partition nào bị giao cho hai member', () => {
    for (const name of ['range', 'round-robin', 'sticky', 'cooperative-sticky'] as const) {
      const result = assign(name, [member('c1', ['t']), member('c2', ['t']), member('c3', ['t'])], partitions('t', 7))
      const all = Object.values(result).flat().map((p) => p.partition)
      expect(new Set(all).size).toBe(all.length)
      expect(all).toHaveLength(7)
    }
  })

  it('member nhiều hơn partition: phần thừa nhận mảng rỗng, không phải undefined', () => {
    const result = assign('range', [member('c1', ['t']), member('c2', ['t'])], partitions('t', 1))
    expect(result.c2).toEqual([])
  })

  it('kết quả không phụ thuộc thứ tự truyền member vào', () => {
    const a = assign('round-robin', [member('c2', ['t']), member('c1', ['t'])], partitions('t', 4))
    const b = assign('round-robin', [member('c1', ['t']), member('c2', ['t'])], partitions('t', 4))
    expect(a).toEqual(b)
  })
})
