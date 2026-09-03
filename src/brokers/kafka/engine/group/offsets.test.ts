import { describe, expect, it } from 'vitest'
import { commitOffsets, committedOffset, lagFor, scheduleAutoCommit, totalLag } from './offsets'
import { testState } from '../testState'
import { appendRecord } from '../log'
import type { GroupMember, GroupState, KafkaConsumerSpec, KafkaState, TopicPartition } from '../types'

const GROUP = 'g1'

function member(id: string, assignment: TopicPartition[] = [], overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    memberId: id,
    subscriptions: [...new Set(assignment.map((p) => p.topic))],
    assignment,
    lastHeartbeatAt: 0,
    lastPollAt: 0,
    ...overrides,
  }
}

function group(overrides: Partial<GroupState> = {}): GroupState {
  return {
    groupId: GROUP,
    state: 'Stable',
    generationId: 1,
    leaderMemberId: 'c1',
    assignor: 'range',
    members: [],
    committedOffsets: {},
    coordinatorBrokerId: 'b1',
    ...overrides,
  }
}

function withGroup(state: KafkaState, g: GroupState): KafkaState {
  return { ...state, groups: { ...state.groups, [g.groupId]: g } }
}

/** Append `n` record liên tiếp vào partition `key`, đẩy `highWatermark` lên `n` —
 *  dùng thay vì tự bịa `highWatermark` để fixture đi qua đúng con đường
 *  `appendRecord` thật (`log.ts`), giống dữ liệu một reducer `append` thật sẽ tạo. */
function appendN(state: KafkaState, key: string, n: number, startAt = 0): KafkaState {
  let partition = state.partitions[key]!
  for (let i = 0; i < n; i++) {
    partition = appendRecord(partition, { key: null, value: `v${i}`, timestamp: startAt, bytes: 1 }).partition
  }
  return { ...state, partitions: { ...state.partitions, [key]: partition } }
}

function baseConsumer(overrides: Partial<KafkaConsumerSpec> = {}): KafkaConsumerSpec {
  return {
    id: 'c1',
    label: 'Consumer',
    position: { x: 0, y: 0 },
    groupId: GROUP,
    subscriptions: ['orders'],
    ...overrides,
  }
}

describe('offsets', () => {
  it('commit ghi offset của lần đọc kế tiếp, không phải offset vừa đọc', () => {
    // 3 record ở offset 0,1,2 đã được xử lý xong — offset SẼ ĐỌC TIẾP là 3, không
    // phải 2 (offset của chính record cuối cùng vừa xử lý). Nhầm sang 2 là lỗi
    // phổ biến nhất khi tự quản lý offset thủ công: khởi động lại sẽ đọc lại đúng
    // record cuối.
    let state = testState({ topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }] })
    state = appendN(state, 'orders-0', 3)
    state = withGroup(state, group({ members: [member('c1', [{ topic: 'orders', partition: 0 }])] }))

    const next = commitOffsets(state, { groupId: GROUP, memberId: 'c1', offsets: { 'orders-0': 3 }, at: 100 })

    expect(committedOffset(next.groups[GROUP]!, 'orders-0')).toBe(3)
    expect(committedOffset(next.groups[GROUP]!, 'orders-0')).not.toBe(2)
  })

  it('chưa commit lần nào thì committedOffset là undefined, không phải 0', () => {
    const g = group()
    expect(committedOffset(g, 'orders-0')).toBeUndefined()
    expect(committedOffset(g, 'orders-0')).not.toBe(0)
  })

  it('lag = high watermark trừ committed offset', () => {
    let state = testState({ topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }] })
    state = appendN(state, 'orders-0', 10)
    state = withGroup(
      state,
      group({
        members: [member('c1', [{ topic: 'orders', partition: 0 }])],
        committedOffsets: { 'orders-0': { offset: 4, committedAt: 0 } },
      }),
    )

    expect(lagFor(state, GROUP, 'orders-0')).toBe(6)
  })

  it('lag của partition chưa commit tính từ vị trí auto.offset.reset sẽ chọn', () => {
    // `auto.offset.reset` mặc định Kafka thật là `'latest'` — một consumer chưa
    // từng commit thì lần poll đầu tiên bắt đầu từ chính high watermark, không
    // phải từ đầu log. Lag phải phản ánh đúng điều đó: KHÔNG phóng đại thành
    // `highWatermark - 0`.
    let state = testState({ topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }] })
    state = appendN(state, 'orders-0', 5)
    state = withGroup(state, group({ members: [member('c1', [{ topic: 'orders', partition: 0 }])] }))

    expect(lagFor(state, GROUP, 'orders-0')).toBe(0)
    expect(lagFor(state, GROUP, 'orders-0')).not.toBe(5)
  })

  it('totalLag cộng lag của mọi partition group đang giữ', () => {
    let state = testState({
      topics: [{ name: 'orders', partitions: 2, replicationFactor: 1 }, { name: 'other', partitions: 1, replicationFactor: 1 }],
    })
    state = appendN(state, 'orders-0', 10) // committed 4 -> lag 6
    state = appendN(state, 'orders-1', 8) // committed 2 -> lag 6
    state = appendN(state, 'other-0', 100) // KHÔNG được assign cho group này -> không tính
    state = withGroup(
      state,
      group({
        members: [
          member('c1', [{ topic: 'orders', partition: 0 }]),
          member('c2', [{ topic: 'orders', partition: 1 }]),
        ],
        committedOffsets: {
          'orders-0': { offset: 4, committedAt: 0 },
          'orders-1': { offset: 2, committedAt: 0 },
        },
      }),
    )

    expect(totalLag(state, GROUP)).toBe(12)
  })

  it('auto-commit hẹn đúng theo autoCommitIntervalMs', () => {
    const state = testState()
    const consumer = baseConsumer({ enableAutoCommit: true, autoCommitIntervalMs: 7000 })

    const events = scheduleAutoCommit(state, consumer, 1000)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ at: 8000, type: 'commit', payload: { consumerId: 'c1' } })
  })

  it('enableAutoCommit=false thì không sinh event auto-commit nào', () => {
    const state = testState()
    const consumer = baseConsumer({ enableAutoCommit: false, autoCommitIntervalMs: 7000 })

    const events = scheduleAutoCommit(state, consumer, 1000)

    expect(events).toHaveLength(0)
  })

  it('commit của member không thuộc group bị bỏ qua, không tạo group ma', () => {
    const state = testState({ topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }] })

    // Group chưa từng tồn tại — commit vào nó không được tạo ra một group mới.
    const afterGhostGroup = commitOffsets(state, { groupId: 'ghost', memberId: 'c1', offsets: { 'orders-0': 3 }, at: 0 })
    expect(afterGhostGroup.groups['ghost']).toBeUndefined()

    // Group tồn tại nhưng member không thuộc nó — offset không được ghi.
    const withExistingGroup = withGroup(state, group({ members: [member('c1', [{ topic: 'orders', partition: 0 }])] }))
    const afterUnknownMember = commitOffsets(withExistingGroup, {
      groupId: GROUP,
      memberId: 'intruder',
      offsets: { 'orders-0': 3 },
      at: 0,
    })
    expect(committedOffset(afterUnknownMember.groups[GROUP]!, 'orders-0')).toBeUndefined()
  })

  it('metrics.commits chỉ tăng khi commit thực sự ghi được', () => {
    let state = testState({ topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }] })
    state = withGroup(state, group({ members: [member('c1', [{ topic: 'orders', partition: 0 }])] }))

    const rejected = commitOffsets(state, { groupId: GROUP, memberId: 'intruder', offsets: { 'orders-0': 3 }, at: 0 })
    expect(rejected.metrics.commits).toBe(0)

    const accepted = commitOffsets(state, { groupId: GROUP, memberId: 'c1', offsets: { 'orders-0': 3 }, at: 0 })
    expect(accepted.metrics.commits).toBe(1)
  })

  it('metrics.lagTotal cập nhật sau mỗi lần commit và mỗi lần append', () => {
    let state = testState({ topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }] })
    state = appendN(state, 'orders-0', 5) // highWatermark 5
    state = withGroup(state, group({ members: [member('c1', [{ topic: 'orders', partition: 0 }])] }))

    const afterFirstCommit = commitOffsets(state, { groupId: GROUP, memberId: 'c1', offsets: { 'orders-0': 2 }, at: 0 })
    expect(afterFirstCommit.metrics.lagTotal).toBe(3) // 5 - 2

    // Append thêm 3 record nữa — highWatermark 5 -> 8 — TRƯỚC khi commit tiếp.
    const afterAppend = appendN(afterFirstCommit, 'orders-0', 3)
    const afterSecondCommit = commitOffsets(afterAppend, { groupId: GROUP, memberId: 'c1', offsets: { 'orders-0': 2 }, at: 10 })

    // lagTotal phải phản ánh đúng highWatermark MỚI, không phải giá trị cũ đã
    // tính lần commit trước — chứng minh nó được TÍNH LẠI, không phải cache.
    expect(afterSecondCommit.metrics.lagTotal).toBe(6) // 8 - 2
  })
})
