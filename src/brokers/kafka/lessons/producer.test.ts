import { describe, expect, it } from 'vitest'
import { createKafkaSimulation, partitionKey } from '../engine'
import { acks } from './06-acks'
import { batchingLinger } from './07-batching-linger'
import { partitioner } from './08-partitioner'
import { idempotentProducer } from './09-idempotent-producer'
import { orderingRetries } from './10-ordering-retries'

function run(lesson: { topology: unknown; script: unknown; seed: number; failures?: unknown; durationMs: number }) {
  const sim = createKafkaSimulation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topology: lesson.topology as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    script: lesson.script as any,
    seed: lesson.seed,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    failures: lesson.failures as any,
  })
  sim.advanceTo(lesson.durationMs + 5000)
  return sim.snapshot()
}

describe('lesson 06 — acks', () => {
  it('acks=0 mất record khi broker chết mà producer không hề biết', () => {
    const snap = run(acks)
    const log = snap.partitions[partitionKey('orders', 0)]?.log.map((r) => r.value)
    expect(log).toEqual(['đơn-1a']) // đơn-1b (gửi sau khi b1 chết) không bao giờ tới log
    const journalForP1 = snap.journal.filter((e) => e.nodeId === 'p1')
    // Không có bất kỳ produce-response lỗi nào cho p1 — mất HOÀN TOÀN im lặng.
    expect(journalForP1.some((e) => e.type === 'produce-response')).toBe(false)
  })

  it('acks=all không mất record nào trong cùng kịch bản', () => {
    const snap = run(acks)
    const log = snap.partitions[partitionKey('orders', 2)]?.log.map((r) => r.value)
    expect(log).toEqual(['đơn-3a', 'đơn-3b'])
  })
})

describe('lesson 07 — batching', () => {
  it('linger.ms lớn gom nhiều record vào một lần ghi, tổng số batch giảm', () => {
    const snap = run(batchingLinger)
    const p1Flushes = snap.journal.filter((e) => e.nodeId === 'p1' && e.type === 'produce')
    const p2Flushes = snap.journal.filter((e) => e.nodeId === 'p2' && e.type === 'produce')
    expect(p1Flushes.length).toBe(8) // lingerMs: 0 — một record một batch
    expect(p2Flushes.length).toBe(2) // lingerMs: 2000 — gom bốn record một batch
    expect(p2Flushes.length).toBeLessThan(p1Flushes.length)
  })

  it('linger.ms = 0 cho độ trễ từng record thấp nhất', () => {
    const snap = run(batchingLinger)
    // Record đầu tiên (t=500) của p1 được ack gần như ngay lập tức; của p2 phải
    // chờ hết lingerMs (flush ở t=2500) rồi mới được ghi.
    const p1FirstResponse = snap.journal.find((e) => e.nodeId === 'p1' && e.type === 'produce-response')
    const p2FirstResponse = snap.journal.find((e) => e.nodeId === 'p2' && e.type === 'produce-response')
    expect(p1FirstResponse?.at).toBeLessThan(1000)
    expect(p2FirstResponse?.at).toBeGreaterThanOrEqual(2500)
  })
})

describe('lesson 08 — partitioner', () => {
  it('key lệch làm một partition ôm phần lớn record — hot partition', () => {
    const snap = run(partitioner)
    const counts = [0, 1, 2, 3].map((i) => snap.partitions[partitionKey('orders', i)]?.log.length ?? 0)
    const total = counts.reduce((a, b) => a + b, 0)
    const max = Math.max(...counts)
    // Partition nóng nhất chứa ít nhất một nửa toàn bộ record của cả hai producer.
    expect(max).toBeGreaterThanOrEqual(total / 2)
    // Bảy record key vip-1 của p1 nằm trọn trong đúng MỘT partition.
    const vipPartitions = new Set(
      [0, 1, 2, 3]
        .filter((i) => (snap.partitions[partitionKey('orders', i)]?.log ?? []).some((r) => r.key === 'vip-1'))
    )
    expect(vipPartitions.size).toBe(1)
    const hotPartitionKey = [...vipPartitions][0]!
    const vipCount = snap.partitions[partitionKey('orders', hotPartitionKey)]!.log.filter((r) => r.key === 'vip-1').length
    expect(vipCount).toBe(7)
  })

  it('round-robin rải đều khi không có key', () => {
    const snap = run(partitioner)
    const counts = [0, 1, 2, 3].map(
      (i) => (snap.partitions[partitionKey('orders', i)]?.log ?? []).filter((r) => r.key === null).length,
    )
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10)
    // Không partition nào rỗng, không partition nào ôm gần hết — rải tương đối đều.
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(2)
      expect(count).toBeLessThanOrEqual(3)
    }
  })
})

describe('lesson 09 — idempotent', () => {
  it('cùng kịch bản retry: không idempotent sinh duplicate, idempotent thì không', () => {
    const snap = run(idempotentProducer)
    const log = snap.partitions[partitionKey('orders', 0)]!.log.map((r) => r.value)
    expect(log.filter((v) => v === 'đơn-2a').length).toBe(2) // p1 (không idempotent): duplicate thật
    expect(log.filter((v) => v === 'đơn-2b').length).toBe(1) // p2 (idempotent): broker bỏ qua bản gửi lại
    expect(snap.metrics.duplicatesPrevented).toBeGreaterThanOrEqual(1)
  })
})

describe('lesson 10 — thứ tự', () => {
  it('maxInFlight = 5 không idempotent làm log lệch thứ tự produce', () => {
    const snap = run(orderingRetries)
    const log = snap.partitions[partitionKey('orders', 0)]!.log
    const p1Values = log.filter((r) => (r.value ?? '').startsWith('p1-rec')).map((r) => r.value)
    // p1 (không idempotent, maxInFlight: 5): rec-1 hỏng và gửi lại nên tới SAU rec-2/rec-3.
    expect(p1Values.indexOf('p1-rec-1')).toBeGreaterThan(p1Values.indexOf('p1-rec-2'))
    expect(p1Values.indexOf('p1-rec-1')).toBeGreaterThan(p1Values.indexOf('p1-rec-3'))
    // p2 (idempotent, cùng maxInFlight: 5): broker từ chối record tới sai lượt,
    // buộc gửi lại tới khi đúng thứ tự — log của p2 vẫn đúng thứ tự đã gọi.
    const p2Values = log.filter((r) => (r.value ?? '').startsWith('p2-rec')).map((r) => r.value)
    expect(p2Values).toEqual(['p2-rec-1', 'p2-rec-2', 'p2-rec-3'])
    // p3 (maxInFlight: 1): record sau nối đuôi batch đang retry, không vượt mặt được.
    const p3Values = log.filter((r) => (r.value ?? '').startsWith('p3-rec')).map((r) => r.value)
    expect(p3Values).toEqual(['p3-rec-1', 'p3-rec-2', 'p3-rec-3'])
  })
})
