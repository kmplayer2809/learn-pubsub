import { describe, expect, it } from 'vitest'
import { createKafkaSimulation, partitionKey } from '../engine'
import { transactionsEos } from './22-transactions-eos'
import { retryDlq } from './23-retry-dlq'
import { sizingTuning } from './24-sizing-tuning'

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

/** Tổng số record một consumer THẬT SỰ nhận được (`fetched.records.length`, đã
 *  qua lọc `isolationLevel`) — `applyFetchRequest` chỉ ghi journal `deliver`
 *  khi lô đó có ít nhất một record, với đúng số lượng trong text, nên cộng dồn
 *  qua mọi lần `deliver` của một `nodeId` cho ra đúng tổng record consumer đó
 *  từng thấy trong suốt run — không lẫn với consumer khác vì `nodeId` tách
 *  riêng theo từng consumer ngay tại chỗ sinh event. */
function deliveredCount(journal: { type: string; nodeId?: string; text: string }[], consumerId: string): number {
  return journal
    .filter((e) => e.type === 'deliver' && e.nodeId === consumerId)
    .reduce((sum, e) => {
      const match = /nhận (\d+) record/.exec(e.text)
      return sum + (match ? Number(match[1]) : 0)
    }, 0)
}

describe('lesson 22 — transaction và exactly-once', () => {
  it('consumer read_committed không thấy record của transaction bị abort', () => {
    const sim = createSim(transactionsEos)
    sim.advanceTo(transactionsEos.durationMs)
    const snap = sim.snapshot()
    // Transaction đầu (a1/a2/a3) bị abort, transaction sau (b1/b2/b3) được
    // commit — `read_committed` (c1) chỉ được thấy ba record đã commit.
    expect(deliveredCount(snap.journal, 'c1')).toBe(3)
  })

  it('consumer read_uncommitted trong cùng run thì thấy', () => {
    const sim = createSim(transactionsEos)
    sim.advanceTo(transactionsEos.durationMs)
    const snap = sim.snapshot()
    // Cùng một run, cùng dữ liệu — `read_uncommitted` (c2) thấy cả sáu record
    // dữ liệu thật (ba đã abort lẫn ba đã commit), chỉ control record là giấu.
    expect(deliveredCount(snap.journal, 'c2')).toBe(6)
  })
})

describe('lesson 23 — retry topic và DLQ', () => {
  it('record lỗi quá số lần cho phép rơi sang DLQ, không chặn partition', () => {
    const sim = createSim(retryDlq)
    sim.advanceTo(retryDlq.durationMs)
    const snap = sim.snapshot()
    const dlq = snap.partitions[partitionKey('orders.dlq', 0)]!
    expect(dlq.log).toHaveLength(1)
    expect(dlq.log[0]?.headers?.cause).toBe('processing-error')
    expect(dlq.log[0]?.headers?.attempts).toBe('5')

    // "Không chặn partition": partition gốc vẫn nhận đủ mọi record đã script,
    // không có record nào bị mất hay bị giữ lại vì record hỏng đứng trước nó.
    const orders = snap.partitions[partitionKey('orders', 0)]!
    const producedToOrders = (retryDlq.script as { kind: string; topic?: string }[]).filter(
      (c) => c.kind === 'produce' && c.topic === 'orders',
    ).length
    expect(orders.log).toHaveLength(producedToOrders)
  })

  it('record sau record lỗi vẫn được xử lý — retry tại chỗ thì không', () => {
    const sim = createSim(retryDlq)
    sim.advanceTo(retryDlq.durationMs)
    const snap = sim.snapshot()
    const key = partitionKey('orders', 0)
    const orders = snap.partitions[key]!
    const runtime = snap.consumers['c1']
    expect(runtime).toBeDefined()
    // `c1` bắt kịp toàn bộ high watermark — mọi record SAU record lỗi (offset
    // của nó trở đi) đều đã được giao và xử lý, không đứng khựng lại tại record
    // hỏng như một consumer retry-tại-chỗ (không bao giờ gọi lại `poll()` cho
    // tới khi thành công) sẽ bị.
    expect(runtime!.position[key]).toBe(orders.highWatermark)
  })
})

describe('lesson 24 — sizing và tuning', () => {
  it('lesson chạy hết durationMs không halt và có đủ narrative', () => {
    const sim = createSim(sizingTuning)
    sim.advanceTo(sizingTuning.durationMs)
    const snap = sim.snapshot()
    expect(snap.halted).toBeUndefined()
    expect(sizingTuning.narrative.length).toBeGreaterThanOrEqual(4)
  })
})
