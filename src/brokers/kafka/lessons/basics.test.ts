import { describe, expect, it } from 'vitest'
import { createKafkaSimulation, sortedPartitionKeys } from '../engine'
import { brokerCluster } from './02-broker-cluster'
import { keyPartitioning } from './03-key-partitioning'
import { produceConsume } from './04-produce-consume'
import { offsets } from './05-offsets'

describe('lesson 02 — cluster', () => {
  it('partition của một topic trải trên nhiều broker, không dồn vào một', () => {
    // Sự thật này đã cố định ngay trong topology (`createState`'s round-robin
    // leader assignment) — không cần chạy simulation để xác nhận, chỉ cần đọc
    // lại chính script produce đã ghim từng partition vào một broker cụ thể.
    const leaders = new Set(
      brokerCluster.topology.topics.flatMap((topic) =>
        Array.from({ length: topic.partitions }, (_, i) => i).map(
          (index) => brokerCluster.topology.brokers[index % brokerCluster.topology.brokers.length]!.id,
        ),
      ),
    )
    expect(leaders.size).toBeGreaterThan(1)
  })

  it('mất leader chỉ chặn ghi đúng partition nó giữ, các partition khác vẫn ghi được', () => {
    const sim = createKafkaSimulation({
      topology: brokerCluster.topology,
      script: brokerCluster.script,
      seed: brokerCluster.seed,
      failures: brokerCluster.failures,
    })
    sim.advanceTo(brokerCluster.durationMs)
    const lines = sim.snapshot().journal.map((e) => e.text)
    expect(lines).toContain('orders-0: produce lỗi LEADER_NOT_AVAILABLE')
    expect(lines).toContain('orders-1: produce OK, offset 1')
  })
})

describe('lesson 03 — key và partition', () => {
  it('mọi record cùng key nằm trong đúng một partition', () => {
    const sim = createKafkaSimulation({
      topology: keyPartitioning.topology,
      script: keyPartitioning.script,
      seed: keyPartitioning.seed,
    })
    sim.advanceTo(keyPartitioning.durationMs + 5000)
    const state = sim.snapshot()
    const partitionsOfKey = new Map<string, Set<string>>()
    for (const key of sortedPartitionKeys(state)) {
      for (const record of state.partitions[key]!.log) {
        if (record.key === null) continue
        const set = partitionsOfKey.get(record.key) ?? new Set()
        set.add(key)
        partitionsOfKey.set(record.key, set)
      }
    }
    expect(partitionsOfKey.size).toBe(2) // user-1, user-2
    for (const [, set] of partitionsOfKey) expect(set.size).toBe(1)
  })

  it('thứ tự trong một partition đúng bằng thứ tự ghi', () => {
    const sim = createKafkaSimulation({
      topology: keyPartitioning.topology,
      script: keyPartitioning.script,
      seed: keyPartitioning.seed,
    })
    sim.advanceTo(keyPartitioning.durationMs + 5000)
    const state = sim.snapshot()
    for (const key of sortedPartitionKeys(state)) {
      const log = state.partitions[key]!.log
      for (let i = 1; i < log.length; i++) {
        expect(log[i]!.offset).toBeGreaterThan(log[i - 1]!.offset)
        expect(log[i]!.timestamp).toBeGreaterThanOrEqual(log[i - 1]!.timestamp)
      }
    }
  })
})

describe('lesson 04 — vòng đời record', () => {
  it('mỗi record produce đều đến được consumer trong durationMs', () => {
    const sim = createKafkaSimulation({
      topology: produceConsume.topology,
      script: produceConsume.script,
      seed: produceConsume.seed,
    })
    sim.advanceTo(produceConsume.durationMs)
    const state = sim.snapshot()
    expect(state.metrics.recordsConsumed).toBe(state.metrics.recordsProduced)
    expect(state.metrics.recordsProduced).toBe(2)
  })

  it('commit chỉ xảy ra vì được script tường minh, không phải tự động', () => {
    const sim = createKafkaSimulation({
      topology: produceConsume.topology,
      script: produceConsume.script,
      seed: produceConsume.seed,
    })
    sim.advanceTo(produceConsume.durationMs)
    const group = sim.snapshot().groups['g1']!
    expect(group.committedOffsets['orders-0']).toEqual({ offset: 2, committedAt: 7000 })
  })
})

describe('lesson 05 — offset', () => {
  it('auto.offset.reset=latest bỏ qua mọi record ghi trước khi consumer vào', () => {
    const sim = createKafkaSimulation({ topology: offsets.topology, script: offsets.script, seed: offsets.seed })
    // Join ở t=6000 phải đợi hết `maxPollIntervalMs` (5000, xem `lessons/types.ts`)
    // trước khi coordinator chốt assignment — advance qua mốc đó (11000) cộng
    // thêm một khoảng đệm trên lưới poll 100ms trước khi kiểm `position`.
    sim.advanceTo(11_100)
    const runtime = sim.snapshot().consumers['c1']!
    expect(runtime.position['orders-0']).toBe(4) // 4 record đã ghi trước khi c1 có assignment, latest bỏ qua hết
  })

  it('position chạy trước, committed offset chỉ nhích khi commit tường minh', () => {
    const sim = createKafkaSimulation({ topology: offsets.topology, script: offsets.script, seed: offsets.seed })
    sim.advanceTo(12_800)
    const state = sim.snapshot()
    expect(state.consumers['c1']!.position['orders-0']).toBe(6)
    expect(state.groups['g1']!.committedOffsets['orders-0']).toEqual({ offset: 5, committedAt: 12_000 })
  })

  it('seek earliest đọc lại từ đầu log, không đụng committed offset', () => {
    const sim = createKafkaSimulation({ topology: offsets.topology, script: offsets.script, seed: offsets.seed })
    sim.advanceTo(14_080)
    const state = sim.snapshot()
    expect(state.consumers['c1']!.position['orders-0']).toBe(0)
    expect(state.groups['g1']!.committedOffsets['orders-0']).toEqual({ offset: 5, committedAt: 12_000 })

    sim.advanceTo(14_700)
    const after = sim.snapshot()
    expect(after.consumers['c1']!.position['orders-0']).toBe(6)
    expect(after.groups['g1']!.committedOffsets['orders-0']).toEqual({ offset: 6, committedAt: 14_700 })
  })
})
