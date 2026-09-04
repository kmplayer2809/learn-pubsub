import { describe, expect, it } from 'vitest'
import { appendRecord } from './log'
import { testState } from './testState'
import { abortTransaction, beginTransaction, commitTransaction, filterForIsolation, recomputeLastStableOffset } from './transaction'
import { partitionKey } from './types'
import type { KafkaState, PartitionState } from './types'

const orders = 'orders'
const key0 = partitionKey(orders, 0)
const key1 = partitionKey(orders, 1)

function getPartition(state: KafkaState, key: string): PartitionState {
  const partition = state.partitions[key]
  if (!partition) throw new Error(`test: unknown partition ${key}`)
  return partition
}

function putPartition(state: KafkaState, key: string, partition: PartitionState): KafkaState {
  return { ...state, partitions: { ...state.partitions, [key]: partition } }
}

/** Ghi thẳng một record vào log của một partition — mô phỏng đã produce xong,
 *  không đi qua `produce.ts` (Task 9 không đụng đường produce thường). */
function seedRecord(state: KafkaState, key: string, args: { value: string; txnId?: string; timestamp?: number }): KafkaState {
  const partition = getPartition(state, key)
  const { partition: next } = appendRecord(partition, {
    key: null,
    value: args.value,
    timestamp: args.timestamp ?? 0,
    bytes: 10,
    txnId: args.txnId,
  })
  return putPartition(state, key, next)
}

describe('transaction', () => {
  it('record trong transaction đang mở vẫn nằm trong log, chỉ chưa đọc được', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    expect(txnId).toBeDefined()
    state = seedRecord(state, key0, { value: 'a', txnId })

    const partition = getPartition(state, key0)
    expect(partition.log).toHaveLength(1)
    expect(partition.log[0]?.value).toBe('a')

    const withFreshLso = recomputeLastStableOffset(partition)
    const visible = filterForIsolation(withFreshLso.log, withFreshLso, 'read_committed')
    expect(visible).toEqual([])
  })

  it('lastStableOffset đứng lại ở record đầu tiên của transaction đang mở', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = seedRecord(state, key0, { value: 'a' }) // record thường trước transaction, offset 0
    state = beginTransaction(state, { producerId: 'p1', at: 1 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'b', txnId }) // offset 1, mở transaction
    state = seedRecord(state, key0, { value: 'c', txnId }) // offset 2, cùng transaction

    const partition = recomputeLastStableOffset(getPartition(state, key0))
    expect(partition.highWatermark).toBe(3) // leo = HW = 3, single-replica bắt kịp ngay
    expect(partition.lastStableOffset).toBe(1) // đứng lại ở record ĐẦU TIÊN của transaction, không phải HW
  })

  it('commit ghi control record commit và đẩy lastStableOffset lên', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'a', txnId })

    let partition = recomputeLastStableOffset(getPartition(state, key0))
    expect(partition.lastStableOffset).toBe(0) // transaction đang mở, LSO đứng ở offset 0

    state = commitTransaction(state, { producerId: 'p1', at: 5 })
    partition = getPartition(state, key0)
    expect(partition.log).toHaveLength(2) // record dữ liệu + control record commit
    const marker = partition.log[1]
    expect(marker?.control).toBe('commit')
    expect(marker?.txnId).toBe(txnId)
    expect(marker?.timestamp).toBe(5)
    expect(partition.lastStableOffset).toBe(2) // không còn transaction nào mở → = highWatermark = leo = 2
    expect(partition.highWatermark).toBe(2)
    expect(state.producers['p1']?.txnState).toBe('Empty')
    expect(state.producers['p1']?.currentTxnId).toBeUndefined()
  })

  it('abort ghi control record abort, record vẫn nằm trong log', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'a', txnId })

    state = abortTransaction(state, { producerId: 'p1', at: 5 })
    const partition = getPartition(state, key0)
    expect(partition.log).toHaveLength(2)
    expect(partition.log[0]?.value).toBe('a') // record vẫn nằm nguyên trong log
    expect(partition.log[1]?.control).toBe('abort')
    expect(partition.log[1]?.txnId).toBe(txnId)
    expect(partition.lastStableOffset).toBe(2) // đã resolve, LSO tiến lên = highWatermark
    expect(state.producers['p1']?.txnState).toBe('Empty')
  })

  it('read_committed bỏ qua record thuộc transaction đã abort', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'a', txnId })
    state = seedRecord(state, key0, { value: 'b' }) // record thường, KHÔNG thuộc transaction
    state = abortTransaction(state, { producerId: 'p1', at: 5 })

    const partition = getPartition(state, key0)
    const visible = filterForIsolation(partition.log, partition, 'read_committed')
    expect(visible.map((r) => r.value)).toEqual(['b']) // 'a' bị bỏ vì thuộc transaction abort, control record không xuất hiện
  })

  it('read_committed không đọc quá lastStableOffset', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'open', txnId }) // offset 0, transaction chưa đóng
    state = seedRecord(state, key0, { value: 'after1' }) // offset 1, SAU record đang treo
    state = seedRecord(state, key0, { value: 'after2' }) // offset 2

    const partition = recomputeLastStableOffset(getPartition(state, key0))
    expect(partition.highWatermark).toBe(3)
    expect(partition.lastStableOffset).toBe(0)

    const visible = filterForIsolation(partition.log, partition, 'read_committed')
    // Không chỉ record của transaction đang mở bị giấu — MỌI record ở offset >= LSO
    // đều chưa đọc được, kể cả 'after1'/'after2' hoàn toàn không transactional.
    expect(visible).toEqual([])
  })

  it('read_uncommitted đọc tới high watermark, thấy cả record đã abort', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'a', txnId })
    state = abortTransaction(state, { producerId: 'p1', at: 5 })
    state = seedRecord(state, key0, { value: 'b' })

    const partition = getPartition(state, key0)
    expect(partition.highWatermark).toBe(3) // record 'a' + control abort + record 'b'
    const visible = filterForIsolation(partition.log, partition, 'read_uncommitted')
    expect(visible.map((r) => r.value)).toEqual(['a', 'b']) // 'a' thấy được dù thuộc transaction đã abort
  })

  it('read_committed không bao giờ trả control record cho ứng dụng', () => {
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'a', txnId })
    state = commitTransaction(state, { producerId: 'p1', at: 5 })

    const partition = getPartition(state, key0)
    const committedVisible = filterForIsolation(partition.log, partition, 'read_committed')
    expect(committedVisible.every((r) => r.control === undefined)).toBe(true)
    expect(committedVisible.map((r) => r.value)).toEqual(['a']) // record thật thấy được, control record thì không

    const uncommittedVisible = filterForIsolation(partition.log, partition, 'read_uncommitted')
    expect(uncommittedVisible.every((r) => r.control === undefined)).toBe(true) // cả hai isolation level đều giấu control record
  })

  it('metrics.abortedRecordsSkipped đếm đúng số record bị bỏ qua', () => {
    // transaction.ts thuần không tự đụng `KafkaMetrics` — phép đếm này thuộc về
    // integration `fetchRecords` (`consume.ts`), nhưng công thức phải khớp với
    // đúng những gì `filterForIsolation` loại bỏ VÌ ABORT (không tính control
    // record, không tính phần bị cắt bởi LSO — những cái đó chưa từng "được fetch").
    let state = testState({ topics: [{ name: orders, partitions: 1, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'a', txnId })
    state = seedRecord(state, key0, { value: 'b', txnId })
    state = abortTransaction(state, { producerId: 'p1', at: 5 })
    state = seedRecord(state, key0, { value: 'c' })

    // Record thường ('c') append SAU khi transaction đã resolve — không đi qua
    // `commitTransaction`/`abortTransaction` nên không tự động làm mới LSO
    // (`partition.lastStableOffset` chỉ chắc chắn mới ngay sau lần
    // `recomputeLastStableOffset` gần nhất, xem why-comment ở `transaction.ts`).
    // `fetchRecords` (`consume.ts`) gọi lại nó NGAY TRƯỚC khi lọc — test này làm
    // đúng như vậy để phản ánh đường đi thật.
    const partition = recomputeLastStableOffset(getPartition(state, key0))
    const consumed = partition.log.filter((r) => r.offset < partition.lastStableOffset)
    const candidateVisible = consumed.filter((r) => r.control === undefined)
    const visible = filterForIsolation(consumed, partition, 'read_committed')
    const abortedSkipped = candidateVisible.length - visible.length
    expect(abortedSkipped).toBe(2) // 'a' và 'b' — cả hai thuộc transaction đã abort
    expect(visible.map((r) => r.value)).toEqual(['c'])
  })

  it('transaction trên nhiều partition commit hoặc abort cùng nhau, không nửa vời', () => {
    let state = testState({ topics: [{ name: orders, partitions: 2, replicationFactor: 1 }] })
    state = beginTransaction(state, { producerId: 'p1', at: 0 })
    const txnId = state.producers['p1']?.currentTxnId
    state = seedRecord(state, key0, { value: 'a', txnId })
    state = seedRecord(state, key1, { value: 'x', txnId })

    // Commit: CẢ HAI partition phải có control record commit, không phải chỉ một.
    const committed = commitTransaction(state, { producerId: 'p1', at: 5 })
    const p0Committed = getPartition(committed, key0)
    const p1Committed = getPartition(committed, key1)
    expect(p0Committed.log[1]?.control).toBe('commit')
    expect(p1Committed.log[1]?.control).toBe('commit')
    expect(p0Committed.lastStableOffset).toBe(p0Committed.highWatermark)
    expect(p1Committed.lastStableOffset).toBe(p1Committed.highWatermark)

    // Abort (nhánh khác, từ CÙNG state gốc): CẢ HAI partition đều abort, record vẫn còn.
    const aborted = abortTransaction(state, { producerId: 'p1', at: 5 })
    const p0Aborted = getPartition(aborted, key0)
    const p1Aborted = getPartition(aborted, key1)
    expect(p0Aborted.log[1]?.control).toBe('abort')
    expect(p1Aborted.log[1]?.control).toBe('abort')
    expect(filterForIsolation(p0Aborted.log, p0Aborted, 'read_committed')).toEqual([])
    expect(filterForIsolation(p1Aborted.log, p1Aborted, 'read_committed')).toEqual([])
  })
})
