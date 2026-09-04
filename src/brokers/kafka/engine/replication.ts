import { recomputeHighWatermark } from './log'
import { PRODUCE_RESPONSE_TRAVEL_MS } from './produce'
import { sortedPartitionKeys } from './types'
import type { KafkaEventType, KafkaState, NodeId, PartitionState } from './types'
import { nextInt } from '../../../shell/kernel/rng'
import type { SimEvent } from '../../../shell/kernel/types'

// ---------------------------------------------------------------------------
// Follower fetch, ISR membership và leader election — bốn hàm thuần dưới đây
// (`replicaFetch`, `shrinkIsr`, `expandIsr`, `electLeader`) không nhận
// `KafkaTopology` (cùng quy ước `faults.ts`/`group/coordinator.ts`: chỉ những gì
// KHÔNG suy ra được từ `state` mới đi qua tham số, còn lại tra `topology` là việc
// của thin wrapper ở `engine/index.ts`). `replicaFetchEveryMs`/`replicaLagTimeMaxMs`
// đều là config CỦA TỪNG BROKER trên `KafkaBrokerSpec`, nên cả hai hàm nhận giá
// trị đã tra sẵn qua tham số thay vì đọc `KafkaTopology` trực tiếp:
// `replicaFetch` nhận `everyMs` (một broker mỗi lời gọi, tra thẳng ở
// `applyReplicaFetch`); `shrinkIsr` quét TOÀN BỘ partition/replica trong một
// lượt — có thể chạm nhiều broker với `replicaLagTimeMaxMs` khác nhau cùng lúc
// — nên nhận `replicaLagTimeMaxMsByBroker`, một map `NodeId -> ms` do
// `applyIsrShrink` dựng từ `topology.brokers` (chỉ broker có override thật mới
// vào map). Broker không có trong map (param bỏ trống, hoặc gọi trực tiếp từ
// test không qua wrapper) dùng `DEFAULT_REPLICA_LAG_TIME_MAX_MS`.
// ---------------------------------------------------------------------------

/** `KafkaBrokerSpec.replicaFetchEveryMs` mặc định — xem doc-comment tại đó. */
const DEFAULT_REPLICA_FETCH_EVERY_MS = 200

/** Biên độ jitter cộng thêm vào mỗi chu kỳ fetch, lấy qua `nextInt` (rng.ts) —
 *  KHÔNG bao giờ tự sinh bằng `Math.random`, xem invariant xác định của kernel. */
const REPLICA_FETCH_JITTER_MS = 50

/** `KafkaBrokerSpec.replicaLagTimeMaxMs` mặc định — bằng default của Kafka thật. */
const DEFAULT_REPLICA_LAG_TIME_MAX_MS = 10_000

export interface ReplicationResult {
  state: KafkaState
  newEvents: SimEvent<KafkaEventType>[]
}

export interface ElectLeaderResult extends ReplicationResult {
  /** Số record bị cắt khỏi log do unclean leader election. `0` ở mọi nhánh khác. */
  dataLoss: number
}

// --- Tiện ích thuần nội bộ (bản riêng của file này, cùng khuôn `nextSeq` lặp
// lại ở `produce.ts`/`consume.ts`/`group/coordinator.ts` — xem why-comment ở
// nhóm placeholder trong `engine/index.ts` về kỷ luật "mỗi file giữ bản của
// riêng mình" đó). ---

function nextSeq(state: KafkaState): [number, KafkaState] {
  return [state.seq + 1, { ...state, seq: state.seq + 1 }]
}

/**
 * Đếm lại `metrics.underReplicatedPartitions` — số partition có `isr.length`
 * nhỏ hơn `replicas.length` (replicationFactor thật của partition đó, luôn bằng
 * độ dài `replicas` được `createState`/`createPartition` dựng, xem
 * `engine/index.ts`). Gọi lại toàn bộ thay vì cộng/trừ tăng dần: rẻ (partition
 * count của một lesson chỉ vài chục), và tránh một nguồn lệch nếu hai lời gọi
 * `shrinkIsr`/`expandIsr`/`electLeader` chồng lên cùng partition trong cùng một
 * lượt kernel.
 *
 * Exported (Task 8): `engine/index.ts`'s `applyBrokerDown` cũng tự tay chỉnh
 * `isr` (loại broker vừa down ra khỏi ISR của mọi partition nó là follower,
 * NGAY tại thời điểm down thay vì chờ `shrinkIsr`'s quét theo
 * `replicaLagTimeMaxMs`) nên cần gọi lại đúng hàm này, không viết lại một bản
 * đếm khác.
 */
export function withUnderReplicatedMetric(state: KafkaState): KafkaState {
  let count = 0
  for (const key of sortedPartitionKeys(state)) {
    const partition = state.partitions[key]
    if (!partition) continue
    if (partition.isr.length < partition.replicas.length) count++
  }
  if (count === state.metrics.underReplicatedPartitions) return state
  return { ...state, metrics: { ...state.metrics, underReplicatedPartitions: count } }
}

// ---------------------------------------------------------------------------
// replicaFetch
// ---------------------------------------------------------------------------

/**
 * Một broker follower kéo (fetch) tới LEO hiện tại của leader cho MỌI partition
 * mà nó có mặt trong `replicas` (trừ chính partition nó đang là leader — leader
 * không tự fetch từ chính mình). Vì engine này giữ đúng MỘT bản `log`/`leo` cho
 * mỗi partition (bản của leader — followers không có bản log vật lý riêng, xem
 * why-comment ở `log.ts`), "fetch" ở đây chỉ đơn giản là kéo
 * `replicaState[brokerId].leo` lên bằng `partition.leo` — không có gì để copy
 * thêm. Sau mỗi partition được fetch, `recomputeHighWatermark` chạy lại ngay,
 * đúng thứ tự Step 3 yêu cầu.
 *
 * Tự hẹn lại `replica-fetch` kế tiếp SAU `everyMs` (mặc định
 * `DEFAULT_REPLICA_FETCH_EVERY_MS`, wrapper `engine/index.ts` truyền giá trị
 * tra từ `KafkaBrokerSpec.replicaFetchEveryMs` khi có) CỘNG một jitter
 * `[0, REPLICA_FETCH_JITTER_MS)` rút qua `nextInt(state.rng, …)` — bắt buộc đi
 * qua RNG thuần của kernel, không tự sinh số ngẫu nhiên (xem CLAUDE.md,
 * "Determinism"). Đây là điểm DUY NHẤT trong toàn bộ engine Kafka hiện tại đọc
 * `state.rng` (cấp cluster) thay vì `ProducerRuntime.rng` (cấp producer) — mỗi
 * broker fetch dùng chung một dòng RNG toàn cục, không cần seed lệch theo
 * broker vì thứ tự các `replica-fetch` của các broker khác nhau được kernel
 * (scheduler theo `(at, seq)`) sắp xếp xác định, không phụ thuộc việc RNG có
 * "song song" hay không.
 *
 * Broker đang offline: không fetch được gì (an toàn no-op cho `partitions`)
 * nhưng vẫn TỰ HẸN LẠI như bình thường — Task 8 (fix round, mirroring bug lớp
 * `member-timeout` một reviewer trước đã bắt): bản trước KHÔNG hẹn lại khi
 * offline, nghĩa là một khi broker rớt, vòng fetch của NÓ chết vĩnh viễn, kể
 * cả sau khi `broker-up` đưa nó trở lại — không có gì trong `applyBrokerUp`
 * (`engine/index.ts`, không đổi ở Task 8) biết cách khởi động lại một vòng
 * fetch cho đúng broker đó. Giữ vòng SỐNG (chỉ bỏ qua phần VIỆC fetch, không
 * bỏ qua việc HẸN LẠI) là cách đơn giản nhất: một khi `brokersOnline[brokerId]`
 * trở lại `true`, lần tự hẹn KẾ TIẾP (chậm nhất `everyMs` sau đó) tự nhiên fetch
 * lại bình thường — không cần `broker-up` biết bất kỳ điều gì về replication.
 * Không tốn thêm sự kiện nào so với trước cho lesson KHÔNG bao giờ down broker
 * này (vòng vẫn chỉ tự hẹn đúng một lần mỗi `everyMs` như cũ).
 */
export function replicaFetch(
  state: KafkaState,
  args: { brokerId: NodeId; at: number; everyMs?: number },
): ReplicationResult {
  const { brokerId, at } = args
  const everyMs = args.everyMs ?? DEFAULT_REPLICA_FETCH_EVERY_MS

  let partitions = state.partitions
  if (state.brokersOnline[brokerId] !== false) {
    for (const key of sortedPartitionKeys(state)) {
      const partition = partitions[key]
      if (!partition) continue
      if (partition.leader === brokerId) continue // leader không fetch từ chính mình
      if (!partition.replicas.includes(brokerId)) continue

      const updated: PartitionState = {
        ...partition,
        replicaState: { ...partition.replicaState, [brokerId]: { leo: partition.leo, lastFetchAt: at } },
      }
      partitions = { ...partitions, [key]: recomputeHighWatermark(updated) }
    }
  }

  const [jitter, nextRng] = nextInt(state.rng, REPLICA_FETCH_JITTER_MS)
  const [seq, afterSeq] = nextSeq({ ...state, partitions, rng: nextRng })
  const nextFetch: SimEvent<KafkaEventType> = {
    at: at + everyMs + jitter,
    seq,
    type: 'replica-fetch',
    payload: { brokerId, everyMs },
  }
  return { state: afterSeq, newEvents: [nextFetch] }
}

// ---------------------------------------------------------------------------
// shrinkIsr / expandIsr
// ---------------------------------------------------------------------------

/**
 * Quét TOÀN BỘ partition (không nhận `brokerId`/`partitionKey` riêng): loại
 * khỏi ISR bất kỳ follower nào có
 * `at - replicaState[id].lastFetchAt > replicaLagTimeMaxMsByBroker[id]` —
 * ngưỡng của TỪNG BROKER (mặc định `DEFAULT_REPLICA_LAG_TIME_MAX_MS` nếu
 * broker đó không có trong map), đúng ngữ nghĩa `replica.lag.time.max.ms` thật
 * của Kafka: đây là config trên broker follower, không phải trên partition hay
 * trên leader. Leader LUÔN được giữ lại bất kể `lastFetchAt` của chính nó —
 * leader không "fetch" nên `replicaState[leader].lastFetchAt` chỉ cập nhật mỗi
 * lần append (xem `log.ts`'s `appendRecord`), có thể "cũ" một cách vô hại nếu
 * không có produce nào gần đây; liveness của leader là việc của
 * `brokersOnline`/`electLeader`, không phải của hàm này.
 *
 * Loại xong một partition thì gọi `recomputeHighWatermark` NGAY, SAU khi đã
 * cập nhật `isr` — thứ tự này cố ý: một replica chậm bị loại khỏi ISR không
 * còn được tính vào `min(LEO)` nữa, nên HW có thể NHÍCH LÊN ngay tại đây (test
 * "ISR co lại làm HW nhích lên" chốt đúng thứ tự shrink-rồi-mới-recompute).
 */
export function shrinkIsr(
  state: KafkaState,
  at: number,
  replicaLagTimeMaxMsByBroker?: Record<NodeId, number>,
): ReplicationResult {
  let partitions = state.partitions
  let changed = false

  for (const key of sortedPartitionKeys(state)) {
    const partition = partitions[key]
    if (!partition) continue

    const kept = partition.isr.filter((id) => {
      if (id === partition.leader) return true
      const rs = partition.replicaState[id]
      if (!rs) return true // chưa từng có replicaState — không đủ căn cứ để loại
      const lagTimeMaxMs = replicaLagTimeMaxMsByBroker?.[id] ?? DEFAULT_REPLICA_LAG_TIME_MAX_MS
      return at - rs.lastFetchAt <= lagTimeMaxMs
    })
    if (kept.length === partition.isr.length) continue

    changed = true
    const shrunk: PartitionState = { ...partition, isr: kept }
    partitions = { ...partitions, [key]: recomputeHighWatermark(shrunk) }
  }

  if (!changed) return { state, newEvents: [] }

  const next = withUnderReplicatedMetric({
    ...state,
    partitions,
    journal: [...state.journal, { at, type: 'isr-shrink', text: 'ISR co lại — một hoặc nhiều replica rớt vì fetch chậm quá hạn' }],
  })
  return { state: next, newEvents: [] }
}

/**
 * Ngược lại `shrinkIsr`: một replica ĐANG NGOÀI ISR mà đã bắt kịp hoàn toàn
 * (`replicaState[id].leo >= partition.leo`, tức bằng LEO hiện tại của leader —
 * không chỉ bằng high watermark) VÀ đang online thì được thêm lại vào ISR.
 * `recomputeHighWatermark` chạy lại sau mỗi partition có thay đổi — thêm một
 * replica đã bắt kịp không bao giờ làm HW tụt (LEO của nó >= HW cũ), nhưng vẫn
 * chạy đều để giữ bất biến "ISR đổi thì HW luôn được recompute ngay sau đó" ở
 * cả hai hàm.
 */
export function expandIsr(state: KafkaState, at: number): ReplicationResult {
  let partitions = state.partitions
  let changed = false

  for (const key of sortedPartitionKeys(state)) {
    const partition = partitions[key]
    if (!partition) continue

    const rejoining = partition.replicas.filter((id) => {
      if (partition.isr.includes(id)) return false
      if (state.brokersOnline[id] === false) return false
      const rs = partition.replicaState[id]
      return (rs?.leo ?? 0) >= partition.leo
    })
    if (rejoining.length === 0) continue

    changed = true
    const expanded: PartitionState = { ...partition, isr: [...partition.isr, ...rejoining] }
    partitions = { ...partitions, [key]: recomputeHighWatermark(expanded) }
  }

  if (!changed) return { state, newEvents: [] }

  const next = withUnderReplicatedMetric({
    ...state,
    partitions,
    journal: [...state.journal, { at, type: 'isr-expand', text: 'ISR nới rộng — một hoặc nhiều replica đã bắt kịp trở lại' }],
  })
  return { state: next, newEvents: [] }
}

// ---------------------------------------------------------------------------
// electLeader
// ---------------------------------------------------------------------------

/**
 * Bầu leader mới cho MỘT partition (`args.partitionKey`).
 *
 * Nhánh sạch (clean): ứng viên đầu tiên trong `partition.replicas` (thứ tự đã
 * ổn định từ lúc dựng cluster, xem `engine/index.ts`'s `createState`) vừa CÓ
 * MẶT trong ISR vừa đang online. ISR đảm bảo nó đã bắt kịp tới ít nhất high
 * watermark, nên không mất gì mà consumer từng thấy được — `dataLoss = 0`,
 * không đụng `log`. Chỉ tăng `leaderEpoch` khi thật sự có người được bầu.
 *
 * Task 8: nhánh sạch NHÂN TIỆN lọc khỏi `isr` mọi thành viên đang OFFLINE
 * (gồm chính leader vừa chết) — trước đây `isr` giữ nguyên, để lại một broker
 * đã chết nằm lì trong ISR cho tới khi `shrinkIsr`'s quét theo
 * `replicaLagTimeMaxMs` (mặc định 10s) dọn nó, một độ trễ không cần thiết
 * ngay tại chính thời điểm ta VỪA xác nhận nó chết. Không đụng gì tới việc
 * "ai được bầu" — chỉ dọn sạch state đã biết chắc là stale ngay lúc đang sửa
 * `isr` cho partition này.
 *
 * Không còn ứng viên sạch (ISR rỗng hoặc mọi thành viên ISR đều offline):
 *   - `uncleanLeaderElection` tắt (mặc định): KHÔNG bầu ai. `partition.leader`
 *     GIỮ NGUYÊN — thường vẫn đang trỏ tới broker vừa chết, và gate
 *     `LEADER_NOT_AVAILABLE` đã có sẵn ở `produce.ts`
 *     (`state.brokersOnline[partitionState.leader] === false`) tự nhiên bắt
 *     được điều đó mà không cần đổi kiểu `PartitionState.leader` sang
 *     `NodeId | null`. Cân nhắc có chủ đích: nới kiểu đó sẽ lan sang
 *     `log.ts`'s `appendRecord` (index `replicaState` bằng `partition.leader`)
 *     và một số chỗ dựng cạnh canvas ở `ui/toFlow.ts` — hai khu vực ngoài phạm
 *     vi bốn file task này chạm tới, và log.ts's why-comment đã ghi rõ việc nối
 *     append thật vào replication là việc của "một plan sau" (Task 8), không
 *     phải Task 6.
 *   - `uncleanLeaderElection` bật: chọn, trong TOÀN BỘ `replicas` (không chỉ
 *     ISR), replica ONLINE có `replicaState[id].leo` cao nhất (hoà thì ưu tiên
 *     theo thứ tự `replicas`, xác định). Đó có thể là log NGẮN HƠN log hiện tại
 *     của partition — cắt `log`/`leo`/`highWatermark` về đúng LEO của nó,
 *     `dataLoss` = số record bị cắt thật (đếm bằng độ dài mảng, không phải hiệu
 *     hai con số offset — an toàn với gap do retention). ISR reset về đúng
 *     `[leader mới]`: chưa ai khác được xác nhận đã bắt kịp log (đã bị cắt)
 *     này.
 */
export function electLeader(
  state: KafkaState,
  args: { partitionKey: string; at: number; uncleanLeaderElection?: boolean },
): ElectLeaderResult {
  const { partitionKey: key, at } = args
  const uncleanLeaderElection = args.uncleanLeaderElection ?? false
  const partition = state.partitions[key]
  if (!partition) return { state, newEvents: [], dataLoss: 0 }

  const isOnline = (id: NodeId): boolean => state.brokersOnline[id] !== false

  const cleanCandidate = partition.replicas.find((id) => partition.isr.includes(id) && isOnline(id))
  if (cleanCandidate !== undefined) {
    const prunedIsr = partition.isr.filter((id) => isOnline(id))
    const elected: PartitionState = { ...partition, leader: cleanCandidate, leaderEpoch: partition.leaderEpoch + 1, isr: prunedIsr }
    const next = withUnderReplicatedMetric({
      ...state,
      partitions: { ...state.partitions, [key]: elected },
      journal: [
        ...state.journal,
        { at, type: 'leader-election', text: `${key}: bầu lại leader ${cleanCandidate} (epoch ${elected.leaderEpoch})`, nodeId: cleanCandidate },
      ],
    })
    return { state: next, newEvents: [], dataLoss: 0 }
  }

  if (!uncleanLeaderElection) {
    const next: KafkaState = {
      ...state,
      journal: [
        ...state.journal,
        { at, type: 'leader-election', text: `${key}: không còn ISR online và unclean tắt — partition không có leader`, nodeId: partition.leader },
      ],
    }
    return { state: next, newEvents: [], dataLoss: 0 }
  }

  let best: NodeId | undefined
  let bestLeo = -1
  for (const id of partition.replicas) {
    if (!isOnline(id)) continue
    const leo = partition.replicaState[id]?.leo ?? 0
    if (leo > bestLeo) {
      best = id
      bestLeo = leo
    }
  }
  if (best === undefined) {
    const next: KafkaState = {
      ...state,
      journal: [...state.journal, { at, type: 'leader-election', text: `${key}: mọi replica offline — không thể bầu, kể cả unclean`, nodeId: partition.leader }],
    }
    return { state: next, newEvents: [], dataLoss: 0 }
  }

  const truncatedLog = partition.log.filter((entry) => entry.offset < bestLeo)
  const dataLoss = partition.log.length - truncatedLog.length

  // Post-review fix: một `PendingAck` (`produce.ts`) đang đậu ở partition này
  // với `offset >= bestLeo` trỏ tới đúng record vừa bị cắt khỏi `truncatedLog`
  // — và offset đó sẽ bị TÁI SỬ DỤNG bởi lần `appendRecord` kế tiếp, vì offset
  // mới luôn bắt đầu từ `partition.leo`, vừa đặt lại thành `bestLeo` ngay dưới
  // đây. `resolvePendingAcks` (`produce.ts`) chỉ so `pending.offset <
  // partition.highWatermark` — không biết gì về việc log đã bị cắt — nên nếu
  // để entry này đậu lại, một khi record ghi đè đúng số offset đó được ack sau
  // này, nó sẽ trả THÀNH CÔNG giả cho producer gốc dù dữ liệu producer đó gửi
  // đã mất thật, phá đúng bảo đảm "acks=all không bao giờ nói dối" mà cả
  // `pendingAcks` tồn tại để giữ. Phải chốt lỗi NGAY tại đây, tại đúng thời
  // điểm truncation xảy ra — trước khi số offset đó có cơ hội bị tái dùng —
  // chứ không thể chờ `resolveAllPendingAcks` quét chung sau election
  // (`engine/index.ts`'s `applyLeaderElection`), vì tới lúc đó thông tin
  // "offset này đã bị cắt" không còn cách nào phục hồi được nữa (`PendingAck`
  // không mang `leaderEpoch`/generation marker nào để tự phát hiện chuyện này).
  // Entry với `offset < bestLeo` (đã có tới `bestLeo`) sống sót nguyên vẹn —
  // vẫn resolve bình thường qua cơ chế chung khi HW bắt kịp, không đụng gì ở
  // đây.
  const strandedPendingAcks = partition.pendingAcks.filter((pending) => pending.offset >= bestLeo)
  const survivingPendingAcks = partition.pendingAcks.filter((pending) => pending.offset < bestLeo)

  let working = state
  const strandedEvents: SimEvent<KafkaEventType>[] = []
  for (const pending of strandedPendingAcks) {
    const [seq, afterSeq] = nextSeq(working)
    working = afterSeq
    strandedEvents.push({
      at: at + PRODUCE_RESPONSE_TRAVEL_MS,
      seq,
      type: 'produce-response',
      payload: { producerId: pending.producerId, topic: partition.topic, partition: partition.index, error: 'NOT_ENOUGH_REPLICAS' },
    })
  }

  const elected: PartitionState = {
    ...partition,
    leader: best,
    leaderEpoch: partition.leaderEpoch + 1,
    log: truncatedLog,
    leo: bestLeo,
    highWatermark: bestLeo,
    isr: [best],
    replicaState: { ...partition.replicaState, [best]: { leo: bestLeo, lastFetchAt: at } },
    pendingAcks: survivingPendingAcks,
  }
  const next = withUnderReplicatedMetric({
    ...working,
    partitions: { ...working.partitions, [key]: elected },
    journal: [
      ...working.journal,
      { at, type: 'leader-election', text: `${key}: unclean election — leader mới ${best}, mất ${dataLoss} record`, nodeId: best },
    ],
  })
  return { state: next, newEvents: strandedEvents, dataLoss }
}
