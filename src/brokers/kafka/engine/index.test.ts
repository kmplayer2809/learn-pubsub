import { describe, expect, it } from 'vitest'
import { createKafkaSimulation } from './index'
import type { KafkaScriptedCommand, KafkaSimulationOptions, KafkaTopology } from './index'

function deepFreeze<T extends object>(obj: T): T {
  for (const key of Object.getOwnPropertyNames(obj) as (keyof T)[]) {
    const value = obj[key]
    if (value && typeof value === 'object') deepFreeze(value as object)
  }
  return Object.freeze(obj)
}

function makeTopology(): KafkaTopology {
  return {
    brokers: [
      { id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } },
      { id: 'b2', label: 'Broker 2', position: { x: 200, y: 0 } },
      { id: 'b3', label: 'Broker 3', position: { x: 400, y: 0 } },
    ],
    topics: [{ name: 'orders', partitions: 3, replicationFactor: 1 }],
    producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 200 } }],
    consumers: [{ id: 'c1', label: 'Consumer', position: { x: 400, y: 200 }, groupId: 'g1', subscriptions: ['orders'] }],
    controllerBrokerId: 'b1',
  }
}

const script: KafkaScriptedCommand[] = [
  { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'k1', value: 'v1' },
  { at: 500, kind: 'produce', producerId: 'p1', topic: 'orders', key: 'k2', value: 'v2' },
  { at: 0, kind: 'consumer-join', consumerId: 'c1' },
]

const options: KafkaSimulationOptions = { topology: makeTopology(), script, seed: 1 }

describe('createKafkaSimulation', () => {
  it('cùng seed cho journal giống hệt nhau tới từng byte', () => {
    const run = () => {
      const s = createKafkaSimulation(options)
      s.advanceTo(20_000)
      return s.snapshot().journal
    }
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })

  it('topology có issue mức error thì kernel không dispatch event nào', () => {
    const badTopology: KafkaTopology = { ...makeTopology(), controllerBrokerId: 'ghost' }
    const sim = createKafkaSimulation({ ...options, topology: badTopology })
    sim.advanceTo(20_000)
    expect(sim.snapshot().journal).toEqual([])
    expect(sim.issues.some((i) => i.severity === 'error')).toBe(true)
  })

  it('reset rồi advanceTo cùng mốc cho đúng state cũ — rewind là reset + replay', () => {
    const sim = createKafkaSimulation(options)
    sim.advanceTo(5000)
    const before = JSON.stringify(sim.snapshot())
    sim.reset()
    sim.advanceTo(5000)
    expect(JSON.stringify(sim.snapshot())).toBe(before)
  })

  it('không mutate topology đầu vào', () => {
    const topology = deepFreeze(makeTopology())
    const sim = createKafkaSimulation({ ...options, topology })
    expect(() => sim.advanceTo(20_000)).not.toThrow()
  })

  it('vòng lặp trên partition đi theo thứ tự sort, không theo thứ tự chèn', () => {
    // `zzz-topic` được khai trước `orders` trong mảng `topics` — nếu `createState`
    // hay `fetchRecords` lặp theo thứ tự chèn (`Object.keys`) thay vì
    // `sortedPartitionKeys`, `zzz-topic-0` sẽ được phục vụ trước `orders-0`. Ép
    // `maxPollRecords: 1` để một lần poll chỉ đủ ngân sách đọc đúng MỘT partition,
    // rồi khẳng định đó là partition đứng đầu theo thứ tự SORT (`orders-0`), không
    // phải partition đứng đầu theo thứ tự CHÈN (`zzz-topic-0`).
    const topology: KafkaTopology = {
      brokers: [{ id: 'b1', label: 'Broker 1', position: { x: 0, y: 0 } }],
      topics: [
        { name: 'zzz-topic', partitions: 1, replicationFactor: 1 },
        { name: 'orders', partitions: 3, replicationFactor: 1 },
      ],
      producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 } }],
      consumers: [
        {
          id: 'c1',
          label: 'Consumer',
          position: { x: 0, y: 0 },
          groupId: 'g1',
          subscriptions: ['zzz-topic', 'orders'],
          autoOffsetReset: 'earliest',
          maxPollRecords: 1,
        },
      ],
      controllerBrokerId: 'b1',
    }
    const orderedScript: KafkaScriptedCommand[] = [
      { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'o0', partition: 0 },
      { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'o1', partition: 1 },
      { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'o2', partition: 2 },
      { at: 0, kind: 'produce', producerId: 'p1', topic: 'zzz-topic', key: null, value: 'z0', partition: 0 },
      { at: 50, kind: 'consumer-join', consumerId: 'c1' },
    ]
    const sim = createKafkaSimulation({ topology, script: orderedScript, seed: 1 })
    sim.advanceTo(60)
    const runtime = sim.snapshot().consumers['c1']
    expect(runtime).toBeDefined()
    // Đúng một partition được ĐỌC (position nhích lên 1) ở lần poll đầu tiên —
    // và đó phải là `orders-0`, đứng đầu theo sort, không phải `zzz-topic-0`.
    expect(runtime!.position['orders-0']).toBe(1)
    expect(runtime!.position['orders-1']).toBe(0)
    expect(runtime!.position['orders-2']).toBe(0)
    expect(runtime!.position['zzz-topic-0']).toBe(0)
  })

  it('nextEventTime trả về mốc event kế tiếp, undefined khi hết', () => {
    const sim = createKafkaSimulation({ topology: makeTopology(), script: [], seed: 1 })
    expect(sim.nextEventTime()).toBeUndefined()

    // Chỉ produce, không consumer-join: không có vòng poll tự hẹn lại nào chạy
    // mãi mãi (đó là hành vi CÓ CHỦ ĐÍCH của quyết định #2 — một consumer sẽ
    // không bao giờ hết event), nên lịch trình phải cạn sau khi flush xong.
    const sim2 = createKafkaSimulation({ ...options, script: [script[0]!, script[1]!] })
    expect(sim2.nextEventTime()).toBe(0)
    sim2.advanceTo(100_000)
    expect(sim2.nextEventTime()).toBeUndefined()
  })
})

describe('produce path', () => {
  it('produce rồi flush ghi được một record vào log, và producer nhận produce-response', () => {
    const sim = createKafkaSimulation(options)
    sim.advanceTo(1000)
    const state = sim.snapshot()
    expect(state.partitions['orders-0']?.log.length ?? 0).toBeGreaterThan(0)
    expect(state.metrics.recordsProduced).toBeGreaterThan(0)
  })

  it('acks=all bị chặn khi broker-down làm ISR không đủ thì producer thấy lỗi trong journal', () => {
    const topology: KafkaTopology = {
      ...makeTopology(),
      producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 200 }, acks: 'all' }],
    }
    const sim = createKafkaSimulation({
      topology,
      script: [{ at: 100, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'v1', partition: 0 }],
      failures: [{ at: 0, kind: 'broker-down', brokerId: 'b1' }],
      seed: 1,
    })
    sim.advanceTo(500)
    const lines = sim.snapshot().journal.map((e) => e.text)
    expect(lines.some((l) => l.includes('LEADER_NOT_AVAILABLE'))).toBe(true)
  })
})

describe('consumer polling stays alive after catching up (decision #2)', () => {
  it('một consumer bắt kịp high watermark vẫn tiếp tục poll và nhận record produce SAU đó', () => {
    // Đây là bài kiểm cốt lõi cho quyết định #2 của brief: `fetch-request` phải tự
    // hẹn lại VÔ ĐIỀU KIỆN, không chỉ khi lần poll trước có record. Nếu việc hẹn
    // lại bị buộc vào `process-done` (chỉ sinh ra khi có record), consumer này sẽ
    // "điếc" vĩnh viễn ngay sau khi bắt kịp ở t=0 — vì tại đó không có record nào
    // để đọc — và không bao giờ thấy record produce ở t=5000.
    const topology: KafkaTopology = {
      ...makeTopology(),
      consumers: [
        {
          id: 'c1',
          label: 'Consumer',
          position: { x: 400, y: 200 },
          groupId: 'g1',
          subscriptions: ['orders'],
          autoOffsetReset: 'earliest',
        },
      ],
    }
    const sim = createKafkaSimulation({
      topology,
      script: [
        { at: 0, kind: 'consumer-join', consumerId: 'c1' }, // không có gì để đọc — bắt kịp ngay
        { at: 5000, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'late', partition: 0 },
      ],
      seed: 1,
    })
    sim.advanceTo(6000)
    const state = sim.snapshot()
    expect(state.metrics.recordsConsumed).toBeGreaterThan(0)
    expect(state.consumers['c1']?.position['orders-0']).toBeGreaterThan(0)
  })

  it('consumer-leave dừng hẳn vòng lặp fetch-request — không còn event nào cho consumer đó sau khi rời', () => {
    const sim = createKafkaSimulation({
      topology: makeTopology(),
      script: [
        { at: 0, kind: 'consumer-join', consumerId: 'c1' },
        { at: 1000, kind: 'consumer-leave', consumerId: 'c1' },
      ],
      seed: 1,
    })
    sim.advanceTo(1000)
    expect(sim.snapshot().consumers['c1']).toBeUndefined()
    // So sánh mọi thứ TRỪ `now`: `advanceTo` luôn kéo `now` tới đúng mốc gọi dù
    // không còn event nào xảy ra (xem `run.ts`), nên bản thân `now` đổi không nói
    // lên gì — cái cần khẳng định là không CÒN EVENT nào chạy tiếp sau khi rời.
    const { now: _now, ...before } = sim.snapshot()
    sim.advanceTo(20_000) // nếu fetch-request còn tự hẹn lại, journal/seq/state sẽ đổi
    const { now: _now2, ...after } = sim.snapshot()
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })
})
