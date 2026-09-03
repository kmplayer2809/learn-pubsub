import { describe, expect, it } from 'vitest'
import { createKafkaSimulation, partitionKey } from '../engine'
import { lagFor } from '../engine/group/offsets'
import { assign } from '../engine/group/assignors'
import type { GroupMember, TopicPartition } from '../engine'
import { consumerGroup } from './11-consumer-group'
import { rebalance } from './12-rebalance'
import { assignors } from './13-assignors'
import { commitStrategies } from './14-commit-strategies'
import { consumerLag } from './15-consumer-lag'
import { maxPollInterval } from './16-max-poll-interval'

function createSim(lesson: { topology: unknown; script: unknown; seed: number; failures?: unknown }) {
  return createKafkaSimulation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topology: lesson.topology as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    script: lesson.script as any,
    seed: lesson.seed,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    failures: lesson.failures as any,
  })
}

describe('lesson 11 — consumer group', () => {
  it('mỗi partition được đúng một consumer trong group đọc', () => {
    const sim = createSim(consumerGroup)
    // 13100: c2 vừa join xong (8000), rebalance đã chốt (13000) — g1 có hai
    // member, ba partition.
    sim.advanceTo(13_100)
    const group = sim.snapshot().groups['g1']!
    const owners = group.members.flatMap((m) => m.assignment.map((p) => `${p.topic}-${p.partition}`))
    // Mỗi trong ba partition xuất hiện ĐÚNG MỘT LẦN trong toàn bộ assignment
    // của group — không partition nào bị bỏ trống, không partition nào bị hai
    // consumer cùng giữ.
    expect(owners.sort()).toEqual(['orders-0', 'orders-1', 'orders-2'])
    expect(new Set(owners).size).toBe(owners.length)
  })

  it('consumer thứ tư trong group ba partition không nhận partition nào', () => {
    const sim = createSim(consumerGroup)
    // 21100: c3 và c4 vừa join xong (16000), rebalance đã chốt (21000).
    sim.advanceTo(21_100)
    const group = sim.snapshot().groups['g1']!
    const c4 = group.members.find((m) => m.memberId === 'c4')!
    expect(c4.assignment).toEqual([])
    // Ba partition vẫn có đủ chủ — chỉ là không có `c4` trong số đó.
    const totalAssigned = group.members.reduce((sum, m) => sum + m.assignment.length, 0)
    expect(totalAssigned).toBe(3)
    expect(group.members).toHaveLength(4)
  })
})

describe('lesson 12 — rebalance', () => {
  it('trong lúc rebalance không consumer nào đọc được record mới', () => {
    const sim = createSim(rebalance)
    // `c2` join ở 6000 (rebalance mở NGAY, Stable lại ở 11000). Record `b`
    // được ghi ở 8000 — nằm trong cửa sổ rebalance. So sánh recordsConsumed
    // TRƯỚC (7999) và NGAY TRƯỚC KHI Stable trở lại (10999): phải giống hệt
    // nhau — record `b`, dù đã nằm trong log, chưa ai đọc được nó.
    sim.advanceTo(7_999)
    const before = sim.snapshot().metrics.recordsConsumed
    sim.advanceTo(10_999)
    const stillDuringRebalance = sim.snapshot().metrics.recordsConsumed
    expect(stillDuringRebalance).toBe(before)
  })

  it('sau rebalance mọi partition đều có chủ trở lại', () => {
    const sim = createSim(rebalance)
    // 11100: rebalance do `c2` join xong. 19100: rebalance do `c1` rời xong.
    sim.advanceTo(11_100)
    const afterJoin = sim.snapshot().groups['g1']!
    const totalAfterJoin = afterJoin.members.reduce((sum, m) => sum + m.assignment.length, 0)
    expect(totalAfterJoin).toBe(4) // bốn partition, không cái nào bị bỏ trống

    sim.advanceTo(19_100)
    const afterLeave = sim.snapshot().groups['g1']!
    const totalAfterLeave = afterLeave.members.reduce((sum, m) => sum + m.assignment.length, 0)
    expect(totalAfterLeave).toBe(4) // chỉ còn c2, nhưng vẫn nhận đủ cả bốn
  })
})

describe('lesson 13 — assignor', () => {
  it('cooperative-sticky giữ được assignment của partition không đổi chủ', () => {
    const sim = createSim(assignors)
    // 9999: cả hai group đang Stable, `cg1` giữ orders-0/2/4.
    sim.advanceTo(9_999)
    const cg1Before = sim.snapshot().groups['g-coop']!.members.find((m) => m.memberId === 'cg1')!
    expect(cg1Before.assignment.map((p) => p.partition)).toContain(0)

    // 12000: giữa cửa sổ rebalance thứ hai (mở lúc 10000, chốt lúc 15000).
    // `g-range` (eager) đã xoá sạch assignment của MỌI member; `g-coop`
    // (cooperative-sticky) thì chưa đụng gì tới `cg1`/`cg2` — chúng vẫn đang
    // đọc bình thường.
    sim.advanceTo(12_000)
    const midSnap = sim.snapshot()
    const rg1Mid = midSnap.groups['g-range']!.members.find((m) => m.memberId === 'rg1')!
    const cg1Mid = midSnap.groups['g-coop']!.members.find((m) => m.memberId === 'cg1')!
    expect(rg1Mid.assignment).toEqual([]) // range: dừng toàn bộ ngay lập tức
    expect(cg1Mid.assignment.map((p) => p.partition)).toContain(0) // cooperative-sticky: chưa đổi gì

    // 15100: cả hai group Stable trở lại. `cg1` vẫn giữ đúng partition 0 —
    // chưa từng bị thu hồi suốt cả quá trình.
    sim.advanceTo(15_100)
    const cg1After = sim.snapshot().groups['g-coop']!.members.find((m) => m.memberId === 'cg1')!
    expect(cg1After.assignment.map((p) => p.partition)).toContain(0)
  })

  it('range để lại chênh lệch tải lớn hơn round-robin trên cùng đầu vào', () => {
    // Kiểm trực tiếp `assign()` — không cần dựng một group live thứ ba
    // (round-robin) trong lesson: khác biệt thật giữa range và round-robin
    // chỉ lộ ra khi group subscribe NHIỀU topic (range tính lại phần dư
    // "liên tiếp" cho MỖI topic riêng, luôn dồn vào cùng những member đứng
    // trước theo tên; round-robin dùng một cursor DUY NHẤT xuyên suốt mọi
    // topic, rải phần dư đó xen kẽ). Với một topic bảy... sáu partition duy
    // nhất như trong topology sống của bài này, cả hai cho cùng một mức cân
    // bằng (xem narrative bài 13) — bài test này dựng đúng kịch bản nhiều
    // topic để phép so sánh có nội dung thật.
    const members: GroupMember[] = [
      { memberId: 'A', subscriptions: ['t1', 't2'], assignment: [], lastHeartbeatAt: 0, lastPollAt: 0 },
      { memberId: 'B', subscriptions: ['t1', 't2'], assignment: [], lastHeartbeatAt: 0, lastPollAt: 0 },
    ]
    const partitions: TopicPartition[] = [
      { topic: 't1', partition: 0 },
      { topic: 't1', partition: 1 },
      { topic: 't1', partition: 2 },
      { topic: 't2', partition: 0 },
      { topic: 't2', partition: 1 },
      { topic: 't2', partition: 2 },
    ]
    const spread = (result: Record<string, unknown[]>) => {
      const counts = Object.values(result).map((v) => v.length)
      return Math.max(...counts) - Math.min(...counts)
    }
    const rangeResult = assign('range', members, partitions)
    const roundRobinResult = assign('round-robin', members, partitions)
    expect(spread(rangeResult)).toBeGreaterThan(spread(roundRobinResult))
  })
})

describe('lesson 14 — commit', () => {
  it('at-most-once: commit trước khi xử lý thì crash làm mất record', () => {
    const sim = createSim(commitStrategies)
    // 10001: NGAY SAU tick auto-commit ở 10000 — đọc committedOffset tại
    // đúng thời điểm mà, nếu crash xảy ra, một client khởi động lại sẽ đọc
    // tiếp từ đó. process-done của chính record này chỉ xảy ra ở 11100, sau
    // mốc 10001 — commit đã "vượt qua" một record CHƯA xử lý xong.
    sim.advanceTo(10_001)
    const snap = sim.snapshot()
    const processDoneAt = snap.journal.find((e) => e.type === 'process-done' && e.nodeId === 'c-auto')?.at
    const committedAt = snap.groups['g-auto']!.committedOffsets[partitionKey('orders', 0)]!.committedAt
    expect(processDoneAt).toBeUndefined() // chưa xử lý xong tại mốc này
    expect(committedAt).toBe(10_000)
  })

  it('at-least-once: commit sau khi xử lý thì crash làm xử lý lại record', () => {
    const sim = createSim(commitStrategies)
    // 11201: NGAY SAU commit tường minh ở 11200 — `c-manual` chỉ commit sau
    // khi process-done (11100) đã chắc chắn xảy ra.
    sim.advanceTo(11_201)
    const snap = sim.snapshot()
    const processDoneAt = snap.journal.find((e) => e.type === 'process-done' && e.nodeId === 'c-manual')!.at
    const committedAt = snap.groups['g-manual']!.committedOffsets[partitionKey('orders', 0)]!.committedAt
    // committed offset không bao giờ vượt quá phần đã xử lý xong thật sự —
    // crash trước lúc commit khiến record bị đọc LẠI, không mất.
    expect(processDoneAt).toBe(11_100)
    expect(committedAt).toBeGreaterThanOrEqual(processDoneAt)
  })
})

describe('lesson 15 — lag', () => {
  it('producer nhanh hơn consumer thì lag tăng đều', () => {
    const sim = createSim(consumerLag)
    const key = partitionKey('orders', 0)
    sim.advanceTo(5_000)
    const lagAt5000 = lagFor(sim.snapshot(), 'g1', key)
    sim.advanceTo(9_000)
    const lagAt9000 = lagFor(sim.snapshot(), 'g1', key)
    sim.advanceTo(14_000)
    const lagAt14000 = lagFor(sim.snapshot(), 'g1', key)
    // `c1` treo từ 1100, không bao giờ commit lại — committed offset của
    // orders-0 đứng yên trong khi high watermark tiến đều theo production:
    // lag phải tăng ĐƠN ĐIỆU, không dừng, không giảm.
    expect(lagAt9000).toBeGreaterThan(lagAt5000)
    expect(lagAt14000).toBeGreaterThan(lagAt9000)
  })

  it('thêm consumer vào group làm lag giảm — nhưng chỉ tới số partition', () => {
    const sim = createSim(consumerLag)
    const key1 = partitionKey('orders', 1)
    sim.advanceTo(14_000)
    const lag1Before = lagFor(sim.snapshot(), 'g1', key1) // c1 vẫn giữ orders-1, đang treo
    sim.advanceTo(20_000)
    const snapAfter = sim.snapshot()
    const lag1After = lagFor(snapAfter, 'g1', key1) // c2 đã tiếp quản orders-1 từ 16000
    expect(lag1After).toBeLessThan(lag1Before)

    // `c3` join cùng lúc với `c2` (15000) nhưng hai partition đã có đủ hai
    // chủ (`c1` giữ orders-0, `c2` giữ orders-1) — trần cứng là số partition.
    const c3 = snapAfter.groups['g1']!.members.find((m) => m.memberId === 'c3')!
    expect(c3.assignment).toEqual([])
  })
})

describe('lesson 16 — max.poll.interval.ms', () => {
  it('consumer xử lý chậm bị đá khỏi group', () => {
    const sim = createSim(maxPollInterval)
    // 7999: `c1` vẫn còn trong group (heartbeat vẫn đều, xem narrative) — chỉ
    // là đã treo xử lý từ 1650.
    sim.advanceTo(7_999)
    const beforeEviction = sim.snapshot().groups['g16']!
    expect(beforeEviction.members.some((m) => m.memberId === 'c1')).toBe(true)

    // 8000: vòng quét member-timeout đầu tiên vượt ngưỡng 6000ms kể từ lần
    // poll cuối (1600) đá `c1` ra — group không còn member nào.
    sim.advanceTo(8_000)
    const afterEviction = sim.snapshot().groups['g16']!
    expect(afterEviction.state).toBe('Empty')
    expect(afterEviction.members).toHaveLength(0)
  })

  it('bị đá xong join lại rồi lại bị đá — vòng lặp rebalance', () => {
    const sim = createSim(maxPollInterval)
    sim.advanceTo(maxPollInterval.durationMs)
    const state = sim.snapshot()
    // Bốn vòng Stable trong 30 giây (1500, 9550, 17600, 25650) — group không
    // bao giờ "yên" quá một cơn treo trước khi bị đá lần kế tiếp.
    expect(state.metrics.rebalances).toBeGreaterThan(2)
  })
})
