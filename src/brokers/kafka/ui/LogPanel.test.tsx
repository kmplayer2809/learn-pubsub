import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testState } from '../engine/testState'
import type { GroupState, KafkaState } from '../engine'
import { LogPanel } from './LogPanel'

describe('LogPanel', () => {
  it('hiện mọi partition kèm offset, đánh dấu HW và LEO', () => {
    const base = testState()
    const partition = base.partitions['orders-0']!
    const state: KafkaState = {
      ...base,
      partitions: {
        'orders-0': {
          ...partition,
          log: [
            { offset: 0, key: 'a', value: 'v0', timestamp: 0, bytes: 10 },
            { offset: 1, key: 'b', value: 'v1', timestamp: 1, bytes: 10 },
            // offset 2 sits at/after the high watermark: written on the leader, not
            // yet confirmed across the ISR — a consumer cannot read it yet.
            { offset: 2, key: 'c', value: 'v2', timestamp: 2, bytes: 10 },
          ],
          logStartOffset: 0,
          highWatermark: 2,
          leo: 3,
        },
      },
    }
    render(<LogPanel state={state} />)

    const block = screen.getByTestId('partition-block')
    expect(block.textContent).toContain('2') // high watermark
    expect(block.textContent).toContain('3') // LEO

    const rows = within(block).getAllByTestId('log-entry')
    expect(rows.map((r) => r.getAttribute('data-offset'))).toEqual(['0', '1', '2'])
    // The two committed records read normally; the one at/after HW is marked distinctly.
    expect(rows[0]?.getAttribute('data-uncommitted')).toBeNull()
    expect(rows[1]?.getAttribute('data-uncommitted')).toBeNull()
    expect(rows[2]?.getAttribute('data-uncommitted')).toBe('true')
  })

  it('record dưới logStartOffset hiện mờ — đã bị retention xoá', () => {
    const base = testState()
    const partition = base.partitions['orders-0']!
    const state: KafkaState = {
      ...base,
      partitions: {
        'orders-0': {
          ...partition,
          // Retention thật sẽ xoá hẳn record này khỏi `log` (xem `segments.ts`
          // `applyRetention`) — dựng trực tiếp state ở đây để kiểm tra panel tự vệ
          // đúng cách nếu vẫn gặp một record dưới `logStartOffset`.
          log: [
            { offset: 1, key: 'gone', value: 'old', timestamp: 0, bytes: 10 },
            { offset: 3, key: 'kept', value: 'new', timestamp: 5, bytes: 10 },
          ],
          logStartOffset: 3,
          highWatermark: 4,
          leo: 4,
        },
      },
    }
    render(<LogPanel state={state} />)

    const rows = screen.getAllByTestId('log-entry')
    const reclaimed = rows.find((r) => r.getAttribute('data-offset') === '1')!
    const kept = rows.find((r) => r.getAttribute('data-offset') === '3')!

    expect(reclaimed.getAttribute('data-reclaimed')).toBe('true')
    expect(reclaimed.className).toContain('opacity-40')
    expect(reclaimed.textContent).toContain('retention xoá')

    expect(kept.getAttribute('data-reclaimed')).toBeNull()
    expect(kept.className).not.toContain('opacity-40')
  })

  it('dense siết chiều cao lại cho màn hình nhỏ', () => {
    const state = testState()
    const { rerender } = render(<LogPanel state={state} />)
    expect(screen.getByTestId('log-panel').className).toContain('max-h-32')

    rerender(<LogPanel state={state} dense />)
    expect(screen.getByTestId('log-panel').className).toContain('max-h-24')
    expect(screen.getByTestId('log-panel').className).not.toContain('max-h-32')
  })

  it('tab Group liệt kê member, assignment và lag', () => {
    const base = testState()
    const partition = base.partitions['orders-0']!
    const group: GroupState = {
      groupId: 'g1',
      state: 'Stable',
      generationId: 2,
      leaderMemberId: 'c1',
      assignor: 'range',
      members: [
        { memberId: 'c1', subscriptions: ['orders'], assignment: [], lastHeartbeatAt: 100, lastPollAt: 100 },
        { memberId: 'c2', subscriptions: ['orders'], assignment: [], lastHeartbeatAt: 120, lastPollAt: 120 },
      ],
      // c1 has committed offset 3 on a partition whose high watermark is 10 — a real,
      // non-fabricated lag of 7, computed straight from state rather than guessed.
      committedOffsets: { 'orders-0': { offset: 3, committedAt: 100 } },
      coordinatorBrokerId: 'b1',
    }
    const state: KafkaState = {
      ...base,
      partitions: { 'orders-0': { ...partition, highWatermark: 10, leo: 10 } },
      groups: { g1: group },
    }
    render(<LogPanel state={state} />)

    fireEvent.click(screen.getByTestId('log-panel-tab-group'))

    const members = screen.getAllByTestId('group-member')
    expect(members).toHaveLength(2)
    expect(members[0]?.textContent).toContain('c1')
    expect(members[1]?.textContent).toContain('c2')
    // Assignment is a named placeholder, not a silently empty list — the engine
    // does not populate `GroupMember.assignment` yet (group coordinator is a later
    // plan), and an unlabelled blank reads as a bug rather than a known gap.
    const assignments = screen.getAllByTestId('member-assignment')
    expect(assignments).toHaveLength(2)
    for (const a of assignments) expect(a.textContent).toBe('chưa gán')

    const lagRow = screen.getByTestId('group-lag-row')
    expect(lagRow.textContent).toContain('orders-0')
    expect(lagRow.textContent).toContain('7')
    // Qualified label, on purpose: this is committed-offset lag, a different metric from
    // the fetch-position lag the canvas ConsumerNode and NodeConfig.tsx render under the
    // bare word "lag" — pinned so the two can't quietly collapse back to the same label.
    expect(lagRow.textContent).toContain('lag đã commit')
  })

  it('says so rather than a fabricated zero when a group has not committed any offset', () => {
    const base = testState()
    const group: GroupState = {
      groupId: 'g1',
      state: 'Stable',
      generationId: 1,
      leaderMemberId: 'c1',
      assignor: 'range',
      members: [{ memberId: 'c1', subscriptions: ['orders'], assignment: [], lastHeartbeatAt: 0, lastPollAt: 0 }],
      committedOffsets: {},
      coordinatorBrokerId: 'b1',
    }
    const state: KafkaState = { ...base, groups: { g1: group } }
    render(<LogPanel state={state} />)
    fireEvent.click(screen.getByTestId('log-panel-tab-group'))
    expect(screen.queryByTestId('group-lag-row')).toBeNull()
    expect(screen.getByTestId('group-lag-empty')).toBeTruthy()
  })

  it('lưới thuộc tính xuống một cột ở màn hẹp', () => {
    const { container } = render(<LogPanel state={testState()} />)
    const grid = container.querySelector('[class*="grid-cols"]')
    expect(grid?.className).toContain('grid-cols-1')
    expect(grid?.className).toContain('sm:grid-cols-2')
  })
})
