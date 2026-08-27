import { describe, expect, it } from 'vitest'
import { appendRecord } from './log'
import { applyPause, applyResume, applySeek, fetchRecords, resolvePosition } from './consume'
import { testState } from './testState'
import { partitionKey } from './types'
import type { ConsumerRuntime, KafkaConsumerSpec, KafkaState } from './types'

const orders = 'orders'
const key0 = partitionKey(orders, 0)
const key1 = partitionKey(orders, 1)

function consumerSpec(overrides?: Partial<KafkaConsumerSpec>): KafkaConsumerSpec {
  return { id: 'c1', label: 'Consumer', position: { x: 0, y: 0 }, groupId: 'g1', subscriptions: [orders], ...overrides }
}

function withConsumer(state: KafkaState, id: string, overrides?: Partial<ConsumerRuntime>): KafkaState {
  return { ...state, consumers: { ...state.consumers, [id]: { position: {}, paused: [], lastPollAt: 0, ...overrides } } }
}

/** Nối thêm `values.length` record vào log của một partition, offset tăng dần từ `leo` hiện có. */
function seed(state: KafkaState, key: string, values: string[], startAt = 0): KafkaState {
  const partition = state.partitions[key]
  if (!partition) throw new Error(`test: unknown partition ${key}`)
  let p = partition
  let t = startAt
  for (const value of values) {
    p = appendRecord(p, { key: null, value, timestamp: t, bytes: 10 }).partition
    t += 1
  }
  return { ...state, partitions: { ...state.partitions, [key]: p } }
}

describe('consume', () => {
  it('consumer chưa có position, auto.offset.reset=earliest thì bắt đầu từ logStartOffset', () => {
    expect(resolvePosition({ logStartOffset: 5, highWatermark: 10, autoOffsetReset: 'earliest' })).toBe(5)
  })

  it('consumer chưa có position, auto.offset.reset=latest thì bắt đầu từ high watermark — bỏ qua mọi record cũ', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = seed(state, key0, ['a', 'b', 'c']) // leo = HW = 3, đều là record "cũ"
    state = withConsumer(state, 'c1')

    const c = consumerSpec({ autoOffsetReset: 'latest' })
    const first = fetchRecords(state, { consumer: c, at: 0 })
    expect(first.records).toEqual([]) // resolvePosition trả HW = 3, không có gì mới ở đó

    // Record mới xuất hiện sau khi đã "chốt" position ở lần poll đầu.
    const withNewRecord = seed(first.state, key0, ['d'], 3)
    const second = fetchRecords(withNewRecord, { consumer: c, at: 10 })
    expect(second.records.map((r) => r.value)).toEqual(['d'])
  })

  it('position rơi dưới logStartOffset (retention đã xoá) thì reset theo auto.offset.reset', () => {
    expect(resolvePosition({ position: 2, logStartOffset: 5, highWatermark: 10, autoOffsetReset: 'earliest' })).toBe(5)
    expect(resolvePosition({ position: 2, logStartOffset: 5, highWatermark: 10, autoOffsetReset: 'latest' })).toBe(10)
  })

  it('fetch trả tối đa maxPollRecords record một lần', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = seed(state, key0, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
    state = withConsumer(state, 'c1')

    const c = consumerSpec({ maxPollRecords: 3, autoOffsetReset: 'earliest' })
    const { records } = fetchRecords(state, { consumer: c, at: 0 })
    expect(records).toHaveLength(3)
    expect(records.map((r) => r.offset)).toEqual([0, 1, 2])
  })

  it('fetch không bao giờ vượt quá high watermark', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = seed(state, key0, ['a', 'b', 'c', 'd', 'e']) // leo = HW = 5 (single-replica bắt kịp ngay)
    // Giả lập replica chưa bắt kịp: HW tụt lại sau leo, đúng cảnh log.test.ts dùng.
    const partition = state.partitions[key0]
    if (!partition) throw new Error('test: missing partition')
    state = { ...state, partitions: { ...state.partitions, [key0]: { ...partition, highWatermark: 2 } } }
    state = withConsumer(state, 'c1')

    const c = consumerSpec({ maxPollRecords: 100, autoOffsetReset: 'earliest' })
    const { records } = fetchRecords(state, { consumer: c, at: 0 })
    expect(records).toHaveLength(2)
    expect(records.every((r) => r.offset < 2)).toBe(true)
  })

  it('partition đang pause thì không fetch, partition khác vẫn chạy', () => {
    let state = testState({ topics: [{ name: orders, partitions: 2, replicationFactor: 1 }] })
    state = seed(state, key0, ['a', 'b'])
    state = seed(state, key1, ['x', 'y'])
    state = withConsumer(state, 'c1')
    state = applyPause(state, { consumerId: 'c1', topic: orders, partition: 0 })

    const c = consumerSpec({ autoOffsetReset: 'earliest' })
    const { state: after, records } = fetchRecords(state, { consumer: c, at: 0 })
    expect(records.every((r) => r.value === 'x' || r.value === 'y')).toBe(true)
    expect(records).toHaveLength(2) // chỉ partition 1, partition 0 bị bỏ qua hoàn toàn
    expect(after.consumers['c1']?.position[key0]).toBeUndefined() // pause: position không hề bị đụng

    const resumed = applyResume(after, { consumerId: 'c1', topic: orders, partition: 0 })
    const next = fetchRecords(resumed, { consumer: c, at: 1 })
    expect(next.records.map((r) => r.value)).toEqual(['a', 'b'])
  })

  it('seek đặt lại position, lần fetch sau đọc từ đúng chỗ đó', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = seed(state, key0, ['a', 'b', 'c', 'd', 'e'])
    state = withConsumer(state, 'c1')
    state = applySeek(state, { consumerId: 'c1', topic: orders, partition: 0, offset: 2 })

    const c = consumerSpec({ autoOffsetReset: 'earliest' })
    const { records } = fetchRecords(state, { consumer: c, at: 0 })
    expect(records.map((r) => r.value)).toEqual(['c', 'd', 'e'])
  })

  it('seek tới "earliest"/"latest" phân giải qua đúng logStartOffset/highWatermark', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = seed(state, key0, ['a', 'b', 'c'])
    // Giả lập retention đã xoá offset 0 — logStartOffset lệch khỏi 0, để phân biệt
    // rõ với việc "earliest" tình cờ trùng 0.
    const partition = state.partitions[key0]
    if (!partition) throw new Error('test: missing partition')
    state = { ...state, partitions: { ...state.partitions, [key0]: { ...partition, logStartOffset: 1 } } }
    state = withConsumer(state, 'c1')

    const toEarliest = applySeek(state, { consumerId: 'c1', topic: orders, partition: 0, offset: 'earliest' })
    expect(toEarliest.consumers['c1']?.position[key0]).toBe(1)

    const toLatest = applySeek(state, { consumerId: 'c1', topic: orders, partition: 0, offset: 'latest' })
    expect(toLatest.consumers['c1']?.position[key0]).toBe(3)
  })

  it('fetch xong sinh event process-done ở at + processingMs', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = seed(state, key0, ['a'])
    state = withConsumer(state, 'c1')

    const c = consumerSpec({ autoOffsetReset: 'earliest', processingMs: 250 })
    const { newEvents } = fetchRecords(state, { consumer: c, at: 100 })
    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]).toMatchObject({ type: 'process-done', at: 350, payload: { consumerId: 'c1', count: 1 } })
  })

  it('fetch rỗng không sinh event process-done', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = withConsumer(state, 'c1')

    const c = consumerSpec({ autoOffsetReset: 'earliest', processingMs: 250 })
    const { newEvents, records } = fetchRecords(state, { consumer: c, at: 100 })
    expect(records).toEqual([])
    expect(newEvents).toEqual([])
  })

  it('partition bị đói ngân sách nhiều lần liên tiếp không mất record đến trong lúc đói (auto.offset.reset=latest)', () => {
    // orders-0 có sẵn backlog 10 record, seek về 0 — nó luôn có việc để đọc và
    // luôn xếp trước orders-1 trong sortedPartitionKeys ("orders-0" < "orders-1").
    // orders-1 chưa có position, autoOffsetReset=latest. maxPollRecords=3 nhỏ hơn
    // backlog của orders-0 nên vài lần poll liên tiếp orders-0 ăn hết ngân sách,
    // orders-1 hoàn toàn "đói" — không lần nào readFrom được gọi trên nó.
    let state = testState({ topics: [{ name: orders, partitions: 2, replicationFactor: 1 }] })
    state = seed(state, key0, Array.from({ length: 10 }, (_, i) => `o0-${i}`))
    state = withConsumer(state, 'c1')
    state = applySeek(state, { consumerId: 'c1', topic: orders, partition: 0, offset: 0 })

    const c = consumerSpec({ maxPollRecords: 3, autoOffsetReset: 'latest' })

    // Ba lần poll đầu: orders-0 (10 record, budget 3/lần) ăn hết ngân sách mỗi
    // lần — orders-1 chưa từng được resolvePosition chạm tới.
    let s = state
    for (let i = 0; i < 3; i++) {
      s = fetchRecords(s, { consumer: c, at: i }).state
    }

    // Record tới trong lúc orders-1 còn đang đói — phải còn nguyên khi tới lượt,
    // không được coi là "cũ" chỉ vì orders-1 chưa từng được đọc.
    s = seed(s, key1, ['p1-a', 'p1-b', 'p1-c', 'p1-d', 'p1-e'])

    // Lần poll thứ tư: orders-0 chỉ còn 1 record (offset 9), dư 2 đơn vị ngân
    // sách cho orders-1 — lần đầu tiên orders-1 thực sự được đọc.
    const fourth = fetchRecords(s, { consumer: c, at: 3 })
    const p1Records = fourth.records.filter((r) => r.value?.startsWith('p1-'))
    expect(p1Records.map((r) => r.value)).toEqual(['p1-a', 'p1-b'])
  })

  it('metrics.recordsConsumed tăng đúng bằng số record giao đi', () => {
    let state = testState({ topics: [{ name: orders, partitions: 2, replicationFactor: 1 }] })
    state = seed(state, key0, ['a', 'b'])
    state = seed(state, key1, ['x'])
    state = withConsumer(state, 'c1')

    const c = consumerSpec({ autoOffsetReset: 'earliest' })
    const { state: after, records } = fetchRecords(state, { consumer: c, at: 0 })
    expect(records).toHaveLength(3)
    expect(after.metrics.recordsConsumed).toBe(state.metrics.recordsConsumed + 3)
  })
})
