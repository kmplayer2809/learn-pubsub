import type { InFlight, KernelState } from '../../../shell/kernel/types'
import type { RngState } from '../../../shell/kernel/rng'

export type NodeId = string

export interface XY {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// Topology — immutable input, shared by reference across every run (see
// `emptyTopology` and the frozen lesson node singletons in `lessons/types.ts`).
// ---------------------------------------------------------------------------

export interface KafkaTopology {
  brokers: KafkaBrokerSpec[]
  topics: KafkaTopicSpec[]
  producers: KafkaProducerSpec[]
  consumers: KafkaConsumerSpec[]
  controllerBrokerId: NodeId
}

export interface KafkaBrokerSpec {
  id: NodeId
  label: string
  position: XY
  rack?: string
  /** Follower fetch bao lâu một lần (thời gian ảo). Mặc định 200ms, cộng jitter qua `rng.ts`. */
  replicaFetchEveryMs?: number
  /** Follower im lặng quá lâu thì rơi khỏi ISR. Mặc định 10_000ms — bằng default của Kafka thật. */
  replicaLagTimeMaxMs?: number
}

export interface KafkaTopicSpec {
  name: string
  partitions: number
  replicationFactor: number
  config?: {
    retentionMs?: number
    retentionBytes?: number
    segmentMs?: number
    segmentBytes?: number
    cleanupPolicy?: 'delete' | 'compact'
    minInsyncReplicas?: number
    /** Bật thì cho bầu leader ngoài ISR khi ISR rỗng — đổi mất dữ liệu lấy tính sẵn sàng.
     *  Mặc định `false`, đúng default của Kafka từ 0.11. Bài 19 bật nó lên để dạy hậu quả. */
    uncleanLeaderElection?: boolean
  }
}

export interface KafkaProducerSpec {
  id: NodeId
  label: string
  position: XY
  acks?: 0 | 1 | 'all' // mặc định 'all'
  retries?: number
  maxInFlight?: number // max.in.flight.requests.per.connection, mặc định 5
  idempotent?: boolean
  transactionalId?: string
  lingerMs?: number
  batchSize?: number // bytes
  partitioner?: 'default' | 'round-robin' | 'sticky'
  compression?: 'none' | 'gzip' | 'lz4' // chỉ ảnh hưởng bytes ước lượng, không nén thật
}

export interface KafkaConsumerSpec {
  id: NodeId
  label: string
  position: XY
  groupId: string
  subscriptions: string[]
  autoOffsetReset?: 'earliest' | 'latest'
  enableAutoCommit?: boolean
  autoCommitIntervalMs?: number
  maxPollRecords?: number
  sessionTimeoutMs?: number
  maxPollIntervalMs?: number
  /** Coordinator chờ bao lâu để gom member trong một vòng rebalance. Bỏ trống thì lấy
   *  `maxPollIntervalMs` — đúng cách Kafka thật mặc định `rebalance.timeout.ms`. */
  rebalanceTimeoutMs?: number
  processingMs?: number // thời gian ảo xử lý mỗi record
  isolationLevel?: 'read_uncommitted' | 'read_committed'
  /**
   * Chỉ có hiệu lực khi consumer này là NGƯỜI TẠO group (`joinGroup`,
   * `group/coordinator.ts`) — join vào một group đã tồn tại luôn dùng lại
   * assignor group đã chọn, một consumer group thật không cho từng member tự
   * chọn assignor khác nhau. Không khai kiểu qua `AssignorName` (import từ
   * `./group/assignors`) để tránh vòng import types.ts → group/assignors.ts →
   * types.ts — lặp lại đúng union literal `GroupState.assignor` đã dùng ở
   * dưới. Bỏ trống thì mặc định `'range'` — đúng hành vi "naive" Task 1 trước
   * khi có coordinator thật, giữ nguyên cho lesson/test không set gì khác.
   */
  assignor?: 'range' | 'round-robin' | 'sticky' | 'cooperative-sticky'
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface KafkaState extends KernelState {
  partitions: Record<string, PartitionState> // key `${topic}-${partition}`, xem `partitionKey`
  groups: Record<string, GroupState>
  producers: Record<NodeId, ProducerRuntime>
  consumers: Record<NodeId, ConsumerRuntime>
  brokersOnline: Record<NodeId, boolean>
  controller: { brokerId: NodeId; epoch: number }
  metrics: KafkaMetrics
  inFlight: InFlight[]
  // Bộ đếm cấp `producerId` số cho `assignProducerId` (`produce.ts`) — mô phỏng
  // InitProducerId thật của Kafka. Sống ở `KafkaState` (không phải trong từng
  // `ProducerRuntime`) vì producerId phải DUY NHẤT trên toàn cluster, không chỉ
  // trong phạm vi một producer node — hai producer node khác nhau không bao giờ
  // được cấp trùng số, kể cả khi chúng gọi `assignProducerId` cùng một `at`.
  nextProducerId: number
}

export interface PartitionState {
  topic: string
  index: number
  leader: NodeId
  replicas: NodeId[]
  isr: NodeId[]
  log: LogEntry[]
  logStartOffset: number // tăng khi retention xoá segment
  leo: number // log end offset
  highWatermark: number // min(LEO của mọi replica trong ISR)
  lastStableOffset: number // cho read_committed
  replicaState: Record<NodeId, { leo: number; lastFetchAt: number }>
  segments: { baseOffset: number; bytes: number; createdAt: number; sealed: boolean }[]
  leaderEpoch: number
  // Task 8: `acks=all` mà `isAckSatisfied` (`produce.ts`) trả `false` ngay sau
  // append (HW chưa vượt offset vừa ghi — nay là sự thật thật, không còn
  // `appendRecord` fake catch-up) không còn cách nào trả lời NGAY — request bị
  // "đậu" lại đây thay vì rớt một `produce-response` với payload rỗng vô nghĩa.
  // `resolvePendingAcks` (`produce.ts`), gọi từ mọi reducer có thể làm HW/ISR
  // đổi (`replica-fetch`/`isr-shrink`/`isr-expand`/`leader-election`,
  // `engine/index.ts`), quét mảng này mỗi lần: `offset < highWatermark` mới
  // ⇒ phát `produce-response` thật lúc đó; ISR tụt dưới `minInsyncReplicas`
  // trước khi kịp ⇒ phát lỗi `NOT_ENOUGH_REPLICAS` thay vì treo vĩnh viễn.
  pendingAcks: PendingAck[]
  // Broker nhớ sequence cuối cùng đã CHẤP NHẬN cho từng producerId trên chính
  // partition này — đúng cách Kafka thật chặn duplicate/out-of-order cho idempotent
  // producer, xem `checkSequence` (`produce.ts`). Khoá theo `producerId` (số,
  // `assignProducerId` cấp), không phải theo `NodeId` — nhiều producer node có thể
  // lần lượt tái sử dụng cùng một `producerId` số trong một plan sau (transaction
  // epoch bump); ở plan này mỗi node giữ đúng một producerId suốt đời chạy.
  producerState: Record<number, { epoch: number; lastSequence: number }>
}

/** Một yêu cầu `acks=all` đã append THẬT nhưng chưa thoả HW — xem why-comment ở
 *  `PartitionState.pendingAcks`. */
export interface PendingAck {
  producerId: NodeId
  offset: number
  requestedAt: number
}

export interface LogEntry {
  offset: number
  key: string | null
  value: string | null // null = tombstone (compaction)
  timestamp: number // thời gian ảo
  headers?: Record<string, string>
  bytes: number
  producerId?: number
  producerEpoch?: number
  sequence?: number
  txnId?: string
  control?: 'commit' | 'abort' // transaction marker
}

// Khai báo ở task này dù chưa có reducer nào đọc/ghi nó — group coordinator và
// rebalance (§B5.4) thuộc plan sau. Khai báo trước để `KafkaState.groups` có một
// type ổn định ngay từ Task 1, thay vì một `Record<string, unknown>` phải sửa lại.
export interface GroupState {
  groupId: string
  state: 'Empty' | 'PreparingRebalance' | 'CompletingRebalance' | 'Stable'
  generationId: number
  leaderMemberId: NodeId | null
  assignor: 'range' | 'round-robin' | 'sticky' | 'cooperative-sticky'
  members: GroupMember[]
  committedOffsets: Record<string, { offset: number; committedAt: number }>
  coordinatorBrokerId: NodeId
}

export interface TopicPartition {
  topic: string
  partition: number
}

export interface GroupMember {
  memberId: NodeId
  subscriptions: string[]
  assignment: TopicPartition[]
  lastHeartbeatAt: number
  lastPollAt: number
  // Task 2 (coordinator): cấu hình timeout riêng của MEMBER này, chụp lại từ
  // `KafkaConsumerSpec` tại lúc join — `checkTimeouts` cần chúng để xét eviction
  // nhưng `coordinator.ts` cố tình không phụ thuộc `KafkaTopology` (giống
  // `assignors.ts` chỉ import từ `../types`), nên giá trị phải sống ở đây thay vì
  // được tra cứu lại từ topology mỗi lần. Optional vì `applyConsumerJoin` (naive,
  // Task 1) chưa gán chúng — đọc qua `?? DEFAULT_*` ở `coordinator.ts`, không bao
  // giờ giả định có mặt.
  sessionTimeoutMs?: number
  maxPollIntervalMs?: number
}

export interface ProducerRuntime {
  // Bản ghi đang gom trước khi flush, theo partition (`partitionKey`). Chưa có offset —
  // offset chỉ được cấp khi `append` thật sự ghi vào `PartitionState.log` (Task 3/4).
  batches: Record<
    string,
    {
      records: {
        key: string | null
        value: string | null
        headers?: Record<string, string>
        timestamp: number
        bytes: number
        // Chỉ có ở record của producer idempotent — gán MỘT LẦN lúc `enqueueRecord`
        // (không phải lúc flush, xem why-comment ở đó), và đi theo record suốt đời
        // của nó qua mọi lần retry, dù batch có bị dọn khỏi accumulator hay không.
        producerId?: number
        sequence?: number
        // Task 10: id của transaction đang mở tại thời điểm app gọi `.send()`
        // (`enqueueRecord`), CÙNG khuôn với `sequence` ở trên — gán MỘT LẦN lúc
        // enqueue, không phải lúc flush, và đi theo record suốt đời qua mọi lần
        // retry. Đây KHÔNG cùng khuôn với `producerEpoch` (`flushBatch`, `produce.ts`):
        // epoch phải đọc LẠI runtime hiện tại lúc append vì nó là thứ broker dùng để
        // fencing một epoch cũ — đọc epoch cũ chụp sẵn sẽ stamp sai epoch. `txnId`
        // ngược lại: ý nghĩa của nó do PHÍA APP quyết định tại thời điểm gọi
        // `.send()` — một record thuộc transaction nào là cố định ngay lúc đó, dù
        // transaction có commit/abort trước hay sau khi batch của nó thật sự flush.
        // Đọc lại `currentTxnId` tại thời điểm append (thay vì snapshot lúc enqueue)
        // sẽ gán nhầm record cho một transaction KHÁC (hoặc không transaction nào)
        // nếu producer đã begin/commit một transaction mới trong lúc batch cũ còn
        // đang chờ linger/retry.
        txnId?: string
      }[]
      bytes: number
      openedAt: number
    }
  >
  inFlightRequests: number
  producerId?: number
  epoch?: number
  nextSequence: Record<string, number> // theo partition
  // Ngân sách lỗi produce-error còn lại (Task 11) — `applyProduceErrorArm`
  // (`engine/index.ts`) cộng vào khi fault kích hoạt ở đúng `at` của nó;
  // `flushBatch` (`produce.ts`) trừ đi mỗi lần một lượt gửi bị buộc thất bại. `0`
  // và "chưa từng có fault nào" (`undefined`) coi như nhau — đọc qua `?? 0`.
  pendingErrors?: number
  // Ngân sách "ack bị mất" còn lại (Task 11 fix round) — cùng khuôn với
  // `pendingErrors`, cùng cặp arm/consume (`applyAckLossArm` cộng vào,
  // `flushBatch` trừ đi), nhưng khác chỗ NÀO nó tác động: `pendingErrors` chặn
  // TRƯỚC khi append (request thất bại thật); `pendingAckLosses` chỉ tiêu SAU
  // khi append đã thành công — bản ghi đã nằm trong log, chỉ có phản hồi bay về
  // producer là "mất". Đây là fault duy nhất khiến `checkSequence` có thể thật
  // sự trả `'duplicate'` qua một lần chạy kernel đầy đủ (không phải test
  // tự tiêm state) — xem why-comment ở `flushBatch`.
  pendingAckLosses?: number
  txnState?: 'Empty' | 'Ongoing' | 'PrepareCommit' | 'PrepareAbort'
  // Task 9 (`transaction.ts`, §B5.5): id của transaction ĐANG MỞ, gán bởi
  // `beginTransaction` — `commitTransaction`/`abortTransaction` dùng nó để tìm
  // đúng những partition đã ghi record thuộc transaction này (quét `txnId` trong
  // log từng partition) và biết ghi control record cho txnId nào. Bị xoá (không
  // gán `undefined` tường minh, cùng quy ước `stickyPartition`) khi transaction
  // kết thúc — `txnState` quay lại `'Empty'` cùng lúc.
  currentTxnId?: string
  // Ba trường dưới đây phục vụ `pickPartition` (Task 4, `partitioner.ts`) — không
  // khai báo ở Task 1 vì spec §B3 cũng không liệt kê chúng, nhưng `enqueueRecord`
  // cần một chỗ thuần (không phải biến ngoài) để thread trạng thái partitioner
  // qua từng lần gọi mà vẫn giữ engine pure. `stickyPartition` optional và
  // `nextSticky` từ `pickPartition` có thể là `undefined` một cách có chủ đích —
  // đó là "chưa từng chọn", khác `0` (đã chọn partition 0). Không bao giờ ép nó
  // thành số bằng `?? 0` khi ghi lại vào đây — xem partitioner.ts.
  roundRobinCounter: number
  stickyPartition?: number
  rng: RngState
}

export interface ConsumerRuntime {
  position: Record<string, number> // fetch offset theo partition
  paused: string[]
  lastPollAt: number
  processingUntil?: number
  pendingCommit?: Record<string, number>
  // Fault `consumer-stall` (Task 4, `faults.ts`) ghi mốc "hết treo" vào đây —
  // `applyFetchRequest` (engine/index.ts) đọc field này: còn trong khoảng treo
  // thì bỏ qua hẳn lượt fetch (không đọc gì, không đụng `GroupMember.lastPollAt`),
  // mô phỏng callback xử lý bị treo trong khi thread heartbeat (độc lập) vẫn
  // chạy đều — đúng bẫy lesson 16 dạy, xem why-comment ở `checkTimeouts`
  // (`group/coordinator.ts`).
  stalledUntil?: number
  // Ngân sách "xử lý lỗi" còn lại của fault `processing-error` (Task 4,
  // `faults.ts` arm nó) — `applyProcessDone` (engine/index.ts) tiêu dần: còn
  // ngân sách thì không hoàn tất, tự hẹn lại một `process-done` khác sau đúng
  // `processingMs`, giống record đang được xử lý LẠI. `0` và "chưa từng có fault
  // nào" (`undefined`) coi như nhau — đọc qua `?? 0`, cùng khuôn
  // `ProducerRuntime.pendingErrors`.
  pendingProcessingErrors?: number
}

export interface KafkaMetrics {
  recordsProduced: number
  recordsConsumed: number
  bytesProduced: number
  rebalances: number
  commits: number
  retries: number
  duplicatesPrevented: number
  underReplicatedPartitions: number
  lagTotal: number
  abortedRecordsSkipped: number
  recordsExpired: number
  recordsCompacted: number
}

// ---------------------------------------------------------------------------
// Script và fault
// ---------------------------------------------------------------------------

export type KafkaScriptedCommand =
  | {
      at: number
      kind: 'produce'
      producerId: NodeId
      topic: string
      key?: string | null
      value: string | null
      partition?: number
      headers?: Record<string, string>
    }
  | { at: number; kind: 'consumer-join'; consumerId: NodeId }
  | { at: number; kind: 'consumer-leave'; consumerId: NodeId }
  | { at: number; kind: 'commit'; consumerId: NodeId }
  | {
      at: number
      kind: 'seek'
      consumerId: NodeId
      topic: string
      partition: number
      offset: number | 'earliest' | 'latest'
    }
  | { at: number; kind: 'pause' | 'resume'; consumerId: NodeId; topic: string; partition: number }
  | { at: number; kind: 'begin-transaction' | 'commit-transaction' | 'abort-transaction'; producerId: NodeId }

// Trường trên lesson tên là `failures`, không phải `faults` — `src/shell/useSimulation.ts`
// đọc `.failures` một cách generic và đó là thứ giữ `src/shell/` broker-agnostic.
export type KafkaFault =
  | { at: number; kind: 'broker-down'; brokerId: NodeId }
  | { at: number; kind: 'broker-up'; brokerId: NodeId }
  | { at: number; kind: 'consumer-stall'; consumerId: NodeId; durationMs: number }
  | { at: number; kind: 'replica-lag'; brokerId: NodeId; ms: number }
  | { at: number; kind: 'processing-error'; consumerId: NodeId; times: number }
  | { at: number; kind: 'produce-error'; producerId: NodeId; times: number }
  // Ack bị mất SAU khi broker đã append thành công — khác `produce-error` (request
  // thất bại thật): dữ liệu đã vào log, chỉ có phản hồi không bao giờ tới được
  // producer. Producer coi như timeout, resend — và đó chính là kịch bản
  // idempotence thật sự bảo vệ (xem `flushBatch`, nhánh `pendingAckLosses`).
  | { at: number; kind: 'ack-lost'; producerId: NodeId; times: number }

/** Khoá của một partition trong `KafkaState.partitions`. Dạng chuỗi có tiền tố
 *  topic chứ không phải số: khoá số thuần trong một object JavaScript được lặp
 *  theo thứ tự số học, không theo thứ tự chèn, và engine này dựa vào thứ tự lặp
 *  ổn định để giữ determinism. */
export function partitionKey(topic: string, index: number): string {
  return `${topic}-${index}`
}

/**
 * Mọi vòng lặp trên `state.partitions` phải đi qua hàm này, không bao giờ lặp
 * thẳng `Object.keys`. Thứ tự lặp của một object là hợp đồng mong manh; một
 * mảng đã sort tường minh thì không.
 */
// `.sort()` here is the default lexicographic string sort, deliberately not a numeric
// one: `"orders-10" < "orders-2"` lexicographically, so a topic with ten or more
// partitions does NOT get its partitions in numeric order. That is fine — the only
// thing determinism needs is that the order be a pure function of the key set,
// independent of insertion order, and lexicographic sort is exactly that. Switching
// this to a numeric sort later would change every journal byte-for-byte, so don't.
export function sortedPartitionKeys(state: KafkaState): string[] {
  return Object.keys(state.partitions).sort()
}

export type KafkaEventType =
  | 'produce-request'
  | 'batch-flush'
  | 'append'
  | 'produce-response'
  | 'produce-retry'
  // Trùng tên với `KafkaFault['kind']` một cách có chủ đích — cùng quy ước với
  // `broker-down`/`broker-up`: fault được seed thẳng thành một event cùng tên,
  // kích hoạt tại đúng `at` của nó (`applyProduceErrorArm`, `engine/index.ts`),
  // chứ không phải một fault "ngoài luồng" bị `flushBatch` tự dò state.
  | 'produce-error'
  // Cùng quy ước như `produce-error` ngay trên — `applyAckLossArm` kích hoạt tại
  // đúng `at` của fault.
  | 'ack-lost'
  | 'fetch-request'
  | 'deliver'
  | 'process-done'
  | 'commit'
  | 'segment-roll'
  | 'retention-delete'
  | 'consumer-join'
  | 'consumer-leave'
  | 'seek'
  | 'pause'
  | 'resume'
  | 'broker-down'
  | 'broker-up'
  // Task 2 (coordinator, `group/coordinator.ts`): năm event của máy trạng thái
  // rebalance. Chưa có `seedEvents`/reducer hiện có nào SINH ra chúng — nối
  // `consumer-join`/`consumer-leave`/`fetch-request` để thật sự phát các event
  // này (và khởi động vòng lặp `member-timeout` định kỳ) là việc của Task 4
  // ("nối `group/` và fault consumer vào engine"). Reducer ở `engine/index.ts`
  // cho cả năm nhánh này vẫn là logic THẬT (gọi thẳng hàm cùng tên ở
  // `coordinator.ts`), không phải placeholder — chỉ riêng phần PHÁT SINH sự kiện
  // từ hoạt động consumer thật là chưa nối.
  | 'join-group'
  | 'sync-group'
  | 'heartbeat'
  | 'rebalance-complete'
  | 'member-timeout'
  // Task 4 (`faults.ts`): ba fault còn lại của `KafkaFault['kind']` chưa có
  // event/reducer riêng — cùng quy ước `produce-error`/`ack-lost` ở trên, trùng
  // tên với `KafkaFault['kind']`, kích hoạt tại đúng `at` của fault.
  // `replica-lag` chỉ TRANG BỊ tiền đề (`PartitionState.replicaState[...].lastFetchAt`
  // lùi lại) — chưa có reducer nào tự rút ISR, đó là việc của Task 6
  // (`replication.ts`).
  | 'consumer-stall'
  | 'processing-error'
  | 'replica-lag'
  // Task 6 (`replication.ts`): follower fetch, ISR shrink/expand, leader
  // election. Bốn reducer ở `engine/index.ts` cho các nhánh này là logic THẬT
  // (gọi thẳng `replicaFetch`/`shrinkIsr`/`expandIsr`/`electLeader`), không phải
  // placeholder — chỉ riêng phần khiến hoạt động thật của cluster (produce,
  // broker down/up…) THẬT SỰ SINH RA các event này (seed lần đầu, tự hẹn lại từ
  // một nguồn khác ngoài chính `replica-fetch`) là việc của Task 8, ngoài phạm
  // vi task này — cùng quy ước `join-group`/`sync-group`/`heartbeat` (Task 2) đã
  // theo.
  | 'replica-fetch'
  | 'isr-shrink'
  | 'isr-expand'
  | 'leader-election'
  // Task 9 (`transaction.ts`, §B5.5): mở/kết thúc một transaction của producer.
  // `txn-begin` gọi thẳng `beginTransaction`; `txn-marker` gọi `commitTransaction`
  // hoặc `abortTransaction` tuỳ `payload.outcome` — MỘT event cho cả hai chiều vì
  // cả hai chỉ khác nhau ở record `control` ghi vào log (`'commit'`/`'abort'`),
  // không khác gì ở chỗ sinh sự kiện. `seedEvents` (`engine/index.ts`) sinh chúng
  // từ ba lệnh kịch bản `begin-transaction`/`commit-transaction`/`abort-transaction`
  // (đã có sẵn trong `KafkaScriptedCommand` từ trước) — trước Task 9 ba lệnh đó bị
  // bỏ qua có chủ đích vì hai event này chưa tồn tại.
  | 'txn-begin'
  | 'txn-marker'
