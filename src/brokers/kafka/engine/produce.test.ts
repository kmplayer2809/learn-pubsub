import { describe, expect, it } from 'vitest'
import { estimateBytes } from './log'
import { murmur2, toPositive } from './murmur2'
import { checkIsrSufficient, enqueueRecord, flushBatch, isAckSatisfied, PRODUCE_RESPONSE_TRAVEL_MS } from './produce'
import { testState } from './testState'
import type { KafkaProducerSpec, KafkaTopicSpec } from './types'
import { partitionKey } from './types'

const orders: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 1 }
const key0 = partitionKey('orders', 0)

function producer(overrides?: Partial<KafkaProducerSpec>): KafkaProducerSpec {
  return { id: 'p1', label: 'Producer', position: { x: 0, y: 0 }, ...overrides }
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

  it('acks=all chờ mọi replica trong ISR bắt kịp', () => {
    const twoReplicaTopic: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 2, config: { minInsyncReplicas: 2 } }
    let state = testState({ topics: [twoReplicaTopic], replicas: ['b1', 'b2'] })
    const p = producer({ acks: 'all', batchSize: 100_000, lingerMs: 0 })
    state = enqueueRecord(state, { producer: p, topic: twoReplicaTopic, key: null, value: 'a', at: 0 }).state

    const { state: after, newEvents } = flushBatch(state, { producer: p, topic: twoReplicaTopic, partition: 0, at: 0 })
    // Chưa có replication thật ở plan này (Task 3's design) — mỗi append coi như
    // đã tới toàn bộ ISR ngay lập tức, nên response vẫn trả thành công không cần
    // một event chờ HW riêng.
    expect(after.partitions[key0]?.log).toHaveLength(1)
    expect(newEvents[0]).toMatchObject({ type: 'produce-response', payload: { offset: 0 } })
    expect(newEvents[0]?.payload.error).toBeUndefined()
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
