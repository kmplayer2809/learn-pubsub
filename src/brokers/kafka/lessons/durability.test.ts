import { describe, expect, it } from 'vitest'
import { createKafkaSimulation, partitionKey } from '../engine'
import { readFrom } from '../engine/log'
import { PRODUCE_RESPONSE_TRAVEL_MS } from '../engine/produce'
import { replicationIsr } from './17-replication-isr'
import { minInsyncReplicas } from './18-min-insync-replicas'
import { leaderElection } from './19-leader-election'
import { retention } from './20-retention'
import { compaction } from './21-compaction'

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

describe('lesson 17 — replication và ISR', () => {
  it('consumer không bao giờ đọc được record vượt quá high watermark', () => {
    const sim = createSim(replicationIsr)
    // 550: mười record đã append liên tục mỗi 50ms (100..550) — nhanh hơn hẳn
    // chu kỳ replica-fetch (200ms + jitter tới 50ms). Tick thứ hai của MỌI
    // follower không bao giờ vượt quá 498 (200+249, hai lượt tối đa), nên
    // KHÔNG follower nào kịp fetch tới record ở 500/550 vào đúng mốc này.
    const p0Key = partitionKey('orders', 0)
    sim.advanceTo(550)
    const snap = sim.snapshot()
    const p0 = snap.partitions[p0Key]!
    expect(p0.log).toHaveLength(10) // leader đã ghi đủ cả mười record
    expect(p0.highWatermark).toBeLessThan(p0.leo) // nhưng chưa đủ ISR bắt kịp
    // Đúng bảo đảm read-committed-visible: record cuối cùng leader vừa ghi
    // (offset 9) không nằm trong bất kỳ lần đọc nào ở mốc này.
    const readable = readFrom(p0, 0, 100)
    expect(readable.some((r) => r.offset === 9)).toBe(false)
    expect(readable.length).toBeLessThan(10)
  })

  it('follower chậm kéo high watermark tụt lại so với LEO của leader', () => {
    const sim = createSim(replicationIsr)
    const p0Key = partitionKey('orders', 0)

    // Giữa chừng burst (300): leader đã ghi 4 record (100,150,200,250 — offset
    // 250 vừa append đúng lúc này), follower nhiều nhất mới có MỘT lượt fetch
    // thật (200-249) — HW tụt lại phía sau LEO ngay từ khi production còn
    // đang tiếp diễn, không phải một hiện tượng chỉ xảy ra lúc kết thúc.
    sim.advanceTo(300)
    const mid = sim.snapshot().partitions[p0Key]!
    expect(mid.highWatermark).toBeLessThan(mid.leo)

    // Cuối burst (550): khoảng cách vẫn còn đó — production liên tục nhanh
    // hơn hẳn nhịp fetch, HW liên tục "đuổi theo sau" LEO chứ không đứng yên.
    sim.advanceTo(550)
    const end = sim.snapshot().partitions[p0Key]!
    expect(end.highWatermark).toBeLessThan(end.leo)
  })
})

describe('lesson 18 — min.insync.replicas', () => {
  it('acks=all + min.insync.replicas=2: mất một broker là produce lỗi, không mất im lặng', () => {
    const sim = createSim(minInsyncReplicas)
    sim.advanceTo(9500 + PRODUCE_RESPONSE_TRAVEL_MS + 50)
    const snap = sim.snapshot()
    const responses = snap.journal.filter((e) => e.type === 'produce-response' && e.nodeId === 'p1')
    const strictResponseAfterDown = responses.find((e) => e.at > 9000 && e.text.startsWith('orders-strict'))
    expect(strictResponseAfterDown).toBeDefined()
    // Lỗi ồn ào, không phải mất im lặng: có MỘT response thật, mang đúng lỗi.
    expect(strictResponseAfterDown!.text).toContain('lỗi NOT_ENOUGH_REPLICAS')
  })

  it('cùng kịch bản với min.insync.replicas=1 thì produce vẫn thành công', () => {
    const sim = createSim(minInsyncReplicas)
    sim.advanceTo(10000 + PRODUCE_RESPONSE_TRAVEL_MS + 50)
    const snap = sim.snapshot()
    const responses = snap.journal.filter((e) => e.type === 'produce-response' && e.nodeId === 'p1')
    const looseResponseAfterDown = responses.find((e) => e.at > 9000 && e.text.startsWith('orders-loose'))
    expect(looseResponseAfterDown).toBeDefined()
    expect(looseResponseAfterDown!.text).toContain('produce OK')
  })
})

describe('lesson 19 — leader election', () => {
  it('leader chết, bầu từ ISR: không record nào biến mất', () => {
    const sim = createSim(leaderElection)
    const key = partitionKey('orders', 0)
    // 8100: ngay sau khi b1 chết (7500, xem failures) và ngay sau lần ghi kế
    // tiếp (8000, dưới leader MỚI b2) — controller đã bầu lại từ ISR còn đủ
    // (b2, b3 vẫn cả hai bắt kịp, chưa ai rớt vì lag).
    sim.advanceTo(8100)
    const snap = sim.snapshot()
    const partition = snap.partitions[key]!
    expect(partition.leader).toBe('b2')
    expect(partition.leaderEpoch).toBe(1)
    // Bảy record ghi trước khi b1 chết (t=1000..7000) cộng một record ghi
    // ngay sau đó dưới leader mới (t=8000) — đủ tám, không thiếu record nào.
    expect(partition.log).toHaveLength(8)
    expect(partition.log.map((r) => r.offset)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    const electionLine = snap.journal.find((e) => e.type === 'leader-election' && e.at === 7500)
    expect(electionLine?.text).not.toContain('mất')
  })

  it('unclean.leader.election bật: log ngắn lại, record đã acks=all vẫn mất', () => {
    const sim = createSim(leaderElection)
    const key = partitionKey('orders', 0)

    // Trước cái chết thứ hai (25000): record cuối cùng (offset 23, t=24000)
    // đã thật sự nhận acks=all thành công — producer TIN nó đã an toàn.
    sim.advanceTo(24_999)
    const beforeSnap = sim.snapshot()
    const lastAck = beforeSnap.journal.find(
      (e) => e.type === 'produce-response' && e.nodeId === 'p1' && e.text.includes('offset 23'),
    )
    expect(lastAck).toBeDefined()

    // Sau cái chết thứ hai (25000): ISR đã co về một mình b2 (b1 bị loại từ
    // lần bầu sạch đầu tiên; b3 — `replicaFetchEveryMs: 16_000`, chậm hơn hẳn
    // nhịp sản xuất — bị `shrinkIsr` loại vì lag trước khi b2 chết) — không
    // còn ứng viên sạch, `uncleanLeaderElection: true` nên bầu từ TOÀN BỘ
    // replica còn sống: chỉ còn b3, đang tụt lại phía sau rất xa.
    sim.advanceTo(25_100)
    const afterSnap = sim.snapshot()
    const partition = afterSnap.partitions[key]!
    expect(partition.leader).toBe('b3')
    expect(partition.leaderEpoch).toBe(2)
    // Log ngắn lại thật, và chính record vừa xác nhận acks=all ở trên đã mất.
    expect(partition.log.length).toBeLessThan(24)
    expect(partition.log.some((r) => r.offset === 23)).toBe(false)
    const electionLine = afterSnap.journal.find((e) => e.type === 'leader-election' && e.at === 25_000)
    expect(electionLine?.text).toContain('mất')
  })
})

describe('lesson 20 — retention và segment', () => {
  it('retention.ms xoá segment cũ, logStartOffset tăng', () => {
    const sim = createSim(retention)
    sim.advanceTo(24500)
    const snap = sim.snapshot()
    const p0 = snap.partitions[partitionKey('orders', 0)]!
    expect(p0.logStartOffset).toBeGreaterThan(0)
    expect(snap.metrics.recordsExpired).toBeGreaterThan(0)
  })

  it('consumer đang ở offset đã bị xoá phải reset theo auto.offset.reset', () => {
    const sim = createSim(retention)
    sim.advanceTo(26_500)
    const snap = sim.snapshot()
    const key = partitionKey('orders', 0)
    const p0 = snap.partitions[key]!
    const runtime = snap.consumers['c1']
    expect(runtime).toBeDefined()
    const position = runtime!.position[key]
    // `c1` join muộn (t=25000, sau khi production đã ngừng ở t=24500) với
    // `autoOffsetReset: 'earliest'` — nó bắt kịp NGAY tới high watermark hiện
    // tại trong đúng một lượt poll (backlog nhỏ hơn `maxPollRecords`), nên
    // không có mốc nào để bắt được vị trí "vừa mới reset, chưa kịp đọc thêm".
    // Bằng chứng gián tiếp nhưng chắc chắn: tổng số record nó THẬT SỰ đọc
    // được đúng bằng phần còn lại từ `logStartOffset` tới high watermark —
    // không phải từ offset 0 (đã bị retention xoá từ lâu, xem test trên).
    expect(position).toBe(p0.highWatermark) // đã bắt kịp hoàn toàn
    expect(p0.logStartOffset).toBeGreaterThan(0) // 0 không còn đọc được nữa
    expect(snap.metrics.recordsConsumed).toBe(p0.highWatermark - p0.logStartOffset)
    // Nếu nó lỡ "reset" về offset 0 thật (đọc được cả phần đã bị xoá), số
    // record đọc được sẽ bằng cả `highWatermark`, không phải hiệu số này —
    // đây chính xác là chỗ bug "kẹp offset lên logStartOffset rồi đọc tiếp"
    // (xem why-comment `readFrom`, log.ts) sẽ lộ ra nếu nó tồn tại.
    expect(snap.metrics.recordsConsumed).toBeLessThan(p0.highWatermark)
  })
})

describe('lesson 21 — log compaction', () => {
  it('sau compaction mỗi key chỉ còn một bản ghi trong phần đã nén', () => {
    const sim = createSim(compaction)
    sim.advanceTo(5100)
    const snap = sim.snapshot()
    const p0 = snap.partitions[partitionKey('orders', 0)]!
    const openSegment = p0.segments.at(-1)!
    const sealedLog = p0.log.filter((r) => r.offset < openSegment.baseOffset)
    const user1InSealed = sealedLog.filter((r) => r.key === 'user-1')
    expect(user1InSealed).toHaveLength(1)
    expect(user1InSealed[0]?.value).toBe('v2') // bản mới nhất, v1 đã bị nén mất
    expect(snap.metrics.recordsCompacted).toBeGreaterThan(0)
  })

  it('tombstone xoá hẳn key', () => {
    const sim = createSim(compaction)
    sim.advanceTo(5100)
    const snap = sim.snapshot()
    const p0 = snap.partitions[partitionKey('orders', 0)]!
    const openSegment = p0.segments.at(-1)!
    const sealedLog = p0.log.filter((r) => r.offset < openSegment.baseOffset)
    // user-2 chỉ từng có một bản ghi rồi một tombstone — sau compact, key này
    // biến mất HOÀN TOÀN khỏi phần đã nén, không còn cả bản ghi lẫn tombstone.
    expect(sealedLog.some((r) => r.key === 'user-2')).toBe(false)
  })
})
