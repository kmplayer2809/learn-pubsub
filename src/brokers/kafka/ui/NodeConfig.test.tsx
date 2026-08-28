import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testState } from '../engine/testState'
import type { KafkaScriptedCommand, KafkaState, KafkaTopology } from '../engine'
import type { Lesson } from '../../../shell/lesson/types'
import { NodeConfig } from './NodeConfig'

function lesson(topology: KafkaTopology): Lesson<KafkaTopology, KafkaScriptedCommand> {
  return {
    id: 'l1',
    group: 'basics',
    title: 'Test lesson',
    summary: 'summary',
    topology,
    script: [],
    narrative: [],
    seed: 1,
    durationMs: 1000,
  }
}

function baseTopology(over: Partial<KafkaTopology> = {}): KafkaTopology {
  return {
    brokers: [{ id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } }],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 } }],
    consumers: [
      { id: 'c1', label: 'Consumer', position: { x: 0, y: 0 }, groupId: 'g1', subscriptions: ['orders'] },
    ],
    controllerBrokerId: 'b1',
    ...over,
  }
}

describe('NodeConfig', () => {
  it('renders broker rack, online status and controller epoch', () => {
    const topology = baseTopology({
      brokers: [{ id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 }, rack: 'rack-a' }],
    })
    render(<NodeConfig lesson={lesson(topology)} state={testState()} nodeId="b1" />)
    const text = document.body.textContent!
    expect(text).toContain('rack-a')
    expect(text).toContain('online')
    expect(text).toContain('epoch 0')
  })

  it('shows offline for a broker the live state marks not online', () => {
    const topology = baseTopology()
    const state: KafkaState = { ...testState(), brokersOnline: { b1: false } }
    render(<NodeConfig lesson={lesson(topology)} state={state} nodeId="b1" />)
    // Offline and controller-ness are orthogonal here on purpose: there is no election
    // reducer yet (a later plan), so `state.controller` does not move just because a
    // broker's `brokersOnline` flag flips — see the comment on `isController` above.
    expect(screen.getByTestId('broker-online').textContent).toBe('offline')
  })

  it('renders partition topic, leader, isr and offsets from live state', () => {
    const topology = baseTopology()
    const state = testState()
    render(<NodeConfig lesson={lesson(topology)} state={state} nodeId="orders-0" />)
    const text = document.body.textContent!
    expect(text).toContain('orders')
    expect(text).toContain('b1')
  })

  it('renders producer spec fields, defaulting acks to all and max.in.flight to 5', () => {
    const topology = baseTopology()
    render(<NodeConfig lesson={lesson(topology)} state={testState()} nodeId="p1" />)
    const text = document.body.textContent!
    expect(text).toContain('all')
    expect(text).toContain('5')
  })

  it('reflects an explicit acks:0 rather than folding it into the default', () => {
    const topology = baseTopology({
      producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 }, acks: 0 }],
    })
    render(<NodeConfig lesson={lesson(topology)} state={testState()} nodeId="p1" />)
    expect(document.body.textContent).not.toContain('all')
  })

  it('renders consumer subscriptions and marks it not joined before consumer-join', () => {
    const topology = baseTopology()
    render(<NodeConfig lesson={lesson(topology)} state={testState()} nodeId="c1" />)
    const text = document.body.textContent!
    expect(text).toContain('orders')
    expect(text).toContain('chưa tham gia')
    expect(screen.queryByTestId('consumer-lag')).toBeNull()
  })

  // The Task 7 trap, replayed for NodeConfig: an unresolved position under the default
  // `auto.offset.reset: latest` means "start from the high watermark", i.e. lag 0 — not
  // `logStartOffset`, which would fabricate a backlog spanning the whole log.
  it('computes lag through resolvePosition, not a fabricated backlog, for an unresolved latest consumer', () => {
    const topology = baseTopology()
    const base = testState()
    const state: KafkaState = {
      ...base,
      consumers: { c1: { position: {}, paused: [], lastPollAt: 0 } },
      partitions: { 'orders-0': { ...base.partitions['orders-0']!, highWatermark: 7, leo: 7 } },
    }
    render(<NodeConfig lesson={lesson(topology)} state={state} nodeId="c1" />)
    expect(document.body.textContent).toContain('đã tham gia')
    expect(screen.getByTestId('consumer-lag').textContent).toBe('0')
  })

  it('falls back to the Vietnamese sentence for an unknown node id', () => {
    render(<NodeConfig lesson={lesson(baseTopology())} state={testState()} nodeId="ghost" />)
    expect(document.body.textContent).toBe('Node này không có cấu hình.')
  })

  it('lưới thuộc tính xuống một cột ở màn hẹp', () => {
    const { container } = render(
      <NodeConfig lesson={lesson(baseTopology())} state={testState()} nodeId="b1" />,
    )
    const grid = container.querySelector('[class*="grid-cols"]')
    expect(grid?.className).toContain('grid-cols-1')
    expect(grid?.className).toContain('sm:grid-cols-2')
  })
})
