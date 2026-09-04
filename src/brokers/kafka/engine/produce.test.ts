import { describe, expect, it } from 'vitest'
import { createKafkaSimulation } from './index'
import { estimateBytes } from './log'
import { murmur2, toPositive } from './murmur2'
import {
  checkIsrSufficient,
  checkSequence,
  enqueueRecord,
  flushBatch,
  isAckSatisfied,
  PRODUCE_RESPONSE_TRAVEL_MS,
  PRODUCE_RETRY_BACKOFF_MS,
  resolvePendingAcks,
} from './produce'
import { replicaFetch } from './replication'
import { testState } from './testState'
import type { KafkaProducerSpec, KafkaState, KafkaTopicSpec, KafkaTopology, ProducerRuntime } from './types'
import { partitionKey } from './types'

const orders: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 1 }
const key0 = partitionKey('orders', 0)

function producer(overrides?: Partial<KafkaProducerSpec>): KafkaProducerSpec {
  return { id: 'p1', label: 'Producer', position: { x: 0, y: 0 }, ...overrides }
}

// --- Tiện ích riêng cho test retry/idempotence -----------------------------

/**
 * Mô phỏng "client gửi lại chính xác request đã gửi trước đó" — ghi thẳng một
 * batch vào accumulator thay vì đi qua `enqueueRecord` (thứ luôn cấp sequence
 * MỚI cho một lệnh `.send()` mới, đúng — không phải một lần gửi lại của CÙNG một
 * record). Đây là cách duy nhất tái hiện "ack bị mất, client resend" ở mức test
 * function-level, không cần dựng một fault type riêng cho nó.
 */
function injectBatch(state: KafkaState, producerId: string, pKey: string, records: ProducerRuntime['batches'][string]['records']): KafkaState {
  const runtime = state.producers[producerId]
  if (!runtime) throw new Error('test setup: missing producer runtime')
  return {
    ...state,
    producers: { ...state.producers, [producerId]: { ...runtime, batches: { ...runtime.batches, [pKey]: { records, bytes: 0, openedAt: 0 } } } },
  }
}

/** Mô phỏng fault `produce-error` đã kích hoạt (`applyProduceErrorArm`, `engine/index.ts`) mà không cần chạy cả kernel. */
function withPendingErrors(state: KafkaState, producerId: string, times: number): KafkaState {
  const runtime = state.producers[producerId]
  if (!runtime) throw new Error('test setup: missing producer runtime')
  return { ...state, producers: { ...state.producers, [producerId]: { ...runtime, pendingErrors: (runtime.pendingErrors ?? 0) + times } } }
}

describe('produce', () => {
  it('record chưa đủ batch.size thì nằm trong batch, chưa vào log', () => {
    const state = testState()
    const p = producer({ batchSize: 1000, lingerMs: 10_000 })
    const { state: after } = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 })

    const batch = after.producers['p1']?.batches[key0]
    expect(batch?.records).toHaveLength(1)
    expect(after.partitions[key0]?.leo).toBe(0)
  })

  it('batch flush khi đủ batch.size, không cần chờ linger', () => {
    // Mỗi record 'x' nặng estimateBytes(null, 'x') = 41 byte. batchSize = 82 nên
    // record thứ hai (tổng 82 >= 82) mới kích flush, record đầu (41 < 82) thì chưa.
    const bytesPerRecord = estimateBytes(null, 'x')
    const state = testState()
    const p = producer({ batchSize: bytesPerRecord * 2, lingerMs: 10_000 })

    const first = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'x', at: 0 })
    expect(first.newEvents.filter((e) => e.type === 'batch-flush' && e.at === 0)).toHaveLength(0)

    const second = enqueueRecord(first.state, { producer: p, topic: orders, key: null, value: 'x', at: 5 })
    const sizeFlush = second.newEvents.find((e) => e.type === 'batch-flush' && e.at === 5)
    expect(sizeFlush).toBeDefined()
  })

  it('batch flush khi hết linger.ms dù chưa đủ batch.size', () => {
    const state = testState()
    const p = producer({ batchSize: 100_000, lingerMs: 1000 })
    const { newEvents } = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 200 })

    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]).toMatchObject({ type: 'batch-flush', at: 1200 })
  })

  it('lingerMs = 0 thì mỗi record là một batch — độ trễ thấp nhất, throughput thấp nhất', () => {
    const state = testState()
    const p = producer({ batchSize: 100_000, lingerMs: 0 })
    const { newEvents } = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 42 })

    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]).toMatchObject({ type: 'batch-flush', at: 42 })
  })

  it('acks=0 coi như thành công ngay, kể cả khi leader offline', () => {
    let state = testState({ brokersOnline: { b1: false } })
    const p = producer({ acks: 0, batchSize: 100_000, lingerMs: 0 })
    const enqueued = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 })
    state = enqueued.state

    const { state: after, newEvents } = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    expect(newEvents).toEqual([]) // acks=0 không hề chờ hay phát tín hiệu lỗi
    expect(after.partitions[key0]?.log).toHaveLength(0) // ...nhưng record chưa từng chạm log
    expect(after.producers['p1']?.batches[key0]).toBeUndefined() // batch vẫn được dọn — producer coi như đã gửi
  })

  it('acks=1 thành công khi leader append xong, không chờ follower', () => {
    let state = testState()
    const p = producer({ acks: 1, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 }).state

    const { state: after, newEvents } = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    expect(after.partitions[key0]?.log).toHaveLength(1)
    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]).toMatchObject({
      type: 'produce-response',
      at: PRODUCE_RESPONSE_TRAVEL_MS,
      payload: { offset: 0 },
    })
    expect(newEvents[0]?.payload.error).toBeUndefined()
  })

  it('acks=all: append thành công NGAY nhưng response ĐẬU LẠI cho tới khi follower thật sự fetch kịp (Task 8)', () => {
    const twoReplicaTopic: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 2, config: { minInsyncReplicas: 2 } }
    let state = testState({ topics: [twoReplicaTopic], replicas: ['b1', 'b2'] })
    const p = producer({ acks: 'all', batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: twoReplicaTopic, key: null, value: 'a', at: 0 }).state

    const { state: after, newEvents } = flushBatch(state, { producer: p, topic: twoReplicaTopic, partition: 0, at: 0 })
    // Record đã THẬT SỰ vào log — append không chờ ai cả.
    expect(after.partitions[key0]?.log).toHaveLength(1)
    // Nhưng b2 (follower) chưa từng fetch — HW vẫn 0, isAckSatisfied false —
    // KHÔNG có response nào bay ra ngay, request "đậu" lại pendingAcks thay vì
    // trả thành công giả hoặc lỗi giả.
    expect(newEvents).toEqual([])
    expect(after.partitions[key0]?.pendingAcks).toEqual([{ producerId: 'p1', offset: 0, requestedAt: 0 }])

    // b2 fetch thật (replication.ts) — HW nhích lên, và `resolvePendingAcks`
    // (gọi từ wrapper `replica-fetch`, engine/index.ts, mô phỏng ở đây bằng lời
    // gọi thẳng) phát đúng response bị đậu, với offset thật.
    const fetched = replicaFetch(after, { brokerId: 'b2', at: 100 })
    expect(fetched.state.partitions[key0]?.highWatermark).toBe(1)
    const resolved = resolvePendingAcks(fetched.state, { partitionKey: key0, at: 100, minInsyncReplicas: 2 })
    expect(resolved.state.partitions[key0]?.pendingAcks).toEqual([])
    expect(resolved.newEvents).toHaveLength(1)
    expect(resolved.newEvents[0]).toMatchObject({
      type: 'produce-response',
      at: 100 + PRODUCE_RESPONSE_TRAVEL_MS,
      payload: { offset: 0 },
    })
  })

  it('acks=all đậu lại: ISR tụt dưới min.insync.replicas trước khi kịp bắt thì resolvePendingAcks trả lỗi, không treo vĩnh viễn', () => {
    const twoReplicaTopic: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 2, config: { minInsyncReplicas: 2 } }
    let state = testState({ topics: [twoReplicaTopic], replicas: ['b1', 'b2'] })
    const p = producer({ acks: 'all', batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: twoReplicaTopic, key: null, value: 'a', at: 0 }).state

    const { state: after } = flushBatch(state, { producer: p, topic: twoReplicaTopic, partition: 0, at: 0 })
    expect(after.partitions[key0]?.pendingAcks).toHaveLength(1)

    // b2 rớt khỏi ISR trước khi kịp fetch — chỉ còn b1, dưới minInsyncReplicas.
    const partition = after.partitions[key0]
    if (!partition) throw new Error('test setup: missing partition')
    const shrunk = { ...after, partitions: { ...after.partitions, [key0]: { ...partition, isr: ['b1'] } } }

    const resolved = resolvePendingAcks(shrunk, { partitionKey: key0, at: 200, minInsyncReplicas: 2 })
    expect(resolved.state.partitions[key0]?.pendingAcks).toEqual([]) // không còn treo
    expect(resolved.newEvents[0]).toMatchObject({ type: 'produce-response', payload: { error: 'NOT_ENOUGH_REPLICAS' } })
  })

  it('acks=all lỗi NOT_ENOUGH_REPLICAS khi ISR nhỏ hơn min.insync.replicas', () => {
    const twoReplicaTopic: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 2, config: { minInsyncReplicas: 2 } }
    let state = testState({ topics: [twoReplicaTopic], replicas: ['b1', 'b2'] })
    const p = producer({ acks: 'all', batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: twoReplicaTopic, key: null, value: 'a', at: 0 }).state
    // b2 rớt khỏi ISR — chỉ còn 1 trong khi minInsyncReplicas đòi 2.
    const partition = state.partitions[key0]
    if (!partition) throw new Error('test setup: missing partition')
    state = { ...state, partitions: { ...state.partitions, [key0]: { ...partition, isr: ['b1'] } } }

    const { state: after, newEvents } = flushBatch(state, { producer: p, topic: twoReplicaTopic, partition: 0, at: 0 })
    expect(after.partitions[key0]?.log).toHaveLength(0) // không đủ ISR thì không append
    expect(newEvents[0]).toMatchObject({ type: 'produce-response', payload: { error: 'NOT_ENOUGH_REPLICAS' } })
  })

  it('record có key luôn vào đúng partition murmur2 chỉ ra, kể cả khi qua batch', () => {
    const fourPartitions: KafkaTopicSpec = { name: 'orders', partitions: 4, replicationFactor: 1 }
    let state = testState({ topics: [fourPartitions] })
    const p = producer({ acks: 1, batchSize: 100_000, lingerMs: 1000 })
    const expectedPartition = toPositive(murmur2('user-42')) % 4

    const enqueued = enqueueRecord(state, { producer: p, topic: fourPartitions, key: 'user-42', value: 'a', at: 0 })
    state = enqueued.state
    const expectedKey = partitionKey('orders', expectedPartition)
    expect(state.producers['p1']?.batches[expectedKey]?.records).toHaveLength(1)

    const { state: after } = flushBatch(state, { producer: p, topic: fourPartitions, partition: expectedPartition, at: 0 })
    expect(after.partitions[expectedKey]?.log[0]?.key).toBe('user-42')
  })

  it('metrics.recordsProduced chỉ tăng khi record thực sự vào log', () => {
    let state = testState({ brokersOnline: { b1: false } })
    const p = producer({ acks: 0, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 }).state
    const droppedResult = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    expect(droppedResult.state.metrics.recordsProduced).toBe(0) // leader offline: không vào log, không tăng

    let secondState = testState() // b1 online lần này
    const p2 = producer({ acks: 1, batchSize: 100_000, lingerMs: 0 })
    secondState = enqueueRecord(secondState, { producer: p2, topic: orders, key: null, value: 'a', at: 0 }).state
    const wrote = flushBatch(secondState, { producer: p2, topic: orders, partition: 0, at: 0 })
    expect(wrote.state.metrics.recordsProduced).toBe(1) // lần này thực sự vào log
  })

  // --- regression: nextSticky không được ép về số, kể cả qua enqueueRecord ---
  // Bug đã sửa ở Task 2 (`partitioner.ts`): nhánh record có key trả `nextSticky:
  // stickyPartition` nguyên trạng — có thể là `undefined`. Nếu caller (ở đây là
  // `enqueueRecord`) lỡ viết `nextSticky ?? 0` khi ghi lại vào `ProducerRuntime`,
  // bug y hệt tái xuất hiện một tầng cao hơn dù `partitioner.ts` đã đúng.
  it('sticky: bản ghi có key đầu tiên không set stickyPartition trên ProducerRuntime', () => {
    const fourPartitions: KafkaTopicSpec = { name: 'orders', partitions: 4, replicationFactor: 1 }
    const state = testState({ topics: [fourPartitions] })
    const p = producer({ partitioner: 'sticky', batchSize: 100_000, lingerMs: 1000 })

    const { state: after } = enqueueRecord(state, { producer: p, topic: fourPartitions, key: 'user-1', value: 'a', at: 0 })
    expect(after.producers['p1']?.stickyPartition).toBeUndefined()
  })

  it('sticky: bản ghi key=null tiếp theo sau bản ghi có key vẫn pick thật — rng phải tiến', () => {
    const fourPartitions: KafkaTopicSpec = { name: 'orders', partitions: 4, replicationFactor: 1 }
    const state = testState({ topics: [fourPartitions] })
    const p = producer({ partitioner: 'sticky', batchSize: 100_000, lingerMs: 1000 })

    const afterKeyed = enqueueRecord(state, { producer: p, topic: fourPartitions, key: 'user-1', value: 'a', at: 0 }).state
    const rngBefore = afterKeyed.producers['p1']?.rng

    const afterNullKeyed = enqueueRecord(afterKeyed, { producer: p, topic: fourPartitions, key: null, value: 'b', at: 1 }).state
    const rngAfter = afterNullKeyed.producers['p1']?.rng

    // rng phải thực sự tiến — nếu `enqueueRecord` lỡ không ghi lại `rng` trả về từ
    // `pickPartition` (hoặc ghi lại `rng` cũ), state sẽ đứng yên và assertion này
    // thất bại đúng như test tương ứng ở `partitioner.test.ts`.
    expect(rngAfter).not.toEqual(rngBefore)
    expect(afterNullKeyed.producers['p1']?.stickyPartition).toBeDefined()
  })

  it('sticky: sau khi batch đóng (flush) thì đổi partition — không dính cứng mãi mãi (KIP-480)', () => {
    // Spec §B5.1 (dòng 437): "gắn với một partition tới khi batch đầy hoặc
    // linger.ms hết, RỒI MỚI ĐỔI". `flushBatch` là nơi duy nhất biết một batch
    // vừa đóng (do đầy hoặc do hết linger) — nên reset `stickyPartition` phải
    // xảy ra ở đó, không phải ở `enqueueRecord`.
    const fourPartitions: KafkaTopicSpec = { name: 'orders', partitions: 4, replicationFactor: 1 }
    let state = testState({ topics: [fourPartitions] })
    const p = producer({ partitioner: 'sticky', acks: 1, batchSize: 100_000, lingerMs: 0 })

    const firstEnqueue = enqueueRecord(state, { producer: p, topic: fourPartitions, key: null, value: 'a', at: 0 })
    state = firstEnqueue.state
    const flushEvent = firstEnqueue.newEvents.find((e) => e.type === 'batch-flush')
    if (!flushEvent) throw new Error('test setup: expected a batch-flush event')
    const firstPickedPartition = flushEvent.payload.partition as number

    state = flushBatch(state, { producer: p, topic: fourPartitions, partition: firstPickedPartition, at: 0 }).state

    // Batch đầu đã đóng: sticky phải trở về "chưa chọn", không phải dính lại
    // đúng partition cũ.
    expect(state.producers['p1']?.stickyPartition).toBeUndefined()

    const rngBeforeSecondPick = state.producers['p1']?.rng
    state = enqueueRecord(state, { producer: p, topic: fourPartitions, key: null, value: 'b', at: 1 }).state
    const rngAfterSecondPick = state.producers['p1']?.rng

    // Nếu `stickyPartition` không được reset, nhánh early-return của
    // `pickPartition` (đã có sticky) sẽ trả về ngay mà không hề gọi `nextInt` —
    // rng đứng yên là dấu hiệu bug tái xuất hiện.
    expect(rngAfterSecondPick).not.toEqual(rngBeforeSecondPick)
  })

  it('flushBatch gọi lần hai trên cùng batch là no-op — không flush lại, không lỗi', () => {
    // Kịch bản thật: record đầu tiên vừa mở batch vừa vượt batchSize, nên
    // `enqueueRecord` sinh CẢ HAI event batch-flush (size ngay tại `at`, linger ở
    // `at + lingerMs`). Kernel không huỷ được event đã lên lịch, nên khi cả hai
    // đều tới lượt xử lý, lần thứ hai phải là no-op an toàn.
    let state = testState()
    const p = producer({ batchSize: 1, lingerMs: 1000 }) // batchSize cực nhỏ: record đầu đã vượt ngưỡng
    const enqueued = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 })
    expect(enqueued.newEvents.filter((e) => e.type === 'batch-flush')).toHaveLength(2)
    state = enqueued.state

    const firstFlush = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    expect(firstFlush.state.partitions[key0]?.log).toHaveLength(1)

    const secondFlush = flushBatch(firstFlush.state, { producer: p, topic: orders, partition: 0, at: 1000 })
    expect(secondFlush.newEvents).toEqual([])
    expect(secondFlush.state.partitions[key0]?.log).toHaveLength(1) // không ghi thêm lần hai
    expect(secondFlush.state.metrics.recordsProduced).toBe(1) // không tăng thêm
  })

  it('isAckSatisfied: acks=1 luôn thoả ngay khi có offset (không cần isr)', () => {
    const state = testState()
    expect(isAckSatisfied(state, { acks: 1, topic: orders, partition: 0, offset: 0 })).toBe(true)
  })

  it('checkIsrSufficient: ok khi isr đạt minInsyncReplicas, không cần offset', () => {
    const twoReplicaTopic: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 2, config: { minInsyncReplicas: 2 } }
    const state = testState({ topics: [twoReplicaTopic], replicas: ['b1', 'b2'] })
    expect(checkIsrSufficient(state, { topic: twoReplicaTopic, partition: 0 })).toEqual({ ok: true })
  })

  it('checkIsrSufficient: NOT_ENOUGH_REPLICAS khi isr nhỏ hơn minInsyncReplicas', () => {
    const twoReplicaTopic: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 2, config: { minInsyncReplicas: 2 } }
    let state = testState({ topics: [twoReplicaTopic], replicas: ['b1', 'b2'] })
    const partition = state.partitions[key0]
    if (!partition) throw new Error('test setup: missing partition')
    state = { ...state, partitions: { ...state.partitions, [key0]: { ...partition, isr: ['b1'] } } }
    expect(checkIsrSufficient(state, { topic: twoReplicaTopic, partition: 0 })).toEqual({ ok: false, error: 'NOT_ENOUGH_REPLICAS' })
  })
})

describe('idempotent producer', () => {
  it('retry cùng một record không tạo bản ghi thứ hai trong log', () => {
    let state = testState()
    const p = producer({ idempotent: true, acks: 1, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 }).state
    state = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 }).state
    expect(state.partitions[key0]?.log).toHaveLength(1)

    // Mô phỏng client resend: ack bị mất trên đường về, producer gửi lại CHÍNH
    // record đã thành công, với cùng producerId/sequence đã được stamp lúc
    // enqueue lần đầu.
    const entry = state.partitions[key0]?.log[0]
    if (!entry || entry.producerId === undefined || entry.sequence === undefined) throw new Error('test setup: record chưa stamp producerId/sequence')
    state = injectBatch(state, 'p1', key0, [
      { key: null, value: 'a', timestamp: 0, bytes: estimateBytes(null, 'a'), producerId: entry.producerId, sequence: entry.sequence },
    ])

    const { state: after, newEvents } = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 100 })
    expect(after.partitions[key0]?.log).toHaveLength(1) // không ghi lần hai
    expect(after.metrics.duplicatesPrevented).toBe(1)
    expect(newEvents[0]).toMatchObject({ type: 'produce-response' })
    expect(newEvents[0]?.payload.error).toBeUndefined() // duplicate vẫn coi là "đã gửi", không phải lỗi
  })

  it('duplicatesPrevented tăng đúng số lần retry bị chặn', () => {
    let state = testState()
    const p = producer({ idempotent: true, acks: 1, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 }).state
    state = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 }).state
    const entry = state.partitions[key0]?.log[0]
    if (!entry || entry.producerId === undefined || entry.sequence === undefined) throw new Error('test setup')

    for (let i = 0; i < 3; i++) {
      state = injectBatch(state, 'p1', key0, [
        { key: null, value: 'a', timestamp: 0, bytes: estimateBytes(null, 'a'), producerId: entry.producerId, sequence: entry.sequence },
      ])
      state = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 100 + i }).state
    }

    expect(state.metrics.duplicatesPrevented).toBe(3)
    expect(state.partitions[key0]?.log).toHaveLength(1)
  })

  it('sequence nhảy cóc bị từ chối là out-of-order, không âm thầm ghi', () => {
    const state = testState()
    const partition = state.partitions[key0]
    if (!partition) throw new Error('test setup')
    expect(checkSequence(partition, { producerId: 0, sequence: 5 })).toBe('out-of-order')

    // Qua flushBatch: record nhảy cóc không được ghi, và một `produce-retry` được
    // hẹn thay vì âm thầm biến mất.
    const p = producer({ idempotent: true, acks: 1, retries: 5, batchSize: 100_000, lingerMs: 0 })
    const injected = injectBatch(state, 'p1', key0, [{ key: null, value: 'x', timestamp: 0, bytes: estimateBytes(null, 'x'), producerId: 0, sequence: 5 }])
    const { state: after, newEvents } = flushBatch(injected, { producer: p, topic: orders, partition: 0, at: 0 })

    expect(after.partitions[key0]?.log).toHaveLength(0)
    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]).toMatchObject({ type: 'produce-retry', at: PRODUCE_RETRY_BACKOFF_MS })
  })

  it('producer không idempotent thì retry tạo duplicate thật — đó là điều bài 09 dạy', () => {
    let state = testState()
    const p = producer({ idempotent: false, acks: 1, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 }).state
    state = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 }).state
    expect(state.partitions[key0]?.log).toHaveLength(1)

    // Client tự ý gửi lại (ack bị mất, không có idempotence bảo vệ) — cùng nội
    // dung, nhưng không có producerId/sequence nào để broker so khớp.
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 100 }).state
    state = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 100 }).state

    expect(state.partitions[key0]?.log).toHaveLength(2) // duplicate thật — không có gì chặn
    expect(state.metrics.duplicatesPrevented).toBe(0)
  })
})

describe('retry và thứ tự', () => {
  it('maxInFlight = 1 giữ nguyên thứ tự kể cả khi request đầu phải retry', () => {
    let state = testState()
    const p = producer({ maxInFlight: 1, retries: 5, acks: 1, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'first', at: 0 }).state
    state = withPendingErrors(state, 'p1', 1)

    const firstAttempt = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    expect(firstAttempt.state.partitions[key0]?.log).toHaveLength(0) // chưa ghi gì — bị fault chặn
    const retryEvent = firstAttempt.newEvents.find((e) => e.type === 'produce-retry')
    if (!retryEvent) throw new Error('test setup: expected a produce-retry event')
    expect(retryEvent.payload.records).toBeUndefined() // maxInFlight<=1: batch còn nguyên trong accumulator, không cần snapshot
    state = firstAttempt.state

    // Record thứ hai được enqueue TRONG LÚC record đầu đang chờ retry — nối vào
    // CÙNG batch (accumulator chưa bị dọn), không mở batch riêng.
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'second', at: 50 }).state
    expect(state.producers['p1']?.batches[key0]?.records).toHaveLength(2)

    // Retry cuối cùng thành công: cả hai record ra log CÙNG một lượt, đúng thứ tự.
    const retried = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 200, attempt: 1 })
    expect(retried.state.partitions[key0]?.log.map((e) => e.value)).toEqual(['first', 'second'])
  })

  it('maxInFlight = 1 VÀ idempotent: thứ tự giữ được bằng accumulator, không cần checkSequence can thiệp', () => {
    // Ô còn thiếu trong ma trận maxInFlight × idempotent: khác test "maxInFlight
    // > 1 CÓ idempotent" (nơi thứ tự được giữ nhờ `checkSequence` từ chối và ép
    // retry), ở đây `maxInFlight <= 1` giữ thứ tự một cách CẤU TRÚC — batch không
    // bao giờ bị dọn khỏi accumulator khi đang chờ retry, nên không có hai batch
    // nào cùng partition từng tồn tại độc lập để `checkSequence` phải can thiệp.
    let state = testState()
    const p = producer({ idempotent: true, maxInFlight: 1, retries: 5, acks: 1, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'first', at: 0 }).state
    state = withPendingErrors(state, 'p1', 1)

    const firstAttempt = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    expect(firstAttempt.state.partitions[key0]?.log).toHaveLength(0)
    state = firstAttempt.state

    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'second', at: 50 }).state
    expect(state.producers['p1']?.batches[key0]?.records).toHaveLength(2) // nối vào cùng batch, đúng như nhánh không-idempotent

    const retried = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 200, attempt: 1 })
    expect(retried.state.partitions[key0]?.log.map((e) => e.value)).toEqual(['first', 'second'])
    // Cả hai record vào log ngay lần retry NÀY — không có `produce-retry` thứ hai
    // nào bị `checkSequence` ép sinh ra, khác hẳn cascade của test "maxInFlight >
    // 1 CÓ idempotent".
    expect(retried.newEvents.filter((e) => e.type === 'produce-retry')).toHaveLength(0)
    expect(retried.newEvents.find((e) => e.type === 'produce-response')).toBeDefined()
  })

  it('maxInFlight > 1 không idempotent: retry đẩy record ra sau record gửi sau nó', () => {
    // Khẳng định log ra thứ tự KHÁC thứ tự produce — đây là bug thật, không phải
    // lỗi cài đặt. Test chốt nó để lesson 10 dạy được.
    let state = testState()
    const p = producer({ maxInFlight: 5, retries: 5, idempotent: false, acks: 1, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'first', at: 0 }).state
    state = withPendingErrors(state, 'p1', 1)

    const firstAttempt = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    expect(firstAttempt.state.partitions[key0]?.log).toHaveLength(0)
    expect(firstAttempt.state.producers['p1']?.batches[key0]).toBeUndefined() // maxInFlight>1: batch bị dọn ngay, coi như đã "gửi"
    const retryEvent = firstAttempt.newEvents.find((e) => e.type === 'produce-retry')
    if (!retryEvent) throw new Error('test setup: expected a produce-retry event')
    expect(Array.isArray(retryEvent.payload.records)).toBe(true) // snapshot đi kèm — accumulator không còn giữ nó
    state = firstAttempt.state

    // Record thứ hai enqueue SAU khi accumulator đã trống — mở batch MỚI, độc lập.
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'second', at: 50 }).state
    const second = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 50 })
    expect(second.state.partitions[key0]?.log.map((e) => e.value)).toEqual(['second']) // record sau lại tới TRƯỚC

    const retried = flushBatch(second.state, {
      producer: p,
      topic: orders,
      partition: 0,
      at: 200,
      attempt: 1,
      retryRecords: retryEvent.payload.records as ProducerRuntime['batches'][string]['records'],
    })
    expect(retried.state.partitions[key0]?.log.map((e) => e.value)).toEqual(['second', 'first']) // ĐẢO NGƯỢC thứ tự produce
  })

  it('maxInFlight > 1 CÓ idempotent: broker sắp lại theo sequence, thứ tự được giữ', () => {
    let state = testState()
    const p = producer({ maxInFlight: 5, retries: 5, idempotent: true, acks: 1, batchSize: 100_000, lingerMs: 0 })

    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'first', at: 0 }).state
    state = withPendingErrors(state, 'p1', 1)
    const firstAttempt = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    state = firstAttempt.state
    const firstRetry = firstAttempt.newEvents.find((e) => e.type === 'produce-retry')
    if (!firstRetry) throw new Error('test setup: expected produce-retry for record1')

    // record2 enqueue SAU khi accumulator trống — sequence kế tiếp (1), flush ngay
    // (không có fault chặn) nhưng bị TỪ CHỐI vì record1 (sequence 0) chưa tới.
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'second', at: 50 }).state
    const secondAttempt = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 50 })
    expect(secondAttempt.state.partitions[key0]?.log).toHaveLength(0) // out-of-order — không ghi
    state = secondAttempt.state
    const secondRetry = secondAttempt.newEvents.find((e) => e.type === 'produce-retry')
    if (!secondRetry) throw new Error('test setup: expected produce-retry for record2 (out-of-order)')

    // record1's retry (attempt 1) tới trước, thành công — sequence 0 khớp.
    const record1Records = firstRetry.payload.records as ProducerRuntime['batches'][string]['records']
    const record1Retried = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 200, attempt: 1, retryRecords: record1Records })
    state = record1Retried.state
    expect(state.partitions[key0]?.log.map((e) => e.value)).toEqual(['first'])

    // record2's retry (attempt 1) tới sau, giờ mới thành công — sequence 1 khớp.
    const record2Records = secondRetry.payload.records as ProducerRuntime['batches'][string]['records']
    const record2Retried = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 250, attempt: 1, retryRecords: record2Records })
    state = record2Retried.state
    expect(state.partitions[key0]?.log.map((e) => e.value)).toEqual(['first', 'second']) // thứ tự được giữ
  })

  it('retries = 0 thì lỗi là lỗi luôn, không thử lại', () => {
    let state = testState()
    const p = producer({ retries: 0, acks: 1, batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: orders, key: null, value: 'a', at: 0 }).state
    state = withPendingErrors(state, 'p1', 1)

    const { state: after, newEvents } = flushBatch(state, { producer: p, topic: orders, partition: 0, at: 0 })
    expect(after.partitions[key0]?.log).toHaveLength(0)
    expect(after.producers['p1']?.batches[key0]).toBeUndefined() // batch dọn, không chờ gì nữa
    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]).toMatchObject({ type: 'produce-response', payload: { error: 'PRODUCE_ERROR' } })
    expect(after.metrics.retries).toBe(0) // không có retry nào thực sự xảy ra
  })
})

describe('produce-error fault qua toàn bộ simulation (wiring engine/index.ts)', () => {
  it('produce-error trong script khiến flush đầu tiên retry rồi thành công', () => {
    const topology: KafkaTopology = {
      brokers: [{ id: 'b1', label: 'b1', position: { x: 0, y: 0 } }],
      topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
      producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 }, acks: 1, batchSize: 100_000, lingerMs: 0, retries: 5 }],
      consumers: [],
      controllerBrokerId: 'b1',
    }
    const sim = createKafkaSimulation({
      topology,
      script: [{ at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'a' }],
      failures: [{ at: 0, kind: 'produce-error', producerId: 'p1', times: 1 }],
      seed: 1,
    })

    sim.advanceTo(1000)
    const snap = sim.snapshot()

    // Nếu `produce-error` bị bỏ qua (như trước Task 11), record vẫn vào log ngay
    // lần gửi đầu và `metrics.retries` đứng ở 0 — lesson sẽ chạy xanh mà không
    // chứng minh được gì. Assertion `retries === 1` chính là cái phân biệt hai
    // trường hợp đó.
    expect(snap.partitions[partitionKey('orders', 0)]?.log).toHaveLength(1)
    expect(snap.metrics.retries).toBe(1)
  })
})

describe('ack-lost fault qua toàn bộ simulation (wiring engine/index.ts) — bài 09 dạy từ đây', () => {
  function ackLostTopology(producerOverrides?: Partial<KafkaProducerSpec>): KafkaTopology {
    return {
      brokers: [{ id: 'b1', label: 'b1', position: { x: 0, y: 0 } }],
      topics: [{ name: 'orders', partitions: 1, replicationFactor: 1 }],
      producers: [{ id: 'p1', label: 'Producer', position: { x: 0, y: 0 }, acks: 1, batchSize: 100_000, lingerMs: 0, retries: 5, ...producerOverrides }],
      consumers: [],
      controllerBrokerId: 'b1',
    }
  }

  it('producer idempotent: ack-lost khiến producer resend, broker phát hiện duplicate và bỏ qua', () => {
    const sim = createKafkaSimulation({
      topology: ackLostTopology({ idempotent: true }),
      script: [{ at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'a' }],
      failures: [{ at: 0, kind: 'ack-lost', producerId: 'p1', times: 1 }],
      seed: 1,
    })

    sim.advanceTo(1000)
    const snap = sim.snapshot()

    // Record ĐÃ vào log ngay từ lần append đầu — resend do ack-lost gây ra phải
    // bị `checkSequence` chặn ở nhánh `'duplicate'`, không tạo bản ghi thứ hai.
    expect(snap.partitions[partitionKey('orders', 0)]?.log).toHaveLength(1)
    expect(snap.metrics.recordsProduced).toBe(1)
    expect(snap.metrics.duplicatesPrevented).toBe(1)
    expect(snap.metrics.retries).toBe(1)
  })

  it('producer KHÔNG idempotent: ack-lost + resend cùng fault đó tạo duplicate thật — đây là cặp đối chứng của test trên', () => {
    const sim = createKafkaSimulation({
      topology: ackLostTopology({ idempotent: false }),
      script: [{ at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'a' }],
      failures: [{ at: 0, kind: 'ack-lost', producerId: 'p1', times: 1 }],
      seed: 1,
    })

    sim.advanceTo(1000)
    const snap = sim.snapshot()

    // KHÔNG có producerId/sequence nào để broker so khớp — resend append lại vô
    // điều kiện, một duplicate THẬT. Đây chính xác là điều bài 09 phải dạy: cùng
    // một fault, cùng script, chỉ khác `idempotent`, hai kết quả khác hẳn nhau.
    expect(snap.partitions[partitionKey('orders', 0)]?.log).toHaveLength(2)
    expect(snap.metrics.recordsProduced).toBe(2)
    expect(snap.metrics.duplicatesPrevented).toBe(0)
    expect(snap.metrics.retries).toBe(1)
  })

  it('retries = 0: ack-lost KHÔNG resend — producer báo lỗi, nhưng record đã thật sự nằm trong log', () => {
    // Ngân sách retry thuộc về PRODUCER (nó không biết append đã thành công),
    // không phải broker — `retries: 0` phải tắt resend cho `ack-lost` giống hệt
    // mọi fault khác, đúng quy tắc test "retries = 0 thì lỗi là lỗi luôn" đã
    // khẳng định cho `produce-error`. Nếu `ack-lost` là một ngoại lệ âm thầm,
    // learner đặt `retries: 0` sẽ thấy resend xảy ra mà không có gì giải thích.
    const sim = createKafkaSimulation({
      topology: ackLostTopology({ idempotent: true, retries: 0 }),
      script: [{ at: 0, kind: 'produce', producerId: 'p1', topic: 'orders', key: null, value: 'a' }],
      failures: [{ at: 0, kind: 'ack-lost', producerId: 'p1', times: 1 }],
      seed: 1,
    })

    sim.advanceTo(1000)
    const snap = sim.snapshot()

    // Record VẪN nằm trong log — append đã xảy ra thật, chỉ có phản hồi bị buộc
    // mất. Producer coi lần gửi này là thất bại (không còn ngân sách retry để tự
    // xác nhận lại) dù dữ liệu đã tới nơi — phân kỳ log-vs-niềm tin-của-producer
    // đúng như comment ở `flushBatch` mô tả, không phải một bug ở test này.
    expect(snap.partitions[partitionKey('orders', 0)]?.log).toHaveLength(1)
    expect(snap.metrics.recordsProduced).toBe(1)
    expect(snap.metrics.duplicatesPrevented).toBe(0)
    expect(snap.metrics.retries).toBe(0) // không có resend nào thực sự xảy ra
  })
})
