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
    //
    // `maxPollIntervalMs: 10` (Task 4): group thật phải qua `PreparingRebalance`
    // trước khi có assignment (xem `joinGroup`, `group/coordinator.ts`) — không
    // set gì thì rơi về default 300_000ms, xa hơn hẳn cửa sổ test này. Đặt nhỏ để
    // rebalance chốt gần như ngay sau lúc join (t=50+10=60), rồi advance qua LƯỢT
    // POLL THẬT ĐẦU TIÊN có assignment (t=50+100=150, vì lượt poll ngay lúc join
    // vẫn còn `PreparingRebalance`, không đọc gì).
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
          maxPollIntervalMs: 10,
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
    sim.advanceTo(160)
    const runtime = sim.snapshot().consumers['c1']
    expect(runtime).toBeDefined()
    // Đúng một partition được ĐỌC (position nhích lên 1) ở lần poll đầu tiên có
    // assignment — và đó phải là `orders-0`, đứng đầu theo sort, không phải
    // `zzz-topic-0`.
    expect(runtime!.position['orders-0']).toBe(1)
    expect(runtime!.position['orders-1']).toBe(0)
    expect(runtime!.position['orders-2']).toBe(0)
    expect(runtime!.position['zzz-topic-0']).toBe(0)
  })

  it('nextEventTime trả về mốc event kế tiếp, undefined khi hết — không consumer-join thì member-timeout không hề khởi động (fix round, post-review)', () => {
    // Regression test cho phát hiện review round 1: Task 4 ban đầu seed
    // `member-timeout` VÔ ĐIỀU KIỆN, một lần, lúc khởi tạo simulation — khiến
    // MỌI simulation Kafka (kể cả kịch bản không hề có consumer nào) còn ít
    // nhất một event tự hẹn lại mãi mãi, `nextEventTime()` không bao giờ trả
    // `undefined`, âm thầm vô hiệu hoá auto-pause của shell
    // (`useSimulation.ts:198` — pause chỉ khi `nextEventTime() === undefined`).
    // Fix round: `member-timeout` giờ chỉ khởi động khi `applyConsumerJoin`
    // thấy `hasAnyGroupMember` chuyển false→true (xem why-comment ở đó và ở
    // `MEMBER_TIMEOUT_SCAN_INTERVAL_MS`) — một kịch bản không consumer-join nào
    // thì không group/member nào tồn tại, vòng quét không bao giờ được seed.
    const sim = createKafkaSimulation({ topology: makeTopology(), script: [], seed: 1 })
    expect(sim.nextEventTime()).toBeUndefined()

    // Chỉ produce, không consumer-join: lịch trình phải cạn hẳn sau khi flush
    // xong, đúng property RabbitMQ vẫn giữ (`delivery.test.ts:285`).
    const sim2 = createKafkaSimulation({ ...options, script: [script[0]!, script[1]!] })
    expect(sim2.nextEventTime()).toBe(0)
    sim2.advanceTo(100_000)
    expect(sim2.nextEventTime()).toBeUndefined()
  })

  it('consumer join rồi leave: MỌI vòng tự hẹn lại (poll/heartbeat/member-timeout) dừng hẳn — lịch trình cạn thật, không chỉ "coi như cạn"', () => {
    // Bổ sung test cho phát hiện review round 1, đối xứng với test phía trên:
    // ở đó chứng minh `member-timeout` không khởi động khi KHÔNG có consumer;
    // test này chứng minh nó khởi động ĐÚNG LÚC (khi member đầu tiên join) và
    // tự dừng ĐÚNG LÚC (khi member cuối cùng rời) — không phải một vòng chạy
    // mãi mãi bất kể trạng thái, cũng không phải một vòng không bao giờ chạy.
    // `maxPollIntervalMs: 300` để `rebalance-complete` (hẹn lúc join) chốt
    // trước khi test advance xong, không để lại một event xa tít (mặc định
    // 300_000ms) còn treo lơ lửng làm `nextEventTime()` sai lệch.
    const topology: KafkaTopology = {
      ...makeTopology(),
      consumers: [{ id: 'c1', label: 'Consumer', position: { x: 400, y: 200 }, groupId: 'g1', subscriptions: ['orders'], maxPollIntervalMs: 300 }],
    }
    const sim = createKafkaSimulation({
      topology,
      script: [
        { at: 0, kind: 'consumer-join', consumerId: 'c1' },
        { at: 1000, kind: 'consumer-leave', consumerId: 'c1' },
      ],
      seed: 1,
    })
    sim.advanceTo(20_000)
    expect(sim.snapshot().consumers['c1']).toBeUndefined()
    expect(sim.snapshot().groups['g1']?.members).toEqual([])
    // Chứng cứ trực tiếp nhất cho việc lịch trình cạn thật: không còn event
    // nào — của fetch-request, heartbeat, hay member-timeout — treo lơ lửng.
    expect(sim.nextEventTime()).toBeUndefined()
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
    //
    // `maxPollIntervalMs: 500` (Task 4): không set gì thì group thật rơi về
    // default 300_000ms trước khi có assignment (`joinGroup`) — quá xa so với cửa
    // sổ 6000ms của test này. 500ms đủ để rebalance chốt rất sớm, còn cách rất xa
    // mốc produce ở t=5000, không đổi ý nghĩa gốc của test (poll tiếp diễn sau khi
    // bắt kịp).
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
          maxPollIntervalMs: 500,
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
    // So sánh mọi thứ TRỪ `now`/`seq`: `advanceTo` luôn kéo `now` tới đúng mốc gọi
    // dù không còn event nào xảy ra cho CONSUMER này (xem `run.ts`), nên bản thân
    // `now` đổi không nói lên gì. `seq` cũng loại ra kể từ Task 4: vòng quét
    // `member-timeout` (toàn cluster, không gắn với consumer nào) vẫn tự hẹn lại
    // đều đặn mỗi 1000ms bất kể consumer này còn hay đã rời — nó tăng `seq` một
    // cách VÔ HẠI, không liên quan gì tới việc `fetch-request`/`heartbeat` của
    // riêng `c1` đã dừng hẳn hay chưa, đúng thứ test này thật sự muốn khẳng định.
    const { now: _now, seq: _seq, ...before } = sim.snapshot()
    sim.advanceTo(20_000) // nếu fetch-request/heartbeat của c1 còn tự hẹn lại, journal/groups/... sẽ đổi
    const { now: _now2, seq: _seq2, ...after } = sim.snapshot()
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })
})

describe('commit (Task 4, Ruling C — consolidate lên commitOffsets)', () => {
  it('commit từ một consumer đã bị checkTimeouts đá khỏi group (nhưng runtime vẫn còn) bị bỏ qua hoàn toàn — UNKNOWN_MEMBER_ID', () => {
    // Điểm mấu chốt Ruling C siết chặt: `commitOffsets` (group/offsets.ts) kiểm
    // `memberId` THẬT SỰ nằm trong `group.members`, không chỉ kiểm
    // `state.consumers[id]` có tồn tại (cái `applyCommit` bản cũ Task 1-3 chỉ
    // kiểm mỗi vậy). Hai điều kiện này KHÁC NHAU: một consumer có thể bị
    // `checkTimeouts` đá khỏi `group.members` (do vượt `maxPollIntervalMs`) mà
    // KHÔNG hề rời `state.consumers` — client thật không tự biết ngay mình đã
    // mất chỗ trong group. `applyCommit` (engine/index.ts) giờ gọi thẳng
    // `commitOffsets`, thừa hưởng đúng độ chặt đó — một siết chặt CÓ CHỦ Ý
    // (khớp `UNKNOWN_MEMBER_ID` Kafka thật), pin lại bằng test này để không ai
    // vô tình nới lỏng lại.
    const topology: KafkaTopology = {
      ...makeTopology(),
      consumers: [{ id: 'c1', label: 'Consumer', position: { x: 0, y: 0 }, groupId: 'g1', subscriptions: ['orders'], maxPollIntervalMs: 300 }],
    }
    const sim = createKafkaSimulation({
      topology,
      script: [
        { at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'v1', partition: 0 },
        { at: 0, kind: 'consumer-join', consumerId: 'c1' },
        // Sau t=1000 (mốc quét member-timeout đầu tiên), c1 đã bị đá khỏi group vì
        // `consumer-stall` (armed ở t=500, kéo dài 2000ms) làm `GroupMember.lastPollAt`
        // đứng yên quá `maxPollIntervalMs`. c1 KHÔNG hề gọi `consumer-leave`.
        { at: 1200, kind: 'commit', consumerId: 'c1' },
      ],
      failures: [{ at: 500, kind: 'consumer-stall', consumerId: 'c1', durationMs: 2000 }],
      seed: 1,
    })
    sim.advanceTo(1200)
    const state = sim.snapshot()
    // Sanity-check tiền đề: c1 vẫn còn trong `state.consumers` (chưa hề rời),
    // nhưng group đã rỗng (bị đá) — đúng kịch bản Ruling C mô tả.
    expect(state.consumers['c1']).toBeDefined()
    expect(state.groups['g1']?.members).toEqual([])
    // Commit ở t=1200 phải bị bỏ qua hoàn toàn: không ghi committedOffsets,
    // không tăng metrics.commits.
    expect(state.groups['g1']?.committedOffsets).toEqual({})
    expect(state.metrics.commits).toBe(0)
  })
})
