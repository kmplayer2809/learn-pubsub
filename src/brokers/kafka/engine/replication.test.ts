import { describe, expect, it } from 'vitest'
import { electLeader, expandIsr, replicaFetch, shrinkIsr } from './replication'
import { appendRecord, createPartition, recomputeHighWatermark } from './log'
import { enqueueRecord, flushBatch, PRODUCE_RESPONSE_TRAVEL_MS, resolvePendingAcks } from './produce'
import { testState } from './testState'
import { partitionKey } from './types'
import type { KafkaProducerSpec, KafkaState, KafkaTopicSpec, PartitionState } from './types'

const key0 = partitionKey('orders', 0)

function producer(overrides?: Partial<KafkaProducerSpec>): KafkaProducerSpec {
  return { id: 'p1', label: 'Producer', position: { x: 0, y: 0 }, ...overrides }
}

const orders: KafkaTopicSpec = { name: 'orders', partitions: 1, replicationFactor: 1 }

/** Partition với `values.length` record đã append, HW recomputed thật (không
 *  dùng shortcut "mọi append coi như tới ISR ngay" của `appendRecord` — xem
 *  why-comment ở `log.ts`) — điểm khởi đầu đúng cho mọi test replication. */
function withRecords(replicas: string[], leader: string, values: string[]): PartitionState {
  let p = createPartition({ topic: 'orders', index: 0, leader, replicas })
  for (const [i, v] of values.entries()) {
    p = appendRecord(p, { key: null, value: v, timestamp: i, bytes: 10 }).partition
  }
  return recomputeHighWatermark(p)
}

/** Chèn thẳng một `PartitionState` đã dựng sẵn vào state test — cùng cách
 *  `produce.test.ts` override `isr` trực tiếp. */
function withPartition(state: KafkaState, partition: PartitionState): KafkaState {
  return { ...state, partitions: { ...state.partitions, [key0]: partition } }
}

describe('replication', () => {
  it('follower fetch kéo LEO của nó lên bằng leader', () => {
    const partition = withRecords(['b1', 'b2'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    const state = withPartition(testState({ replicas: ['b1', 'b2'] }), partition)

    const result = replicaFetch(state, { brokerId: 'b2', at: 1000 })

    expect(result.state.partitions[key0]?.replicaState.b2?.leo).toBe(5)
    expect(result.state.partitions[key0]?.replicaState.b2?.lastFetchAt).toBe(1000)
  })

  it('high watermark chỉ nhích khi mọi replica trong ISR đã bắt kịp', () => {
    const partition = withRecords(['b1', 'b2', 'b3'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    const state = withPartition(testState({ replicas: ['b1', 'b2', 'b3'] }), partition)
    expect(state.partitions[key0]?.highWatermark).toBe(0) // chưa follower nào fetch

    const afterB2 = replicaFetch(state, { brokerId: 'b2', at: 100 })
    // b3 (vẫn trong ISR) chưa bắt kịp — HW vẫn kẹt ở 0 dù b2 đã lên tới 5.
    expect(afterB2.state.partitions[key0]?.highWatermark).toBe(0)

    const afterB3 = replicaFetch(afterB2.state, { brokerId: 'b3', at: 200 })
    // Mọi thành viên ISR đã bắt kịp — giờ HW mới nhích lên 5.
    expect(afterB3.state.partitions[key0]?.highWatermark).toBe(5)
  })

  it('replica chậm quá replicaLagTimeMaxMs rơi khỏi ISR', () => {
    const partition = withRecords(['b1', 'b2'], 'b1', ['a'])
    // b2 chưa từng fetch — lastFetchAt vẫn 0 (mặc định `createPartition`).
    const state = withPartition(testState({ replicas: ['b1', 'b2'] }), partition)

    const result = shrinkIsr(state, 10_001)

    expect(result.state.partitions[key0]?.isr).toEqual(['b1'])
  })

  it('shrinkIsr tôn trọng replicaLagTimeMaxMs riêng của từng broker (KafkaBrokerSpec)', () => {
    // b2 và b3 lag CÙNG một khoảng (5_000ms) — nhưng b2 được cấu hình ngưỡng
    // ngắn (2_000ms, ví dụ một broker rack gần cần phát hiện chậm sớm) còn b3
    // dùng mặc định 10_000ms. Nếu wrapper `engine/index.ts` tra đúng
    // `KafkaBrokerSpec.replicaLagTimeMaxMs` của TỪNG broker follower (không
    // phải một hằng số toàn cục), b2 phải rớt khỏi ISR còn b3 thì không —
    // đúng ngữ nghĩa `replica.lag.time.max.ms` thật của Kafka (config trên
    // broker follower, không phải trên partition).
    let partition = withRecords(['b1', 'b2', 'b3'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    partition = {
      ...partition,
      isr: ['b1', 'b2', 'b3'],
      replicaState: {
        b1: { leo: 5, lastFetchAt: 10_000 },
        b2: { leo: 5, lastFetchAt: 5_000 }, // lag 5_000ms
        b3: { leo: 5, lastFetchAt: 5_000 }, // lag 5_000ms, giống hệt b2
      },
    }
    const state = withPartition(testState({ replicas: ['b1', 'b2', 'b3'] }), partition)

    const result = shrinkIsr(state, 10_000, { b2: 2_000 }) // b3 không có override — dùng mặc định 10_000

    expect(result.state.partitions[key0]?.isr).toEqual(['b1', 'b3'])
  })

  it('ISR co lại làm high watermark nhích lên — replica chậm không còn giữ nó nữa', () => {
    let partition = withRecords(['b1', 'b2'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    partition = {
      ...partition,
      isr: ['b1', 'b2'],
      replicaState: {
        b1: { leo: 5, lastFetchAt: 20_000 },
        b2: { leo: 1, lastFetchAt: 0 }, // chậm, kéo HW xuống 1, và im lặng quá lâu
      },
    }
    partition = recomputeHighWatermark(partition)
    expect(partition.highWatermark).toBe(1) // sanity: b2 đang giữ HW thấp

    const state = withPartition(testState({ replicas: ['b1', 'b2'] }), partition)
    const result = shrinkIsr(state, 20_000)

    expect(result.state.partitions[key0]?.isr).toEqual(['b1'])
    // Phản trực giác nhưng đúng: loại b2 (đang kéo min xuống 1) ra khỏi ISR thì
    // min(LEO) trong ISR chỉ còn của b1 = 5 — HW nhích lên chứ không đứng yên.
    expect(result.state.partitions[key0]?.highWatermark).toBe(5)
  })

  it('replica bắt kịp trở lại thì vào lại ISR', () => {
    let partition = withRecords(['b1', 'b2'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    partition = {
      ...partition,
      isr: ['b1'], // b2 đã bị loại ở một vòng shrink trước đó
      replicaState: { b1: { leo: 5, lastFetchAt: 0 }, b2: { leo: 5, lastFetchAt: 900 } }, // vừa fetch xong, bắt kịp
    }
    const state = withPartition(testState({ replicas: ['b1', 'b2'] }), partition)

    const result = expandIsr(state, 1000)

    expect(result.state.partitions[key0]?.isr).toEqual(['b1', 'b2'])
  })

  it('leader chết: leader mới được bầu từ ISR, không mất record nào', () => {
    let partition = withRecords(['b1', 'b2', 'b3'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    partition = {
      ...partition,
      isr: ['b1', 'b2', 'b3'],
      replicaState: {
        b1: { leo: 5, lastFetchAt: 0 },
        b2: { leo: 5, lastFetchAt: 0 },
        b3: { leo: 5, lastFetchAt: 0 },
      },
    }
    const state = withPartition(testState({ replicas: ['b1', 'b2', 'b3'], brokersOnline: { b1: false } }), partition)

    const result = electLeader(state, { partitionKey: key0, at: 500 })

    expect(result.state.partitions[key0]?.leader).toBe('b2') // đầu tiên trong `replicas` vừa online vừa trong ISR
    expect(result.state.partitions[key0]?.leaderEpoch).toBe(1)
    expect(result.state.partitions[key0]?.log).toHaveLength(5) // không mất record nào
    expect(result.dataLoss).toBe(0)
  })

  it('ISR chỉ còn leader và leader chết, unclean tắt: partition offline, produce lỗi', () => {
    let partition = withRecords(['b1', 'b2'], 'b1', ['a'])
    partition = { ...partition, isr: ['b1'] } // b2 chưa từng bắt kịp, không trong ISR
    const state = withPartition(testState({ replicas: ['b1', 'b2'], brokersOnline: { b1: false } }), partition)

    const result = electLeader(state, { partitionKey: key0, at: 500, uncleanLeaderElection: false })

    expect(result.state.partitions[key0]?.leader).toBe('b1') // không bầu được ai — giữ nguyên
    expect(result.state.partitions[key0]?.leaderEpoch).toBe(0) // không có lần bầu nào thật sự xảy ra
    expect(result.dataLoss).toBe(0)

    // Hệ quả thật: gate `LEADER_NOT_AVAILABLE` sẵn có ở `produce.ts` bắt được
    // ngay, vì `leader` vẫn trỏ tới b1 và b1 đang offline.
    const p = producer({ acks: 1, batchSize: 100_000, lingerMs: 0 })
    const enqueued = enqueueRecord(result.state, { producer: p, topic: orders, key: null, value: 'x', at: 500 })
    const flushed = flushBatch(enqueued.state, { producer: p, topic: orders, partition: 0, at: 500 })
    expect(flushed.newEvents[0]).toMatchObject({
      type: 'produce-response',
      at: 500 + PRODUCE_RESPONSE_TRAVEL_MS,
      payload: { error: 'LEADER_NOT_AVAILABLE' },
    })
  })

  it('unclean bật: replica ngoài ISR lên làm leader và log bị cắt về LEO của nó', () => {
    let partition = withRecords(['b1', 'b2', 'b3'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    partition = {
      ...partition,
      isr: ['b1'], // chỉ leader trong ISR
      replicaState: {
        b1: { leo: 5, lastFetchAt: 0 },
        b2: { leo: 0, lastFetchAt: 0 },
        b3: { leo: 2, lastFetchAt: 0 }, // duy nhất online, tụt lại phía sau
      },
    }
    const state = withPartition(
      testState({ replicas: ['b1', 'b2', 'b3'], brokersOnline: { b1: false, b2: false, b3: true } }),
      partition,
    )

    const result = electLeader(state, { partitionKey: key0, at: 700, uncleanLeaderElection: true })

    expect(result.state.partitions[key0]?.leader).toBe('b3')
    expect(result.state.partitions[key0]?.leaderEpoch).toBe(1)
    expect(result.state.partitions[key0]?.leo).toBe(2)
    expect(result.state.partitions[key0]?.highWatermark).toBe(2)
    expect(result.state.partitions[key0]?.log).toHaveLength(2)
    expect(result.state.partitions[key0]?.isr).toEqual(['b3'])
    expect(result.dataLoss).toBeGreaterThan(0)
    expect(result.dataLoss).toBe(3) // 5 record cũ - 2 record b3 thật sự có = 3 mất
  })

  it('unclean bật: pendingAck cho offset bị cắt nhận lỗi thật NGAY lúc bầu lại, không đậu lại chờ bị hiểu nhầm', () => {
    let partition = withRecords(['b1', 'b2', 'b3'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    partition = {
      ...partition,
      isr: ['b1'], // chỉ leader trong ISR
      replicaState: {
        b1: { leo: 5, lastFetchAt: 0 },
        b2: { leo: 0, lastFetchAt: 0 },
        b3: { leo: 2, lastFetchAt: 0 }, // duy nhất online, tụt lại phía sau
      },
      // Hai acks=all đang đậu lại chờ HW bắt kịp (xem why-comment ở
      // `PartitionState.pendingAcks`, `types.ts`): offset 4 nằm trong phần log
      // SẮP bị unclean election cắt bỏ (bestLeo sẽ là 2) — đây chính là kịch
      // bản reviewer mô tả. offset 1 nằm dưới bestLeo nên sống sót.
      pendingAcks: [
        { producerId: 'p1', offset: 4, requestedAt: 650 },
        { producerId: 'p1', offset: 1, requestedAt: 600 },
      ],
    }
    const state = withPartition(
      testState({ replicas: ['b1', 'b2', 'b3'], brokersOnline: { b1: false, b2: false, b3: true } }),
      partition,
    )

    const result = electLeader(state, { partitionKey: key0, at: 700, uncleanLeaderElection: true })

    // pendingAck ở offset 4 (bị cắt) phải nhận lỗi thật NGAY, không được đậu
    // lại chờ `resolveAllPendingAcks` quét chung sau — tới lúc đó offset 4 đã
    // biến mất khỏi ý nghĩa "record thật", và append kế tiếp sẽ tái dùng đúng
    // số 2 (bestLeo), không phải 4, nên không có nguy cơ nhầm ở CHÍNH offset
    // này — nhưng nếu để mảng cũ nguyên vẹn, sai lệch xảy ra qua ngả khác (xem
    // test dưới). Ở đây ta chốt: entry offset 4 phải rời `pendingAcks` kèm một
    // response lỗi thật, không phải bị lặng lẽ xoá.
    expect(result.newEvents).toHaveLength(1)
    const [failure] = result.newEvents
    expect(failure?.type).toBe('produce-response')
    expect(failure?.payload).toMatchObject({ producerId: 'p1', topic: 'orders', partition: 0, error: 'NOT_ENOUGH_REPLICAS' })
    expect(failure?.payload.offset).toBeUndefined() // lỗi không có offset thành công đi kèm
    expect(failure?.at).toBe(700 + PRODUCE_RESPONSE_TRAVEL_MS)

    // offset 1 (< bestLeo) sống sót nguyên vẹn — vẫn đậu lại, chưa bị đụng gì
    // ở bước này, đúng "cơ chế đã có" (`resolvePendingAcks`) sẽ giải quyết nó
    // sau, không phải trách nhiệm của `electLeader`.
    expect(result.state.partitions[key0]?.pendingAcks).toEqual([{ producerId: 'p1', offset: 1, requestedAt: 600 }])
  })

  it('unclean bật: append kế tiếp tái dùng số offset vừa bị cắt không hồi sinh acks=all cũ thành công giả', () => {
    let partition = withRecords(['b1', 'b2', 'b3'], 'b1', ['a', 'b', 'c', 'd', 'e'])
    partition = {
      ...partition,
      isr: ['b1'],
      replicaState: {
        b1: { leo: 5, lastFetchAt: 0 },
        b2: { leo: 0, lastFetchAt: 0 },
        b3: { leo: 2, lastFetchAt: 0 },
      },
      // offset 4 là request gốc, bị mất thật trong unclean election.
      pendingAcks: [{ producerId: 'p-stale', offset: 4, requestedAt: 650 }],
    }
    const state = withPartition(
      testState({ replicas: ['b1', 'b2', 'b3'], brokersOnline: { b1: false, b2: false, b3: true } }),
      partition,
    )

    const elected = electLeader(state, { partitionKey: key0, at: 700, uncleanLeaderElection: true })
    // p-stale đã nhận lỗi thật ngay tại đây (xem test trên) — mảng pendingAcks
    // rỗng cho partition này từ giờ trở đi.
    expect(elected.state.partitions[key0]?.pendingAcks).toEqual([])

    // Producer mới ghi một record sau election — offset mới TÁI DÙNG đúng số 2
    // (bestLeo), số offset vừa bị cắt khỏi log cũ.
    const afterAppend = appendRecord(elected.state.partitions[key0] as PartitionState, { key: null, value: 'f', timestamp: 701, bytes: 10 })
    expect(afterAppend.offset).toBe(2) // đúng offset bị tái dùng, xác nhận kịch bản reviewer mô tả
    const caughtUp = recomputeHighWatermark(afterAppend.partition) // isr=['b3'] một mình, bắt kịp ngay
    expect(caughtUp.highWatermark).toBeGreaterThan(2)

    const stateAfterReuse = withPartition(elected.state, caughtUp)
    const resolved = resolvePendingAcks(stateAfterReuse, { partitionKey: key0, at: 701 })

    // Không có response THÀNH CÔNG nào cho p-stale — pendingAcks đã rỗng từ
    // bước election, nên `resolvePendingAcks` (cơ chế chung, không biết gì về
    // truncation) không còn gì để lặp qua và không phát sự kiện nào cho
    // partition này nữa. Trước khi sửa: entry offset 4 của p-stale còn nằm
    // trong `pendingAcks`, và once `highWatermark` vượt 4 (đúng như
    // `caughtUp.highWatermark` ở trên khi offset mới cũng leo lên đủ cao),
    // nhánh `offset < highWatermark` của `resolvePendingAcks` sẽ phát MỘT
    // `produce-response` THÀNH CÔNG giả cho `p-stale` tại offset 4 — dữ liệu
    // nó gửi đã mất thật. Assertion dưới đây khoá đúng hành vi đã sửa.
    expect(resolved.newEvents).toEqual([])
    expect(resolved.newEvents.some((e) => e.payload.producerId === 'p-stale' && e.payload.offset !== undefined)).toBe(false)
  })

  it('leaderEpoch tăng mỗi lần bầu lại', () => {
    let partition = withRecords(['b1', 'b2', 'b3'], 'b1', ['a'])
    partition = {
      ...partition,
      isr: ['b1', 'b2', 'b3'],
      replicaState: {
        b1: { leo: 1, lastFetchAt: 0 },
        b2: { leo: 1, lastFetchAt: 0 },
        b3: { leo: 1, lastFetchAt: 0 },
      },
    }
    let state = withPartition(testState({ replicas: ['b1', 'b2', 'b3'], brokersOnline: { b1: false } }), partition)
    expect(state.partitions[key0]?.leaderEpoch).toBe(0)

    const first = electLeader(state, { partitionKey: key0, at: 100 })
    expect(first.state.partitions[key0]?.leader).toBe('b2')
    expect(first.state.partitions[key0]?.leaderEpoch).toBe(1)

    // b2 (leader mới) cũng chết — bầu lại lần nữa.
    state = { ...first.state, brokersOnline: { ...first.state.brokersOnline, b2: false } }
    const second = electLeader(state, { partitionKey: key0, at: 200 })
    expect(second.state.partitions[key0]?.leader).toBe('b3')
    expect(second.state.partitions[key0]?.leaderEpoch).toBe(2)
  })

  it('leader chết: nhánh sạch dọn luôn broker chết khỏi ISR, không đợi shrinkIsr', () => {
    let partition = withRecords(['b1', 'b2', 'b3'], 'b1', ['a', 'b'])
    partition = {
      ...partition,
      isr: ['b1', 'b2', 'b3'],
      replicaState: {
        b1: { leo: 2, lastFetchAt: 0 },
        b2: { leo: 2, lastFetchAt: 0 },
        b3: { leo: 2, lastFetchAt: 0 },
      },
    }
    const state = withPartition(testState({ replicas: ['b1', 'b2', 'b3'], brokersOnline: { b1: false } }), partition)

    const result = electLeader(state, { partitionKey: key0, at: 500 })

    // b1 (vừa chết) không còn nằm lì trong ISR chờ shrinkIsr dọn 10 giây sau —
    // bầu sạch tự dọn nó ngay tại đây.
    expect(result.state.partitions[key0]?.isr).toEqual(['b2', 'b3'])
  })

  it('broker offline vẫn tự hẹn lại replica-fetch — quay lại online thì tự fetch tiếp, không cần broker-up biết gì về replication', () => {
    const partition = withRecords(['b1', 'b2'], 'b1', ['a', 'b', 'c'])
    let state = withPartition(testState({ replicas: ['b1', 'b2'], brokersOnline: { b2: false } }), partition)

    // b2 offline: không fetch được gì, nhưng vẫn phải tự hẹn lại — đây chính là
    // fix Task 8 (trước đó offline thì `newEvents` rỗng, vòng chết vĩnh viễn).
    const whileOffline = replicaFetch(state, { brokerId: 'b2', at: 100 })
    expect(whileOffline.state.partitions[key0]?.replicaState.b2?.leo).toBe(0) // không fetch được gì
    expect(whileOffline.newEvents).toHaveLength(1)
    expect(whileOffline.newEvents[0]).toMatchObject({ type: 'replica-fetch', payload: { brokerId: 'b2' } })

    // b2 quay lại online (mô phỏng `broker-up`, không đụng gì tới replication) —
    // lần fetch KẾ TIẾP (đã được vòng offline ở trên tự hẹn) chạy bình thường.
    state = { ...whileOffline.state, brokersOnline: { ...whileOffline.state.brokersOnline, b2: true } }
    const nextFetchAt = whileOffline.newEvents[0]!.at
    const afterUp = replicaFetch(state, { brokerId: 'b2', at: nextFetchAt })
    expect(afterUp.state.partitions[key0]?.replicaState.b2?.leo).toBe(3) // bắt kịp ngay khi online trở lại
  })

  it('metrics.underReplicatedPartitions đếm partition có ISR nhỏ hơn replicationFactor', () => {
    const fullyReplicated = withRecords(['b1', 'b2'], 'b1', ['a'])
    let state = testState({ replicas: ['b1', 'b2'] })
    state = withPartition(state, fullyReplicated)
    expect(state.metrics.underReplicatedPartitions).toBe(0)

    // b2 chưa từng fetch — quá hạn lag, `shrinkIsr` loại nó ra, partition trở
    // thành under-replicated (isr.length 1 < replicas.length 2).
    const result = shrinkIsr(state, 10_001)

    expect(result.state.partitions[key0]?.isr).toHaveLength(1)
    expect(result.state.metrics.underReplicatedPartitions).toBe(1)
  })
})
