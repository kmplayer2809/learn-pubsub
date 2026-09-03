import { describe, expect, it } from 'vitest'
import { checkTimeouts, completeRebalance, heartbeat, joinGroup, leaveGroup, syncGroup, type JoinGroupArgs } from './coordinator'
import { testState } from '../testState'
import type { GroupMember, GroupState, KafkaState, TopicPartition } from '../types'

const GROUP = 'g1'

/** Trạng thái nền: một topic `t` (mặc định 4 partition, 1 replica) — đủ nhiều
 *  partition để một assignor thật sự chia ra kết quả có ý nghĩa. */
function baseState(topicPartitions = 4): KafkaState {
  return testState({ topics: [{ name: 't', partitions: topicPartitions, replicationFactor: 1 }] })
}

function join(state: KafkaState, memberId: string, at: number, overrides: Partial<JoinGroupArgs> = {}) {
  return joinGroup(state, {
    groupId: GROUP,
    memberId,
    subscriptions: ['t'],
    assignor: 'range',
    at,
    ...overrides,
  })
}

function member(id: string, overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    memberId: id,
    subscriptions: ['t'],
    assignment: [],
    lastHeartbeatAt: 0,
    lastPollAt: 0,
    ...overrides,
  }
}

function stableGroup(overrides: Partial<GroupState> = {}): GroupState {
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

function withGroup(state: KafkaState, group: GroupState): KafkaState {
  return { ...state, groups: { ...state.groups, [group.groupId]: group } }
}

function assignmentOf(group: GroupState, id: string): string[] | undefined {
  return group.members
    .find((m) => m.memberId === id)
    ?.assignment.map((p) => `${p.topic}-${p.partition}`)
    .sort()
}

describe('coordinator', () => {
  it('member đầu tiên join đưa group từ Empty sang PreparingRebalance', () => {
    const state = baseState()
    expect(state.groups[GROUP]).toBeUndefined() // group chưa tồn tại — coi như Empty
    const { state: next } = join(state, 'c1', 0)
    expect(next.groups[GROUP]?.state).toBe('PreparingRebalance')
  })

  it('member đầu tiên join thành leader của group', () => {
    const state = baseState()
    const { state: next } = join(state, 'c1', 0)
    expect(next.groups[GROUP]?.leaderMemberId).toBe('c1')
  })

  it('group chỉ sang CompletingRebalance sau khi hết rebalanceTimeoutMs, không sang ngay khi có member', () => {
    // Đây là lý do rebalance "chậm": coordinator cố ý chờ gom đủ member.
    const state = baseState()
    const first = join(state, 'c1', 0, { rebalanceTimeoutMs: 5000 })
    expect(first.newEvents).toHaveLength(1)
    expect(first.newEvents[0]).toMatchObject({ type: 'rebalance-complete', at: 5000 })
    expect(first.state.groups[GROUP]?.state).toBe('PreparingRebalance')

    const second = join(first.state, 'c2', 1000, { rebalanceTimeoutMs: 5000 })
    // member thứ hai join giữa cửa sổ — không hẹn thêm event, không nhảy state
    expect(second.newEvents).toHaveLength(0)
    expect(second.state.groups[GROUP]?.state).toBe('PreparingRebalance')

    // chỉ khi xử lý đúng event rebalance-complete đã hẹn thì mới sang CompletingRebalance
    const completed = completeRebalance(second.state, { groupId: GROUP, generationId: 1, at: 5000 })
    expect(completed.state.groups[GROUP]?.state).toBe('CompletingRebalance')
  })

  it('sync xong thì group Stable và mọi member có assignment', () => {
    let state = baseState()
    ;({ state } = join(state, 'c1', 0, { rebalanceTimeoutMs: 1000 }))
    ;({ state } = join(state, 'c2', 100, { rebalanceTimeoutMs: 1000 }))
    const completed = completeRebalance(state, { groupId: GROUP, generationId: 1, at: 1000 })
    const synced = syncGroup(completed.state, { groupId: GROUP, generationId: 1, at: 1000 })
    const group = synced.state.groups[GROUP]!
    expect(group.state).toBe('Stable')
    for (const m of group.members) expect(m.assignment.length).toBeGreaterThan(0)
  })

  it('generationId tăng đúng một lần cho mỗi vòng rebalance', () => {
    let state = baseState()
    ;({ state } = join(state, 'c1', 0, { rebalanceTimeoutMs: 1000 }))
    let completed = completeRebalance(state, { groupId: GROUP, generationId: 1, at: 1000 })
    let synced = syncGroup(completed.state, { groupId: GROUP, generationId: 1, at: 1000 })
    expect(synced.state.groups[GROUP]?.generationId).toBe(1)
    expect(synced.state.groups[GROUP]?.state).toBe('Stable')

    // vòng thứ hai: một member mới join từ Stable
    const secondJoin = join(synced.state, 'c2', 2000, { rebalanceTimeoutMs: 1000 })
    expect(secondJoin.state.groups[GROUP]?.generationId).toBe(2) // tăng đúng một lần (1 → 2)
    completed = completeRebalance(secondJoin.state, { groupId: GROUP, generationId: 2, at: 3000 })
    synced = syncGroup(completed.state, { groupId: GROUP, generationId: 2, at: 3000 })
    expect(synced.state.groups[GROUP]?.generationId).toBe(2) // completeRebalance/syncGroup (eager) không tăng thêm
  })

  it('heartbeat mang generation cũ bị từ chối, member đó phải join lại', () => {
    const state = withGroup(baseState(), stableGroup({ generationId: 2, members: [member('c1', { lastHeartbeatAt: 0 })] }))
    const result = heartbeat(state, { groupId: GROUP, memberId: 'c1', generationId: 1, at: 500 })
    expect(result.error).toBe('ILLEGAL_GENERATION')
    // không cập nhật lastHeartbeatAt — member coi như chưa gửi heartbeat hợp lệ, phải tự gọi lại joinGroup
    expect(result.state.groups[GROUP]?.members.find((m) => m.memberId === 'c1')?.lastHeartbeatAt).toBe(0)
  })

  it('member im lặng quá sessionTimeoutMs bị đá và group rebalance', () => {
    const state = withGroup(
      baseState(),
      stableGroup({
        members: [
          member('c1', { lastHeartbeatAt: 0, lastPollAt: 0, sessionTimeoutMs: 1000, maxPollIntervalMs: 300_000 }),
          member('c2', { lastHeartbeatAt: 5000, lastPollAt: 5000, sessionTimeoutMs: 1000, maxPollIntervalMs: 300_000 }),
        ],
      }),
    )
    const result = checkTimeouts(state, 5000) // c1 im lặng 5000ms > sessionTimeoutMs 1000ms
    const group = result.state.groups[GROUP]!
    expect(group.members.map((m) => m.memberId)).toEqual(['c2'])
    expect(group.state).toBe('PreparingRebalance')
    expect(group.generationId).toBe(2)
    expect(result.newEvents).toHaveLength(1)
    expect(result.newEvents[0]?.type).toBe('rebalance-complete')
  })

  it('member không poll quá maxPollIntervalMs bị đá, dù heartbeat vẫn đều', () => {
    // Heartbeat chạy ở thread riêng của client thật, nên nó vẫn đều trong khi
    // vòng xử lý đã treo — đó chính là bẫy lesson 16 dạy.
    const state = withGroup(
      baseState(),
      stableGroup({
        members: [
          member('c1', { lastHeartbeatAt: 4900, lastPollAt: 0, sessionTimeoutMs: 10_000, maxPollIntervalMs: 1000 }),
          member('c2', { lastHeartbeatAt: 4900, lastPollAt: 4900, sessionTimeoutMs: 10_000, maxPollIntervalMs: 1000 }),
        ],
      }),
    )
    // c1: heartbeat mới 100ms trước (không vi phạm sessionTimeoutMs), nhưng
    // lastPollAt vẫn ở 0 — vòng xử lý treo 5000ms > maxPollIntervalMs 1000ms.
    const result = checkTimeouts(state, 5000)
    const group = result.state.groups[GROUP]!
    expect(group.members.map((m) => m.memberId)).toEqual(['c2'])
  })

  it('member rời group chủ động kích hoạt rebalance ngay, không chờ session timeout', () => {
    const state = withGroup(
      baseState(),
      stableGroup({ members: [member('c1', { maxPollIntervalMs: 2000 }), member('c2', { maxPollIntervalMs: 2000 })] }),
    )
    const result = leaveGroup(state, { groupId: GROUP, memberId: 'c1', at: 100 })
    const group = result.state.groups[GROUP]!
    expect(group.state).toBe('PreparingRebalance')
    expect(group.members.map((m) => m.memberId)).toEqual(['c2'])
    expect(result.newEvents).toHaveLength(1)
    expect(result.newEvents[0]).toMatchObject({ type: 'rebalance-complete', at: 100 + 2000 })
  })

  it('rebalanceTimeoutMs mặc định lấy theo maxPollIntervalMs khi không khai báo', () => {
    const state = baseState()
    const { newEvents } = join(state, 'c1', 0, { maxPollIntervalMs: 45_000 })
    expect(newEvents[0]).toMatchObject({ type: 'rebalance-complete', at: 45_000 })
  })

  it('eager rebalance: mọi member mất hết assignment trong lúc rebalance', () => {
    // `assignor` không phải cooperative — group dừng toàn bộ.
    const state = withGroup(
      baseState(),
      stableGroup({
        assignor: 'range',
        members: [
          member('c1', {
            assignment: [
              { topic: 't', partition: 0 },
              { topic: 't', partition: 1 },
            ],
          }),
          member('c2', {
            assignment: [
              { topic: 't', partition: 2 },
              { topic: 't', partition: 3 },
            ],
          }),
        ],
      }),
    )
    const result = join(state, 'c3', 100, { assignor: 'range' })
    const group = result.state.groups[GROUP]!
    expect(group.state).toBe('PreparingRebalance')
    for (const m of group.members) expect(m.assignment).toEqual([])
  })

  it('cooperative-sticky: partition không bị thu hồi vẫn giữ nguyên assignment suốt hai vòng', () => {
    const owned: TopicPartition[] = [0, 1, 2, 3].map((partition) => ({ topic: 't', partition }))
    const state = withGroup(baseState(), stableGroup({ assignor: 'cooperative-sticky', members: [member('c1', { assignment: owned })] }))

    const joined = join(state, 'c2', 100, { assignor: 'cooperative-sticky', rebalanceTimeoutMs: 1000 })
    const gen = joined.state.groups[GROUP]!.generationId
    const completed = completeRebalance(joined.state, { groupId: GROUP, generationId: gen, at: 1100 })

    // Vòng một chỉ thu hồi phần đổi chủ — c1 chỉ mất 2/4 partition (quota), 2 partition còn lại nguyên vẹn.
    const c1AfterRound1 = completed.state.groups[GROUP]!.members.find((m) => m.memberId === 'c1')!
    expect(c1AfterRound1.assignment.some((p) => p.partition === 0)).toBe(true)
    expect(c1AfterRound1.assignment.some((p) => p.partition === 1)).toBe(true)

    const synced = syncGroup(completed.state, { groupId: GROUP, generationId: gen, at: 1100 })
    const c1Final = synced.state.groups[GROUP]!.members.find((m) => m.memberId === 'c1')!
    // Sau vòng hai (cấp phát), hai partition chưa từng bị thu hồi vẫn còn nguyên ở c1.
    expect(c1Final.assignment.some((p) => p.partition === 0)).toBe(true)
    expect(c1Final.assignment.some((p) => p.partition === 1)).toBe(true)
  })

  it('cooperative-sticky rebalance hai vòng, generationId tăng hai lần', () => {
    const owned: TopicPartition[] = [0, 1, 2, 3].map((partition) => ({ topic: 't', partition }))
    const state = withGroup(
      baseState(),
      stableGroup({ assignor: 'cooperative-sticky', generationId: 5, members: [member('c1', { assignment: owned })] }),
    )
    const joined = join(state, 'c2', 100, { assignor: 'cooperative-sticky', rebalanceTimeoutMs: 1000 })
    expect(joined.state.groups[GROUP]?.generationId).toBe(6) // vòng thu hồi — tăng lần một

    const completed = completeRebalance(joined.state, { groupId: GROUP, generationId: 6, at: 1100 })
    expect(completed.state.groups[GROUP]?.generationId).toBe(6) // completeRebalance không tự tăng gen
    expect(completed.state.groups[GROUP]?.state).toBe('CompletingRebalance')

    const synced = syncGroup(completed.state, { groupId: GROUP, generationId: 6, at: 1100 })
    expect(synced.state.groups[GROUP]?.generationId).toBe(7) // vòng cấp phát — tăng lần hai
    expect(synced.state.groups[GROUP]?.state).toBe('Stable')
    // Dù generationId tăng hai lần, group chỉ thật sự về Stable đúng MỘT lần
    // (cooperative gộp cả hai vòng vào một lần gọi `syncGroup`) — metrics chỉ đếm một vòng.
    expect(synced.state.metrics.rebalances).toBe(state.metrics.rebalances + 1)
  })

  it('metrics.rebalances đếm đúng số vòng rebalance đã hoàn tất', () => {
    let state = baseState()
    expect(state.metrics.rebalances).toBe(0)

    ;({ state } = join(state, 'c1', 0, { rebalanceTimeoutMs: 1000 }))
    expect(state.groups[GROUP]?.state).toBe('PreparingRebalance') // chưa hoàn tất — chưa đếm
    ;({ state } = completeRebalance(state, { groupId: GROUP, generationId: 1, at: 1000 }))
    expect(state.metrics.rebalances).toBe(0) // vẫn chưa — mới CompletingRebalance
    ;({ state } = syncGroup(state, { groupId: GROUP, generationId: 1, at: 1000 }))
    expect(state.metrics.rebalances).toBe(1)

    ;({ state } = join(state, 'c2', 2000, { rebalanceTimeoutMs: 1000 }))
    ;({ state } = completeRebalance(state, { groupId: GROUP, generationId: 2, at: 3000 }))
    ;({ state } = syncGroup(state, { groupId: GROUP, generationId: 2, at: 3000 }))
    expect(state.metrics.rebalances).toBe(2)
  })

  it('member join theo thứ tự lộn xộn vẫn cho cùng assignment — coordinator sort trước khi assign', () => {
    const runFlow = (order: string[]): GroupState => {
      let state = baseState()
      order.forEach((id, i) => {
        ;({ state } = join(state, id, i * 10, { rebalanceTimeoutMs: 1000 }))
      })
      ;({ state } = completeRebalance(state, { groupId: GROUP, generationId: 1, at: 1000 }))
      ;({ state } = syncGroup(state, { groupId: GROUP, generationId: 1, at: 1000 }))
      return state.groups[GROUP]!
    }

    const inOrder = runFlow(['c1', 'c2', 'c3'])
    const outOfOrder = runFlow(['c3', 'c1', 'c2'])

    for (const id of ['c1', 'c2', 'c3']) {
      expect(assignmentOf(inOrder, id)).toEqual(assignmentOf(outOfOrder, id))
    }
  })
})
