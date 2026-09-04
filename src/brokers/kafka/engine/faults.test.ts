import { describe, expect, it } from 'vitest'
import { createKafkaSimulation } from './index'
import type { KafkaTopology } from './index'

// ---------------------------------------------------------------------------
// `broker-down`/`broker-up` (KafkaFault, Task 11 kafka-core) đã có coverage
// end-to-end ở `engine/index.test.ts:137` ("acks=all bị chặn khi broker-down
// làm ISR không đủ...") và bộ test lesson 06 (producer.test.ts) — Ruling A
// (task-4-brief) nói rõ không cần lặp lại coverage đó ở đây. File này chỉ test
// BA fault Task 4 thật sự thêm mới (`consumer-stall`, `processing-error`,
// `replica-lag`, mỗi cái một reducer trong `faults.ts`) và ba test engine-level
// cho consumer group thật (Ruling D).
// ---------------------------------------------------------------------------

function makeTopology(overrides?: Partial<KafkaTopology>): KafkaTopology {
  return {
    brokers: [{ id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } }],
    topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
    producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 } }],
    consumers: [],
    controllerBrokerId: 'b1',
    ...overrides,
  }
}

describe('faults', () => {
  it('consumer-stall giữ lastPollAt đứng yên nên member vượt maxPollIntervalMs và bị đá', () => {
    const topology = makeTopology({
      consumers: [
        { id: 'c1', label: 'Consumer', position: { x: 0, y: 0 }, groupId: 'g1', subscriptions: ['orders'], maxPollIntervalMs: 300 },
      ],
    })
    const sim = createKafkaSimulation({
      topology,
      script: [{ at: 0, kind: 'consumer-join', consumerId: 'c1' }],
      // Bắn ở t=500 (sau khi group đã Stable ở t=300), kéo dài 2000ms — đủ để
      // trùm qua mốc quét member-timeout đầu tiên (t=1000).
      failures: [{ at: 500, kind: 'consumer-stall', consumerId: 'c1', durationMs: 2000 }],
      seed: 1,
    })

    // Ngay TRƯỚC lượt quét member-timeout đầu tiên: c1 vẫn còn trong group,
    // nhưng `GroupMember.lastPollAt` đã đứng yên từ lúc stall bắt đầu (≤ 500),
    // không còn nhích theo mỗi lượt poll 100ms như bình thường.
    sim.advanceTo(999)
    const before = sim.snapshot().groups['g1']?.members.find((m) => m.memberId === 'c1')
    expect(before).toBeDefined()
    expect(before!.lastPollAt).toBeLessThanOrEqual(500)

    // Sau lượt quét ở t=1000: now(1000) - lastPollAt(≤500) > maxPollIntervalMs(300)
    // — c1 bị đá khỏi group (group chỉ có một member nên rỗng hẳn, về 'Empty').
    sim.advanceTo(1200)
    const group = sim.snapshot().groups['g1']
    expect(group?.state).toBe('Empty')
    expect(group?.members).toEqual([])
  })

  it('processing-error làm record bị xử lý lại đúng số lần đã khai, rồi mới đi tiếp', () => {
    const topology = makeTopology({
      consumers: [
        {
          id: 'c1',
          label: 'Consumer',
          position: { x: 0, y: 0 },
          groupId: 'g1',
          subscriptions: ['orders'],
          autoOffsetReset: 'earliest',
          maxPollIntervalMs: 50, // rebalance chốt sớm, không trì hoãn phần đang test
          processingMs: 100,
          enableAutoCommit: false, // giữ test tập trung vào process-done, không lẫn auto-commit
        },
      ],
    })
    const sim = createKafkaSimulation({
      topology,
      script: [
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'v1', partition: 0 },
        { at: 0, kind: 'consumer-join', consumerId: 'c1' },
      ],
      failures: [{ at: 0, kind: 'processing-error', consumerId: 'c1', times: 2 }],
      seed: 1,
    })
    sim.advanceTo(500)
    const state = sim.snapshot()

    const processDoneLines = state.journal.filter((e) => e.type === 'process-done').map((e) => e.text)
    // 2 lần "thử lại" (times: 2) rồi mới một lần hoàn tất thật sự — đúng 3 dòng.
    expect(processDoneLines).toHaveLength(3)
    expect(processDoneLines.filter((l) => l.includes('thử lại'))).toHaveLength(2)
    expect(processDoneLines.filter((l) => l.includes('xử lý xong'))).toHaveLength(1)

    const runtime = state.consumers['c1']!
    expect(runtime.pendingProcessingErrors ?? 0).toBe(0)
    expect(runtime.processingUntil).toBeUndefined()
  })

  it('replica-lag kéo lùi lastFetchAt của đúng broker đó trên mọi partition nó là replica', () => {
    const topology: KafkaTopology = {
      brokers: [
        { id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } },
        { id: 'b2', label: 'Broker 2', position: { x: 200, y: 0 } },
      ],
      topics: [{ name: 'orders', partitions: 2, replicationFactor: 2 }],
      producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 } }],
      consumers: [],
      controllerBrokerId: 'b1',
    }
    const sim = createKafkaSimulation({
      topology,
      script: [],
      failures: [{ at: 100, kind: 'replica-lag', brokerId: 'b2', ms: 5000 }],
      seed: 1,
    })
    // Dừng lại đúng t=100 (thời điểm fault bắn), KHÔNG đi xa hơn: kể từ Task 8,
    // `replica-fetch` chạy thật (topology này replicationFactor 2 nên có
    // follower) — lần tự hẹn KẾ TIẾP của chính broker b2 (~200-250ms sau lần
    // seed ở t=0) sẽ "chữa lành" đúng field này ngay khi nó tới lượt, che mất
    // hiệu ứng fault nếu advance qua khỏi mốc đó. Dừng đúng t=100 thấy được
    // trạng thái NGAY SAU fault (và lượt `shrinkIsr` phản ứng nó tự chain —
    // `shrinkIsr` không đụng `lastFetchAt`, chỉ đụng `isr`) mà không dính lượt
    // fetch tiếp theo.
    sim.advanceTo(100)
    const state = sim.snapshot()

    // `orders-0` leader=b1 replicas=[b1,b2]; `orders-1` leader=b2 replicas=[b2,b1]
    // (round-robin ở `createState`) — b2 là replica ở CẢ HAI, kể cả khi nó là
    // leader ở orders-1 (Ruling B: "mọi partition nó là replica", không loại trừ
    // trường hợp leader).
    expect(state.partitions['orders-0']!.replicaState['b2']!.lastFetchAt).toBe(100 - 5000)
    expect(state.partitions['orders-1']!.replicaState['b2']!.lastFetchAt).toBe(100 - 5000)
    // b1 không bị đụng tới.
    expect(state.partitions['orders-0']!.replicaState['b1']!.lastFetchAt).toBe(0)
  })

  it('fault ở thời điểm không có gì để tác động thì không làm gì, không throw', () => {
    const topology = makeTopology()
    const sim = createKafkaSimulation({
      topology,
      script: [],
      failures: [
        // Không có consumer nào tên 'ghost' từng join.
        { at: 100, kind: 'consumer-stall', consumerId: 'ghost', durationMs: 1000 },
        // b1 tồn tại trong topology nhưng replicationFactor=1 nên chưa từng là
        // replica của partition nào ngoài chính nó làm leader — thử fault trên
        // một broker hoàn toàn không có mặt trong replicas nào cả.
        { at: 100, kind: 'replica-lag', brokerId: 'ghost-broker', ms: 1000 },
        { at: 100, kind: 'processing-error', consumerId: 'ghost', times: 3 },
      ],
      seed: 1,
    })

    expect(() => sim.advanceTo(200)).not.toThrow()
    const state = sim.snapshot()
    expect(state.consumers['ghost']).toBeUndefined()
    expect(state.journal.some((e) => e.nodeId === 'ghost' || e.nodeId === 'ghost-broker')).toBe(false)
  })
})

describe('engine với consumer group', () => {
  function twoConsumerTopology(): KafkaTopology {
    return {
      brokers: [{ id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } }],
      topics: [{ name: 'orders', partitions: 4, replicationFactor: 1 }],
      producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 } }],
      consumers: [
        {
          id: 'c1',
          label: 'Consumer 1',
          position: { x: 0, y: 0 },
          groupId: 'g1',
          subscriptions: ['orders'],
          autoOffsetReset: 'earliest',
          maxPollIntervalMs: 200,
        },
        {
          id: 'c2',
          label: 'Consumer 2',
          position: { x: 0, y: 100 },
          groupId: 'g1',
          subscriptions: ['orders'],
          autoOffsetReset: 'earliest',
          maxPollIntervalMs: 200,
        },
      ],
      controllerBrokerId: 'b1',
    }
  }

  it('hai consumer cùng group chia nhau partition, không consumer nào đọc trùng', () => {
    const sim = createKafkaSimulation({
      topology: twoConsumerTopology(),
      script: [
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'a', partition: 0 },
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'b', partition: 1 },
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'c', partition: 2 },
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'd', partition: 3 },
        { at: 0, kind: 'consumer-join', consumerId: 'c1' },
        { at: 10, kind: 'consumer-join', consumerId: 'c2' }, // vẫn trong cửa sổ PreparingRebalance của c1 — chung một vòng
      ],
      seed: 1,
    })
    sim.advanceTo(400)
    const state = sim.snapshot()

    const group = state.groups['g1']!
    expect(group.state).toBe('Stable')
    const c1Member = group.members.find((m) => m.memberId === 'c1')!
    const c2Member = group.members.find((m) => m.memberId === 'c2')!
    const c1Keys = new Set(c1Member.assignment.map((p) => `${p.topic}-${p.partition}`))
    const c2Keys = new Set(c2Member.assignment.map((p) => `${p.topic}-${p.partition}`))

    // Toàn bộ 4 partition được chia hết, không consumer nào rỗng tay.
    expect(c1Keys.size).toBe(2)
    expect(c2Keys.size).toBe(2)
    for (const k of c1Keys) expect(c2Keys.has(k)).toBe(false) // không trùng

    // Đọc THẬT cũng tách bạch y hệt assignment — position chỉ tồn tại đúng những
    // key được gán cho consumer đó, không lem sang partition của consumer kia.
    expect(Object.keys(state.consumers['c1']!.position).sort()).toEqual([...c1Keys].sort())
    expect(Object.keys(state.consumers['c2']!.position).sort()).toEqual([...c2Keys].sort())
    for (const key of c1Keys) expect(state.consumers['c1']!.position[key]).toBeGreaterThan(0)
    for (const key of c2Keys) expect(state.consumers['c2']!.position[key]).toBeGreaterThan(0)
  })

  it('một consumer rời group thì partition của nó được giao lại trong cùng run', () => {
    const sim = createKafkaSimulation({
      topology: twoConsumerTopology(),
      script: [
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'a', partition: 0 },
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'b', partition: 1 },
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'c', partition: 2 },
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'd', partition: 3 },
        { at: 0, kind: 'consumer-join', consumerId: 'c1' },
        { at: 10, kind: 'consumer-join', consumerId: 'c2' },
        { at: 300, kind: 'consumer-leave', consumerId: 'c1' }, // sau khi group đã Stable (~t=200)
      ],
      seed: 1,
    })
    sim.advanceTo(700)
    const state = sim.snapshot()

    const group = state.groups['g1']!
    expect(state.consumers['c1']).toBeUndefined()
    expect(group.members.map((m) => m.memberId)).toEqual(['c2'])

    const c2Member = group.members.find((m) => m.memberId === 'c2')!
    const c2Keys = new Set(c2Member.assignment.map((p) => `${p.topic}-${p.partition}`))
    // c2 giờ một mình trong group — thừa kế TOÀN BỘ 4 partition, kể cả 2
    // partition trước đó thuộc về c1.
    expect(c2Keys).toEqual(new Set(['orders-0', 'orders-1', 'orders-2', 'orders-3']))
    expect(Object.keys(state.consumers['c2']!.position).sort()).toEqual([...c2Keys].sort())
    for (const key of c2Keys) expect(state.consumers['c2']!.position[key]).toBeGreaterThan(0)
  })

  it('cùng seed cho journal giống hệt nhau kể cả khi có rebalance', () => {
    const run = () => {
      const sim = createKafkaSimulation({
        topology: twoConsumerTopology(),
        script: [
          { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'a', partition: 0 },
          { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'b', partition: 1 },
          { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'c', partition: 2 },
          { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'd', partition: 3 },
          { at: 0, kind: 'consumer-join', consumerId: 'c1' },
          { at: 10, kind: 'consumer-join', consumerId: 'c2' },
          { at: 300, kind: 'consumer-leave', consumerId: 'c1' },
        ],
        seed: 7,
      })
      sim.advanceTo(700)
      return JSON.stringify(sim.snapshot().journal)
    }
    expect(run()).toBe(run())
  })
})
