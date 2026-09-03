import { applyPause, applyResume, applySeek, fetchRecords } from './consume'
import { applyConsumerStall, applyProcessingErrorArm, applyReplicaLag } from './faults'
import { checkTimeouts, completeRebalance, heartbeat, joinGroup, leaveGroup, syncGroup } from './group/coordinator'
import type { AssignorName } from './group/assignors'
import { commitOffsets, scheduleAutoCommit } from './group/offsets'
import { createPartition } from './log'
import { enqueueRecord, flushBatch, PRODUCE_RESPONSE_TRAVEL_MS } from './produce'
import { partitionKey, sortedPartitionKeys } from './types'
import type {
  ConsumerRuntime,
  KafkaConsumerSpec,
  KafkaEventType,
  KafkaFault,
  KafkaProducerSpec,
  KafkaScriptedCommand,
  KafkaState,
  KafkaTopicSpec,
  KafkaTopology,
  NodeId,
  ProducerRuntime,
} from './types'
import { validateKafkaTopology, type KafkaIssueCode, type KafkaValidationIssue } from './validate'
import { createRng } from '../../../shell/kernel/rng'
import { createKernel, type Simulation } from '../../../shell/kernel/run'
import type { InFlight, SimEvent } from '../../../shell/kernel/types'

export * from './types'
export { validateKafkaTopology, type KafkaIssueCode, type KafkaValidationIssue }
export { createRng, nextFloat, nextInt, type RngState } from '../../../shell/kernel/rng'
export { MAX_EVENTS_PER_RUN, MAX_JOURNAL, type Simulation } from '../../../shell/kernel/run'

/** Virtual milliseconds a record particle spends animating along one canvas edge. */
export const RECORD_TRAVEL_MS = 120

/**
 * Consumer poll cadence — `fetch-request` reschedules itself at this interval,
 * UNCONDITIONALLY, for as long as the consumer is joined. See `applyFetchRequest`
 * for why this must never be tied to whether the last poll returned records: a
 * consumer that has caught up to the high watermark still has to keep asking, or
 * it goes permanently deaf to anything produced after that point.
 */
const POLL_INTERVAL_MS = 100

/**
 * Nhịp tự hẹn lại của `heartbeat` (Task 4) — độc lập HOÀN TOÀN với
 * `POLL_INTERVAL_MS`/`fetch-request`: đây chính là điểm coordinator.ts's
 * `checkTimeouts` cần ("heartbeat vẫn đều... trong khi vòng xử lý đã treo",
 * xem why-comment ở đó) — một `consumer-stall` (faults.ts) làm vòng
 * fetch-request "treo" (không cập nhật `GroupMember.lastPollAt`) nhưng KHÔNG hề
 * chạm vào vòng này. 3000ms khớp `heartbeat.interval.ms` mặc định của client
 * Kafka thật.
 */
const HEARTBEAT_INTERVAL_MS = 3000

/**
 * Nhịp quét định kỳ của `member-timeout` (Task 4) — một vòng TOÀN CLUSTER
 * (`checkTimeouts` tự lặp qua mọi group), không gắn với một consumer cụ thể
 * nào nên seed MỘT LẦN lúc khởi tạo simulation (`seedEvents`), không phải mỗi
 * lần một consumer join như `fetch-request`/`heartbeat`. Thô hơn
 * `POLL_INTERVAL_MS` là được — `sessionTimeoutMs`/`maxPollIntervalMs` đều tính
 * bằng giây trở lên, chậm hơn 1000ms một khoảng an toàn không làm trễ đáng kể
 * việc phát hiện eviction trong khung thời gian một lesson.
 */
const MEMBER_TIMEOUT_SCAN_INTERVAL_MS = 1000

export interface KafkaSimulationOptions {
  topology: KafkaTopology
  script: KafkaScriptedCommand[]
  seed: number
  failures?: KafkaFault[]
  /** Overrides MAX_EVENTS_PER_RUN — see the RabbitMQ module for why the Sandbox needs this. */
  maxEvents?: number
}

type ReduceResult = { state: KafkaState; newEvents: SimEvent<KafkaEventType>[] }
type Reducer = (state: KafkaState, event: SimEvent<KafkaEventType>) => ReduceResult

// --- Payload extraction --------------------------------------------------
// SimEvent.payload is `Record<string, unknown>` by design (the kernel is shared
// across brokers and cannot know Kafka's event shapes). These narrow it back to
// concrete types via runtime checks the compiler can trust as type guards,
// rather than `as` assertions: every field a Kafka event carries is written by
// this same file (seedEvents / the apply* reducers below), so the checks never
// actually fail — they exist so the compiler, not a cast, is the authority.

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`kafka engine: payload.${field} is not a string`)
  return value
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return asString(value, field)
}

function asStringOrNull(value: unknown, field: string): string | null {
  if (value === null) return null
  return asString(value, field)
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`kafka engine: payload.${field} is not a number`)
  return value
}

function asOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  return asNumber(value, field)
}

function asOffset(value: unknown, field: string): number | 'earliest' | 'latest' {
  if (value === 'earliest' || value === 'latest') return value
  return asNumber(value, field)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && Object.values(value).every((v) => typeof v === 'string')
}

function asOptionalHeaders(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!isStringRecord(value)) throw new Error(`kafka engine: payload.${field} is not a Record<string, string>`)
  return value
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`kafka engine: payload.${field} is not a string[]`)
  }
  return value
}

const ASSIGNOR_NAMES: readonly AssignorName[] = ['range', 'round-robin', 'sticky', 'cooperative-sticky']

function asAssignorName(value: unknown, field: string): AssignorName {
  if (typeof value !== 'string' || !(ASSIGNOR_NAMES as readonly string[]).includes(value)) {
    throw new Error(`kafka engine: payload.${field} is not a valid AssignorName`)
  }
  return value as AssignorName
}

/**
 * `produce-retry`'s payload carries a snapshot of the batch it must resend
 * (`FlushBatchArgs.retryRecords`, `produce.ts`) only when `maxInFlight > 1` cleared
 * the batch out of the accumulator at the failed attempt — see the why-comment on
 * `flushBatch`. Written by this same file (`flushBatch`'s `retryOrTerminal`), so
 * this never actually throws in practice, same rationale as every other `asX`
 * helper above.
 */
function asOptionalRetryRecords(value: unknown): ProducerRuntime['batches'][string]['records'] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('kafka engine: payload.records is not an array')
  return value.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`kafka engine: payload.records[${i}] is not an object`)
    const e = entry as Record<string, unknown>
    return {
      key: asStringOrNull(e.key, `records[${i}].key`),
      value: asStringOrNull(e.value, `records[${i}].value`),
      headers: asOptionalHeaders(e.headers, `records[${i}].headers`),
      timestamp: asNumber(e.timestamp, `records[${i}].timestamp`),
      bytes: asNumber(e.bytes, `records[${i}].bytes`),
      producerId: asOptionalNumber(e.producerId, `records[${i}].producerId`),
      sequence: asOptionalNumber(e.sequence, `records[${i}].sequence`),
    }
  })
}

// --- Topology lookups ------------------------------------------------------
// `KafkaState` does not carry `topology` (unlike Redis' `RedisState`) — every
// reducer that needs a producer/consumer/topic *spec* (acks, subscriptions,
// partition count…) reaches it through the closure `createReducers` builds
// over `options.topology`, not through state. These throw on a missing id the
// same way `produce.ts`/`consume.ts` do for their own runtime lookups
// (`getProducerRuntime` etc.) — every id that reaches a reducer here was
// written into an event's payload by `seedEvents` from the very same
// `topology`/`script`, or is fatal-gated by `validateKafkaTopology` first, so
// this never actually throws in practice.

function producerSpec(topology: KafkaTopology, id: NodeId): KafkaProducerSpec {
  const spec = topology.producers.find((p) => p.id === id)
  if (!spec) throw new Error(`kafka engine: unknown producer ${id}`)
  return spec
}

function consumerSpec(topology: KafkaTopology, id: NodeId): KafkaConsumerSpec {
  const spec = topology.consumers.find((c) => c.id === id)
  if (!spec) throw new Error(`kafka engine: unknown consumer ${id}`)
  return spec
}

function topicSpec(topology: KafkaTopology, name: string): KafkaTopicSpec {
  const spec = topology.topics.find((t) => t.name === name)
  if (!spec) throw new Error(`kafka engine: unknown topic ${name}`)
  return spec
}

// --- State + sequencing ---------------------------------------------------

/** Broker id at a rotating position, safe against an (invalid, fatal-gated) empty broker list. */
function brokerAt(brokerIds: NodeId[], index: number): NodeId {
  if (brokerIds.length === 0) return ''
  return brokerIds[index % brokerIds.length] ?? ''
}

function createState(topology: KafkaTopology, seed: number): KafkaState {
  const brokerIds = topology.brokers.map((b) => b.id)
  const partitions: KafkaState['partitions'] = {}

  // Leader rải vòng tròn qua TOÀN BỘ cluster bằng một bộ đếm KHÔNG reset lại ở
  // mỗi topic: partition đầu tiên của topic thứ hai tiếp tục đúng vị trí broker
  // kế tiếp thay vì luôn quay lại `brokers[0]`, giống cách nhiều topic tạo liên
  // tiếp trên một cluster thật không dồn hết partition đầu của mọi topic vào
  // cùng một broker. Thứ tự dựng ở đây (topic theo `topology.topics`, partition
  // theo index tăng dần) chỉ ảnh hưởng gán leader/replica — thứ tự ĐỌC LẠI
  // partition sau đó luôn đi qua `sortedPartitionKeys`, nên thứ tự chèn ở vòng
  // lặp này không bao giờ rò vào hành vi (§B6).
  let globalIndex = 0
  for (const topic of topology.topics) {
    for (let index = 0; index < topic.partitions; index++) {
      const leaderPos = globalIndex % (brokerIds.length || 1)
      const leader = brokerAt(brokerIds, leaderPos)
      const replicas: NodeId[] = []
      for (let r = 0; r < topic.replicationFactor; r++) {
        replicas.push(brokerAt(brokerIds, leaderPos + r))
      }
      partitions[partitionKey(topic.name, index)] = createPartition({ topic: topic.name, index, leader, replicas })
      globalIndex++
    }
  }

  return {
    now: 0,
    seq: 0,
    rng: createRng(seed),
    journal: [],
    partitions,
    groups: {},
    // Mỗi producer nhận một rng RIÊNG, seed lệch theo vị trí của nó trong
    // `topology.producers` (mảng cố định, không phải `Object.keys`) — vẫn là một
    // hàm thuần của `seed` đầu vào nên determinism giữ nguyên, nhưng tránh hai
    // producer cùng partitioner ngẫu nhiên rút ra CÙNG một chuỗi số, thứ sẽ làm
    // lesson "hot partition" (bài 08) trông như cả hai producer đồng bộ với
    // nhau một cách giả tạo.
    producers: Object.fromEntries(
      topology.producers.map((p, i) => [
        p.id,
        {
          batches: {},
          inFlightRequests: 0,
          nextSequence: {},
          roundRobinCounter: 0,
          // `stickyPartition` cố tình để trống — xem comment ở `ProducerRuntime`.
          rng: createRng(seed + i),
        },
      ]),
    ),
    consumers: {},
    brokersOnline: Object.fromEntries(brokerIds.map((id) => [id, true])),
    controller: { brokerId: topology.controllerBrokerId, epoch: 0 },
    metrics: {
      recordsProduced: 0,
      recordsConsumed: 0,
      bytesProduced: 0,
      rebalances: 0,
      commits: 0,
      retries: 0,
      duplicatesPrevented: 0,
      underReplicatedPartitions: 0,
      lagTotal: 0,
      abortedRecordsSkipped: 0,
      recordsExpired: 0,
      recordsCompacted: 0,
    },
    inFlight: [],
    nextProducerId: 0,
  }
}

function nextSeq(state: KafkaState): [number, KafkaState] {
  return [state.seq + 1, { ...state, seq: state.seq + 1 }]
}

/** Drops any `InFlight` whose animation has already arrived as of `state.now`. */
function pruneFlights(state: KafkaState): KafkaState {
  const kept = state.inFlight.filter((flight) => flight.toT > state.now)
  if (kept.length === state.inFlight.length) return state
  return { ...state, inFlight: kept }
}

function withPrune(reducer: Reducer): Reducer {
  return (state, event) => reducer(pruneFlights(state), event)
}

// --- Seeding ----------------------------------------------------------------

function seedEvents(options: KafkaSimulationOptions): SimEvent<KafkaEventType>[] {
  let seq = 0
  const events: SimEvent<KafkaEventType>[] = []

  for (const command of options.script) {
    switch (command.kind) {
      case 'produce':
        events.push({
          at: command.at,
          seq: seq++,
          type: 'produce-request',
          payload: {
            producerId: command.producerId,
            topic: command.topic,
            key: command.key ?? null,
            value: command.value,
            partition: command.partition,
            headers: command.headers,
          },
        })
        break
      case 'consumer-join':
        events.push({ at: command.at, seq: seq++, type: 'consumer-join', payload: { consumerId: command.consumerId } })
        break
      case 'consumer-leave':
        events.push({ at: command.at, seq: seq++, type: 'consumer-leave', payload: { consumerId: command.consumerId } })
        break
      case 'commit':
        events.push({ at: command.at, seq: seq++, type: 'commit', payload: { consumerId: command.consumerId } })
        break
      case 'seek':
        events.push({
          at: command.at,
          seq: seq++,
          type: 'seek',
          payload: { consumerId: command.consumerId, topic: command.topic, partition: command.partition, offset: command.offset },
        })
        break
      case 'pause':
      case 'resume':
        events.push({
          at: command.at,
          seq: seq++,
          type: command.kind,
          payload: { consumerId: command.consumerId, topic: command.topic, partition: command.partition },
        })
        break
      case 'begin-transaction':
      case 'commit-transaction':
      case 'abort-transaction':
        // Giao dịch (transaction.ts, §B5.5) thuộc một plan sau — `KafkaEventType`
        // (Task 1) chưa có event nào cho ba loại lệnh này. Bỏ qua có chủ đích thay
        // vì throw: một lesson lỡ dùng chúng trước khi engine hỗ trợ chỉ đơn giản
        // không thấy hiệu ứng gì, không làm sập cả simulation.
        break
    }
  }

  for (const fault of options.failures ?? []) {
    switch (fault.kind) {
      case 'broker-down':
        events.push({ at: fault.at, seq: seq++, type: 'broker-down', payload: { brokerId: fault.brokerId } })
        break
      case 'broker-up':
        events.push({ at: fault.at, seq: seq++, type: 'broker-up', payload: { brokerId: fault.brokerId } })
        break
      case 'produce-error':
        // Task 11 (idempotent producer, retries): kích hoạt ngân sách lỗi cho
        // producer NÀY tại đúng thời điểm `at` — mọi lần flush TRƯỚC `at` không bị
        // ảnh hưởng, chỉ những lần SAU mới bị buộc thất bại. `applyProduceErrorArm`
        // cộng `times` vào `ProducerRuntime.pendingErrors`; `flushBatch`
        // (`produce.ts`) trừ dần mỗi lần một lượt gửi bị buộc thất bại.
        events.push({ at: fault.at, seq: seq++, type: 'produce-error', payload: { producerId: fault.producerId, times: fault.times } })
        break
      case 'ack-lost':
        // Task 11 (fix round): kích hoạt ngân sách "ack bị mất" cho producer NÀY
        // tại đúng thời điểm `at` — chỉ tác động những lần append THÀNH CÔNG SAU
        // `at`. `applyAckLossArm` cộng `times` vào `ProducerRuntime.pendingAckLosses`;
        // `flushBatch` (`produce.ts`) trừ dần mỗi lần một response bị "mất" sau khi
        // record đã thật sự vào log.
        events.push({ at: fault.at, seq: seq++, type: 'ack-lost', payload: { producerId: fault.producerId, times: fault.times } })
        break
      case 'consumer-stall':
        events.push({ at: fault.at, seq: seq++, type: 'consumer-stall', payload: { consumerId: fault.consumerId, durationMs: fault.durationMs } })
        break
      case 'replica-lag':
        events.push({ at: fault.at, seq: seq++, type: 'replica-lag', payload: { brokerId: fault.brokerId, ms: fault.ms } })
        break
      case 'processing-error':
        events.push({ at: fault.at, seq: seq++, type: 'processing-error', payload: { consumerId: fault.consumerId, times: fault.times } })
        break
    }
  }

  // `member-timeout` (Task 4): vòng quét TOÀN CLUSTER, seed đúng MỘT lần ở đây
  // — không gate theo có consumer/group nào tồn tại hay không (kể cả kịch bản
  // không hề có consumer-join nào vẫn seed event này, `checkTimeouts` quét
  // `state.groups` rỗng là một no-op vô hại). `seq` đặt SAU CÙNG, lớn hơn mọi
  // event script/fault cùng `at` — cùng nguyên tắc thứ tự cố định Step 3 của
  // brief yêu cầu.
  events.push({ at: MEMBER_TIMEOUT_SCAN_INTERVAL_MS, seq: seq++, type: 'member-timeout', payload: {} })

  return events
}

// --- Reducers: producer path ------------------------------------------------

function applyProduceRequest(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const producerId = asString(event.payload.producerId, 'producerId')
  const topicName = asString(event.payload.topic, 'topic')
  const key = asStringOrNull(event.payload.key, 'key')
  const value = asStringOrNull(event.payload.value, 'value')
  const partition = asOptionalNumber(event.payload.partition, 'partition')
  const headers = asOptionalHeaders(event.payload.headers, 'headers')

  // Local, client-side accumulator write — real Kafka's `producer.send()` never
  // touches the network here, so no `inFlight` animation and no travel delay:
  // the wire trip only happens once the batch actually flushes (`applyBatchFlush`).
  return enqueueRecord(state, {
    producer: producerSpec(topology, producerId),
    topic: topicSpec(topology, topicName),
    key,
    value,
    headers,
    partition,
    at: event.at,
  })
}

function applyBatchFlush(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const producerId = asString(event.payload.producerId, 'producerId')
  const topicName = asString(event.payload.topic, 'topic')
  const partition = asNumber(event.payload.partition, 'partition')

  const leader = state.partitions[partitionKey(topicName, partition)]?.leader
  const flushed = flushBatch(state, {
    producer: producerSpec(topology, producerId),
    topic: topicSpec(topology, topicName),
    partition,
    at: event.at,
  })

  if (leader === undefined) return flushed // unknown partition — flushBatch already threw if this mattered

  // Thuần cảm quan: `flushBatch` ở trên đã xử lý XONG NGAY LẬP TỨC (append, ack)
  // tại `event.at` — flight này chỉ vẽ lại đúng cái đã xảy ra trên cạnh canvas
  // producer→leader, không trì hoãn hiệu ứng thật thêm một khắc nào.
  const flight: InFlight = {
    message: { id: `produce-${producerId}-${topicName}-${partition}-${event.seq}`, label: topicName, solid: true },
    edgeId: `${producerId}->${leader}`,
    fromT: event.at,
    toT: event.at + RECORD_TRAVEL_MS,
    tone: 'amber',
  }
  return { state: { ...flushed.state, inFlight: [...flushed.state.inFlight, flight] }, newEvents: flushed.newEvents }
}

function applyProduceResponse(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const producerId = asString(event.payload.producerId, 'producerId')
  const topicName = asString(event.payload.topic, 'topic')
  const partition = asNumber(event.payload.partition, 'partition')
  const offset = asOptionalNumber(event.payload.offset, 'offset')
  const error = asOptionalString(event.payload.error, 'error')

  const leader = state.partitions[partitionKey(topicName, partition)]?.leader
  const text = error
    ? `${topicName}-${partition}: produce lỗi ${error}`
    : `${topicName}-${partition}: produce OK, offset ${offset ?? '?'}`

  const withJournal: KafkaState = {
    ...state,
    journal: [...state.journal, { at: event.at, type: 'produce-response', text, nodeId: producerId }],
  }
  if (leader === undefined) return { state: withJournal, newEvents: [] }

  // `produce-response`'s `at` (set by `produce.ts`) is already the ARRIVAL time
  // at the producer, `PRODUCE_RESPONSE_TRAVEL_MS` after the leader sent it — so
  // the flight must have started that long before `event.at`, not at it.
  const flight: InFlight = {
    message: { id: `ack-${producerId}-${topicName}-${partition}-${event.seq}`, label: error ?? 'ack', solid: false },
    edgeId: `${leader}->${producerId}`,
    fromT: Math.max(0, event.at - PRODUCE_RESPONSE_TRAVEL_MS),
    toT: event.at,
    tone: error ? 'rose' : 'emerald',
  }
  return { state: { ...withJournal, inFlight: [...withJournal.inFlight, flight] }, newEvents: [] }
}

/**
 * Kích hoạt fault `produce-error` (Task 11) tại đúng `at` của nó — cộng `times`
 * vào ngân sách `pendingErrors` của producer, KHÔNG trừ/đọc gì ở đây. `flushBatch`
 * (`produce.ts`) là nơi duy nhất tiêu ngân sách này, mỗi lần một lượt gửi (kể cả
 * retry) bị buộc thất bại. Không sinh event mới — không gọi `nextSeq` (xem
 * why-comment ở nhóm `placeholderReducer` bên dưới về kỷ luật đó).
 */
function applyProduceErrorArm(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const producerId = asString(event.payload.producerId, 'producerId')
  const times = asNumber(event.payload.times, 'times')
  const runtime = state.producers[producerId]
  if (!runtime) return { state, newEvents: [] } // producer không tồn tại — validate.ts đáng lẽ đã chặn, an toàn no-op

  const nextRuntime: ProducerRuntime = { ...runtime, pendingErrors: (runtime.pendingErrors ?? 0) + times }
  return {
    state: {
      ...state,
      producers: { ...state.producers, [producerId]: nextRuntime },
      journal: [
        ...state.journal,
        { at: event.at, type: 'produce-error', text: `${producerId}: kích hoạt lỗi produce cho ${times} lần gửi kế tiếp`, nodeId: producerId },
      ],
    },
    newEvents: [],
  }
}

/**
 * Kích hoạt fault `ack-lost` (Task 11 fix round) tại đúng `at` của nó — cộng
 * `times` vào ngân sách `pendingAckLosses` của producer, gần như sao y
 * `applyProduceErrorArm` ở trên, chỉ khác tên trường. `flushBatch` (`produce.ts`)
 * tiêu ngân sách này SAU khi một append đã thành công (khác `pendingErrors`, tiêu
 * TRƯỚC khi append). Không sinh event mới — không gọi `nextSeq`.
 */
function applyAckLossArm(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const producerId = asString(event.payload.producerId, 'producerId')
  const times = asNumber(event.payload.times, 'times')
  const runtime = state.producers[producerId]
  if (!runtime) return { state, newEvents: [] } // producer không tồn tại — validate.ts đáng lẽ đã chặn, an toàn no-op

  const nextRuntime: ProducerRuntime = { ...runtime, pendingAckLosses: (runtime.pendingAckLosses ?? 0) + times }
  return {
    state: {
      ...state,
      producers: { ...state.producers, [producerId]: nextRuntime },
      journal: [
        ...state.journal,
        { at: event.at, type: 'ack-lost', text: `${producerId}: kích hoạt mất ack cho ${times} lần append kế tiếp`, nodeId: producerId },
      ],
    },
    newEvents: [],
  }
}

/**
 * Xử lý một lần thử lại (`produce-error` fault, `ack-lost` fault, hoặc
 * `checkSequence` trả `out-of-order` — cả ba đều đi qua `flushBatch`'s
 * `retryOrTerminal`/nhánh `pendingAckLosses`). Về hình ảnh, một retry không khác
 * gì một lần gửi batch bình thường (`applyBatchFlush`) — chỉ khác ở chỗ nó có thể
 * lại thất bại/mất ack và tự hẹn thêm một `produce-retry` khác.
 */
function applyProduceRetry(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const producerId = asString(event.payload.producerId, 'producerId')
  const topicName = asString(event.payload.topic, 'topic')
  const partition = asNumber(event.payload.partition, 'partition')
  const attempt = asNumber(event.payload.attempt, 'attempt')
  const retryRecords = asOptionalRetryRecords(event.payload.records)

  const leader = state.partitions[partitionKey(topicName, partition)]?.leader
  const flushed = flushBatch(state, {
    producer: producerSpec(topology, producerId),
    topic: topicSpec(topology, topicName),
    partition,
    at: event.at,
    attempt,
    retryRecords,
  })

  if (leader === undefined) return flushed // unknown partition — flushBatch đã throw trước nếu điều đó quan trọng

  const flight: InFlight = {
    message: { id: `produce-retry-${producerId}-${topicName}-${partition}-${event.seq}`, label: topicName, solid: true },
    edgeId: `${producerId}->${leader}`,
    fromT: event.at,
    toT: event.at + RECORD_TRAVEL_MS,
    tone: 'amber',
  }
  return { state: { ...flushed.state, inFlight: [...flushed.state.inFlight, flight] }, newEvents: flushed.newEvents }
}

// --- Reducers: consumer path -------------------------------------------------

/**
 * Task 4 (Ruling D): thay hẳn lối ghi nhận member "naive" (Task 1) bằng lời gọi
 * THẬT tới `joinGroup` (`group/coordinator.ts`) — group thật sự đi qua
 * `PreparingRebalance` → (chờ `rebalanceTimeoutMs`) → `CompletingRebalance` →
 * `Stable`, `assignment` chỉ có sau khi `rebalance-complete`/`sync-group` chạy
 * xong, không còn "Stable ngay, assignment rỗng nhưng đọc được cả topic" như
 * trước. `newEvents` của `joinGroup` (một `rebalance-complete` đã hẹn) PHẢI
 * được trả ra — bỏ rơi nó là bug: group sẽ kẹt vĩnh viễn ở `PreparingRebalance`.
 *
 * `consumer-join` giờ khởi động BA vòng lặp tự hẹn lại độc lập, mỗi vòng seed
 * đúng một lần ở đây:
 *   - `fetch-request` (poll) — như cũ.
 *   - `heartbeat`, cách nhau `HEARTBEAT_INTERVAL_MS`, mang theo `generationId`
 *     CHỤP LẠI tại lúc join — xem why-comment ở `applyHeartbeat` về lý do không
 *     bao giờ đọc lại generationId "tươi" lúc bắn.
 *   - auto-commit (`scheduleAutoCommit`, `group/offsets.ts`) — chỉ khi
 *     `enableAutoCommit` (mặc định `true`) bật; tái dùng event `'commit'` sẵn
 *     có, không phải một loại event mới (xem why-comment ở `scheduleAutoCommit`).
 */
function applyConsumerJoin(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const spec = consumerSpec(topology, consumerId)

  const runtime: ConsumerRuntime = { position: {}, paused: [], lastPollAt: event.at }
  const withRuntime: KafkaState = { ...state, consumers: { ...state.consumers, [consumerId]: runtime } }

  const joined = joinGroup(withRuntime, {
    groupId: spec.groupId,
    memberId: consumerId,
    subscriptions: spec.subscriptions,
    assignor: spec.assignor ?? 'range',
    at: event.at,
    sessionTimeoutMs: spec.sessionTimeoutMs,
    maxPollIntervalMs: spec.maxPollIntervalMs,
    rebalanceTimeoutMs: spec.rebalanceTimeoutMs,
  })
  const group = joined.state.groups[spec.groupId]! // `joinGroup` luôn tạo/cập nhật đúng group này

  const withJournal: KafkaState = {
    ...joined.state,
    journal: [...joined.state.journal, { at: event.at, type: 'consumer-join', text: `${consumerId} vào group ${spec.groupId}`, nodeId: consumerId }],
  }

  const [pollSeq, afterPollSeq] = nextSeq(withJournal)
  const firstPoll: SimEvent<KafkaEventType> = { at: event.at, seq: pollSeq, type: 'fetch-request', payload: { consumerId } }

  const [hbSeq, afterHbSeq] = nextSeq(afterPollSeq)
  const firstHeartbeat: SimEvent<KafkaEventType> = {
    at: event.at + HEARTBEAT_INTERVAL_MS,
    seq: hbSeq,
    type: 'heartbeat',
    payload: { groupId: spec.groupId, memberId: consumerId, generationId: group.generationId },
  }

  const autoCommitEvents = scheduleAutoCommit(afterHbSeq, spec, event.at)
  const afterAutoCommitSeq = autoCommitEvents.length > 0 ? { ...afterHbSeq, seq: afterHbSeq.seq + 1 } : afterHbSeq

  return { state: afterAutoCommitSeq, newEvents: [...joined.newEvents, firstPoll, firstHeartbeat, ...autoCommitEvents] }
}

/**
 * Task 4 (Ruling D): thay lối ghi nhận "naive" bằng lời gọi THẬT tới
 * `leaveGroup` — rời CHỦ ĐỘNG kích hoạt rebalance NGAY (khác `checkTimeouts`,
 * chỉ phát hiện im lặng SAU khi hết timeout). `newEvents` (một
 * `rebalance-complete` đã hẹn, khi còn member khác) PHẢI được trả ra — đây
 * chính là thứ khiến "partition của consumer rời được giao lại trong cùng run"
 * xảy ra thật, không phải chỉ xoá khỏi danh sách suông.
 */
function applyConsumerLeave(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  if (state.consumers[consumerId] === undefined) return { state, newEvents: [] } // đã rời / chưa từng vào — no-op

  const nextConsumers = { ...state.consumers }
  delete nextConsumers[consumerId]
  // Xoá khỏi `state.consumers` chính là điều khiến `fetch-request`/`heartbeat` tự
  // hẹn lại VÔ ĐIỀU KIỆN cuối cùng phải dừng — xem gate ở đầu `applyFetchRequest`
  // và ở `applyHeartbeat`.
  const withoutConsumer: KafkaState = { ...state, consumers: nextConsumers }

  const spec = consumerSpec(topology, consumerId)
  const left = leaveGroup(withoutConsumer, { groupId: spec.groupId, memberId: consumerId, at: event.at })

  return {
    state: {
      ...left.state,
      journal: [...left.state.journal, { at: event.at, type: 'consumer-leave', text: `${consumerId} rời group ${spec.groupId}`, nodeId: consumerId }],
    },
    newEvents: left.newEvents,
  }
}

function applyFetchRequest(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')

  // Gate thành viên: đây là điều kiện DỪNG duy nhất cho vòng tự hẹn lại dưới đây
  // — KHÔNG BAO GIỜ dựa vào "lần poll trước có record hay không". Một consumer
  // bắt kịp high watermark (không có gì để đọc) vẫn phải tiếp tục poll mãi mãi;
  // nếu việc hẹn lại bị buộc vào `process-done` (chỉ sinh khi có record —
  // `consume.ts`), nó sẽ điếc vĩnh viễn với mọi record produce SAU thời điểm bắt
  // kịp đó. `consumer-leave` xoá khỏi `state.consumers` là cách duy nhất dừng
  // vòng này lại.
  const runtime = state.consumers[consumerId]
  if (runtime === undefined) return { state, newEvents: [] }

  const spec = consumerSpec(topology, consumerId)

  // Fault `consumer-stall` (faults.ts): callback xử lý coi như treo — vòng poll
  // vẫn tự hẹn lại (thread client thật vẫn "cố" gọi `poll()`) nhưng không đọc gì,
  // và quan trọng nhất: KHÔNG cập nhật `GroupMember.lastPollAt` — đây chính là
  // điều kiện `checkTimeouts` (coordinator.ts) cần để phát hiện
  // `maxPollIntervalMs` bị vượt trong khi heartbeat (vòng độc lập) vẫn đều.
  if (runtime.stalledUntil !== undefined && event.at < runtime.stalledUntil) {
    const [seq, afterSeq] = nextSeq(state)
    const nextPoll: SimEvent<KafkaEventType> = { at: event.at + POLL_INTERVAL_MS, seq, type: 'fetch-request', payload: { consumerId } }
    return { state: afterSeq, newEvents: [nextPoll] }
  }

  const fetched = fetchRecords(state, { consumer: spec, at: event.at })

  const [seq, afterFetchSeq] = nextSeq(fetched.state)
  const nextPoll: SimEvent<KafkaEventType> = { at: event.at + POLL_INTERVAL_MS, seq, type: 'fetch-request', payload: { consumerId } }

  let workingState = afterFetchSeq

  // Đồng bộ hoạt động poll THẬT vào `GroupMember.lastPollAt` (Task 4, Ruling D) —
  // khác `ConsumerRuntime.lastPollAt` (đã được `fetchRecords` cập nhật ngay bên
  // trên): đây là bản `checkTimeouts` (coordinator.ts) đọc để xét eviction do
  // `maxPollIntervalMs`. Không chạy tới đây khi đang `consumer-stall` (nhánh
  // return sớm ở trên) — đúng ý "giữ lastPollAt đứng yên" của fault đó.
  const group = workingState.groups[spec.groupId]
  if (group) {
    workingState = {
      ...workingState,
      groups: {
        ...workingState.groups,
        [spec.groupId]: {
          ...group,
          members: group.members.map((m) => (m.memberId === consumerId ? { ...m, lastPollAt: event.at } : m)),
        },
      },
    }
  }

  if (fetched.records.length > 0) {
    workingState = {
      ...workingState,
      journal: [
        ...workingState.journal,
        { at: event.at, type: 'deliver', text: `${consumerId} nhận ${fetched.records.length} record`, nodeId: consumerId },
      ],
    }
    // `fetchRecords` chỉ sinh `process-done` khi có record — đúng lúc đó mới có
    // gì để "đang xử lý". Ghi lại mốc đó lên runtime để UI (Task 8) có thể vẽ
    // trạng thái "consumer đang bận" mà không cần đoán lại từ event queue.
    const processDone = fetched.newEvents.find((e) => e.type === 'process-done')
    const rt = workingState.consumers[consumerId]
    if (processDone && rt) {
      workingState = {
        ...workingState,
        consumers: { ...workingState.consumers, [consumerId]: { ...rt, processingUntil: processDone.at } },
      }
    }
  }

  return { state: workingState, newEvents: [...fetched.newEvents, nextPoll] }
}

/**
 * Task 4: thêm nhánh tiêu ngân sách fault `processing-error`
 * (`faults.ts` arm nó vào `ConsumerRuntime.pendingProcessingErrors`). Còn ngân
 * sách thì KHÔNG hoàn tất — tự hẹn lại một `process-done` khác sau đúng
 * `processingMs` của chính consumer đó, mô phỏng "làm lại đúng record vừa xử
 * lý" (không fetch lại — record vẫn nằm nguyên trong `records` đã giao, chỉ
 * bước XỬ LÝ lặp lại). Hết ngân sách (hoặc chưa từng có fault) mới hoàn tất
 * như cũ.
 */
function applyProcessDone(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const count = asNumber(event.payload.count, 'count')

  const runtime = state.consumers[consumerId]
  if (!runtime) return { state, newEvents: [] } // consumer đã rời group giữa lúc đang xử lý — no-op, không lỗi

  const pending = runtime.pendingProcessingErrors ?? 0
  if (pending > 0) {
    const spec = consumerSpec(topology, consumerId)
    const processingMs = spec.processingMs ?? 0
    const nextRuntime: ConsumerRuntime = { ...runtime, pendingProcessingErrors: pending - 1 }
    const [seq, afterSeq] = nextSeq(state)
    const retry: SimEvent<KafkaEventType> = { at: event.at + processingMs, seq, type: 'process-done', payload: { consumerId, count } }
    return {
      state: {
        ...afterSeq,
        consumers: { ...afterSeq.consumers, [consumerId]: nextRuntime },
        journal: [
          ...afterSeq.journal,
          { at: event.at, type: 'process-done', text: `${consumerId} xử lý lỗi ${count} record, thử lại (còn ${pending - 1} lần)`, nodeId: consumerId },
        ],
      },
      newEvents: [retry],
    }
  }

  const updated: ConsumerRuntime = { ...runtime }
  delete updated.processingUntil

  return {
    state: {
      ...state,
      consumers: { ...state.consumers, [consumerId]: updated },
      journal: [...state.journal, { at: event.at, type: 'process-done', text: `${consumerId} xử lý xong ${count} record`, nodeId: consumerId }],
    },
    newEvents: [],
  }
}

/**
 * Task 4 (Ruling C): thay thân hàm cũ (tự tính `committedOffsets` tay, không
 * kiểm membership, không cập nhật `metrics.lagTotal`) bằng một lời gọi THẬT tới
 * `commitOffsets` (`group/offsets.ts`) — hàm đó đã đúng ngữ nghĩa offset (không
 * +1 bug), CÓ kiểm `memberId` thật sự thuộc `group.members` (silent no-op nếu
 * không — khớp `UNKNOWN_MEMBER_ID` Kafka thật, xem test pin hành vi này ở
 * `index.test.ts`), và tự cập nhật `metrics.lagTotal`.
 *
 * Sau khi commit xong, TỰ HẸN LẠI vòng auto-commit kế tiếp (nếu
 * `enableAutoCommit` bật) — bất kể lần bắn `'commit'` NÀY đến từ script tường
 * minh hay từ chính vòng auto-commit trước đó: `scheduleAutoCommit` không phân
 * biệt nguồn gốc, tái dùng đúng một `KafkaEventType` (`'commit'`), không thêm
 * loại event mới (xem why-comment ở `scheduleAutoCommit`). Hệ quả: một commit
 * tường minh giữa chừng cũng "khởi động lại" đồng hồ auto-commit từ mốc đó —
 * đơn giản hơn theo dõi hai đồng hồ độc lập, và vô hại vì commit chỉ ghi lại vị
 * trí đọc hiện tại, không có tác dụng phụ nào khác khi lặp lại.
 */
function applyCommit(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const runtime = state.consumers[consumerId]
  if (!runtime) return { state, newEvents: [] }

  const spec = consumerSpec(topology, consumerId)

  // Chỉ commit những partition consumer THỰC SỰ có position — lọc qua
  // `sortedPartitionKeys(state)` thay vì lặp thẳng `Object.keys(runtime.position)`
  // để giữ determinism (§B6).
  const keys = sortedPartitionKeys(state).filter((key) => runtime.position[key] !== undefined)
  const offsets: Record<string, number> = {}
  for (const key of keys) {
    const offset = runtime.position[key]
    if (offset === undefined) continue // đã lọc ở trên — chỉ để qua noUncheckedIndexedAccess
    offsets[key] = offset
  }

  const committed = commitOffsets(state, { groupId: spec.groupId, memberId: consumerId, offsets, at: event.at })

  const autoCommitEvents = scheduleAutoCommit(committed, spec, event.at)
  const nextState = autoCommitEvents.length > 0 ? { ...committed, seq: committed.seq + 1 } : committed
  return { state: nextState, newEvents: autoCommitEvents }
}

function applySeekEvent(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const topic = asString(event.payload.topic, 'topic')
  const partition = asNumber(event.payload.partition, 'partition')
  const offset = asOffset(event.payload.offset, 'offset')

  const nextState = applySeek(state, { consumerId, topic, partition, offset })
  return {
    state: {
      ...nextState,
      journal: [...nextState.journal, { at: event.at, type: 'seek', text: `${consumerId} seek ${topic}-${partition} → ${offset}`, nodeId: consumerId }],
    },
    newEvents: [],
  }
}

function applyPauseEvent(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const topic = asString(event.payload.topic, 'topic')
  const partition = asNumber(event.payload.partition, 'partition')
  return { state: applyPause(state, { consumerId, topic, partition }), newEvents: [] }
}

function applyResumeEvent(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const topic = asString(event.payload.topic, 'topic')
  const partition = asNumber(event.payload.partition, 'partition')
  return { state: applyResume(state, { consumerId, topic, partition }), newEvents: [] }
}

// --- Reducers: group coordinator (Task 2, nối thật ở Task 4) -----------------
//
// Năm nhánh dưới đây gọi THẲNG hàm cùng tên ở `group/coordinator.ts` — logic
// rebalance thật, không phải placeholder. Task 4 nối `applyConsumerJoin`/
// `applyConsumerLeave` (ở trên) để chúng thật sự SINH ra `join-group` gián
// tiếp qua lời gọi `joinGroup`/`leaveGroup`, và thêm vòng tự hẹn lại cho
// `heartbeat`/`member-timeout` (hai nhánh dưới đây) — `join-group` với tư cách
// một `KafkaEventType` riêng vẫn khai báo (Task 2) nhưng không có seedEvents/
// reducer nào DISPATCH nó qua event queue: `applyConsumerJoin` gọi thẳng hàm
// `joinGroup` (không đi vòng qua một event `'join-group'`), nên `applyJoinGroup`
// dưới đây vẫn là một nhánh có thật (đủ kiểu `Record<KafkaEventType, Reducer>`)
// nhưng KHÔNG có gì dispatch tới nó trong luồng hiện tại — an toàn, không phải
// một lỗ hổng: `'join-group'` tồn tại như một điểm mở rộng (ví dụ một client
// muốn tự gọi lại JoinGroupRequest sau `ILLEGAL_GENERATION`), ngoài phạm vi
// Task 4.

function applyJoinGroup(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const groupId = asString(event.payload.groupId, 'groupId')
  const memberId = asString(event.payload.memberId, 'memberId')
  const subscriptions = asStringArray(event.payload.subscriptions, 'subscriptions')
  const assignor = asAssignorName(event.payload.assignor, 'assignor')
  const sessionTimeoutMs = asOptionalNumber(event.payload.sessionTimeoutMs, 'sessionTimeoutMs')
  const maxPollIntervalMs = asOptionalNumber(event.payload.maxPollIntervalMs, 'maxPollIntervalMs')
  const rebalanceTimeoutMs = asOptionalNumber(event.payload.rebalanceTimeoutMs, 'rebalanceTimeoutMs')
  return joinGroup(state, { groupId, memberId, subscriptions, assignor, at: event.at, sessionTimeoutMs, maxPollIntervalMs, rebalanceTimeoutMs })
}

function applySyncGroup(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const groupId = asString(event.payload.groupId, 'groupId')
  const generationId = asNumber(event.payload.generationId, 'generationId')
  return syncGroup(state, { groupId, generationId, at: event.at })
}

/**
 * Task 4: `heartbeat` tự hẹn lại VÔ ĐIỀU KIỆN mỗi `HEARTBEAT_INTERVAL_MS`,
 * hoàn toàn độc lập với vòng `fetch-request` — đúng ý coordinator.ts's
 * `checkTimeouts` cần ("heartbeat vẫn đều... trong khi vòng xử lý đã treo").
 * Gate DUY NHẤT để dừng hẳn là `state.consumers[memberId] !== undefined` —
 * cùng gate `fetch-request` dùng — không gate theo group/membership: một
 * member vừa bị `checkTimeouts` đá khỏi group vẫn tiếp tục gửi heartbeat cho
 * tới khi `consumer-leave` thật sự xoá nó khỏi `state.consumers` (client thật
 * không tự biết ngay mình đã bị đá).
 *
 * `generationId` cho lần bắn KẾ TIẾP lấy từ `group.generationId` NGAY BÂY GIỜ
 * (có thể vừa đổi vì chính heartbeat này, hoặc vì một rebalance khác xảy ra
 * trước đó) — cố tình KHÔNG đọc lại "tươi" tại thời điểm event kế tiếp THẬT SỰ
 * bắn 3 giây sau. Nếu một rebalance xảy ra GIỮA lúc hẹn và lúc bắn, generationId
 * đã "đóng băng" trong payload trở nên CŨ so với group lúc đó — đúng cách
 * `heartbeat()` phát hiện `ILLEGAL_GENERATION`, không phải một bug.
 */
function applyHeartbeat(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const groupId = asString(event.payload.groupId, 'groupId')
  const memberId = asString(event.payload.memberId, 'memberId')
  const generationId = asNumber(event.payload.generationId, 'generationId')
  // `heartbeat()` trả thêm `error?: 'ILLEGAL_GENERATION'` (`HeartbeatResult`) —
  // một superset cấu trúc của `ReduceResult`, không mất gì khi chỉ đọc
  // `state`/`newEvents` ở đây.
  const result = heartbeat(state, { groupId, memberId, generationId, at: event.at })

  if (result.state.consumers[memberId] === undefined) return { state: result.state, newEvents: result.newEvents }
  const group = result.state.groups[groupId]
  if (!group) return { state: result.state, newEvents: result.newEvents }

  const [seq, afterSeq] = nextSeq(result.state)
  const nextHeartbeat: SimEvent<KafkaEventType> = {
    at: event.at + HEARTBEAT_INTERVAL_MS,
    seq,
    type: 'heartbeat',
    payload: { groupId, memberId, generationId: group.generationId },
  }
  return { state: afterSeq, newEvents: [...result.newEvents, nextHeartbeat] }
}

function applyRebalanceComplete(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const groupId = asString(event.payload.groupId, 'groupId')
  const generationId = asNumber(event.payload.generationId, 'generationId')
  return completeRebalance(state, { groupId, generationId, at: event.at })
}

/**
 * `member-timeout` là một tick định kỳ quét MỌI group (`checkTimeouts` tự lặp
 * qua `sortedGroupIds`), không mang theo `groupId` riêng trong payload — khác
 * bốn event kia. Task 4: chạy một lượt quét tại `event.at`, rồi tự hẹn lại
 * VÔ ĐIỀU KIỆN mỗi `MEMBER_TIMEOUT_SCAN_INTERVAL_MS` — không gate theo có
 * consumer/group nào tồn tại (seed đầu tiên ở `seedEvents` cũng vậy): quét một
 * cluster không group nào là một no-op vô hại, không có lý do dừng vòng này
 * lại giữa chừng một simulation đang chạy.
 */
function applyMemberTimeout(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const result = checkTimeouts(state, event.at)
  const [seq, afterSeq] = nextSeq(result.state)
  const nextScan: SimEvent<KafkaEventType> = { at: event.at + MEMBER_TIMEOUT_SCAN_INTERVAL_MS, seq, type: 'member-timeout', payload: {} }
  return { state: afterSeq, newEvents: [...result.newEvents, nextScan] }
}

// --- Reducers: broker faults --------------------------------------------------

function applyBrokerDown(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const brokerId = asString(event.payload.brokerId, 'brokerId')
  if (state.brokersOnline[brokerId] === false) return { state, newEvents: [] } // đã down — no-op
  return {
    state: {
      ...state,
      brokersOnline: { ...state.brokersOnline, [brokerId]: false },
      journal: [...state.journal, { at: event.at, type: 'broker-down', text: `# ${brokerId} down`, nodeId: brokerId }],
    },
    newEvents: [],
  }
}

function applyBrokerUp(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const brokerId = asString(event.payload.brokerId, 'brokerId')
  if (state.brokersOnline[brokerId] === true) return { state, newEvents: [] } // đã up — no-op
  return {
    state: {
      ...state,
      brokersOnline: { ...state.brokersOnline, [brokerId]: true },
      journal: [...state.journal, { at: event.at, type: 'broker-up', text: `# ${brokerId} up`, nodeId: brokerId }],
    },
    newEvents: [],
  }
}

// --- Reducers: chưa có ai dispatch (placeholder trung thực) --------------------
//
// Bốn nhánh dưới đây là thành viên của `KafkaEventType` (Task 1) nhưng KHÔNG một
// event nào trong wiring hiện tại từng sinh ra chúng — `REDUCERS` vẫn phải khai đủ
// vì nó được gõ kiểu `Record<KafkaEventType, Reducer>`, và đó chính là lý do union
// này tồn tại: thiếu một nhánh là lỗi compile, không phải lỗi runtime im lặng. Mỗi
// nhánh chỉ trả nguyên state, không sinh event nào — GIỐNG mọi reducer không phát
// event khác trong file này (`applyProcessDone`, `applyCommit`,
// `applyBrokerDown`/`Up`, `applyProduceErrorArm`, `applySeekEvent`,
// `applyPauseEvent`/`applyResumeEvent`): KHÔNG gọi `nextSeq`. `seq` chỉ tồn tại để
// đánh dấu thứ tự cho EVENT MỚI được sinh ra (dùng làm tie-break trong scheduler)
// — một reducer không sinh event nào thì không có gì cần đánh dấu, gọi `nextSeq`
// ở đó chỉ tăng một con số không ai đọc. (Một bản trước của comment này nói ngược
// lại — "mọi event đi qua kernel đều tiêu một seq" — sai, đã sửa ở Task 11.)
//   - `append`: phần ghi log của broker hiện GỘP thẳng vào `flushBatch` (Task 4),
//     gọi từ `batch-flush` ở trên. Event `append` tách riêng để dành cho một plan
//     sau muốn chèn độ trễ giữa "request tới broker" và "broker ghi xong đĩa".
//   - `deliver`: tương tự cho hướng consumer — `fetchRecords` (Task 5) trả record
//     ngay trong `fetch-request`, không qua một chặng mạng tách riêng.
//   - `segment-roll`/`retention-delete`: `rollSegments`/`applyRetention` (Task 3)
//     là hàm thuần đã có và đã test, nhưng chưa được nối vào bất kỳ reducer nào ở
//     plan này — không lesson nào trong phạm vi P1-P3 (basics/producer) cần
//     retention chạy qua một simulation thật.
function placeholderReducer(state: KafkaState, _event: SimEvent<KafkaEventType>): ReduceResult {
  return { state, newEvents: [] }
}

// --- Wiring ------------------------------------------------------------------

function createReducers(topology: KafkaTopology): Record<KafkaEventType, Reducer> {
  return {
    'produce-request': withPrune((state, event) => applyProduceRequest(topology, state, event)),
    'batch-flush': withPrune((state, event) => applyBatchFlush(topology, state, event)),
    append: withPrune(placeholderReducer),
    'produce-response': withPrune(applyProduceResponse),
    'produce-retry': withPrune((state, event) => applyProduceRetry(topology, state, event)),
    'produce-error': withPrune(applyProduceErrorArm),
    'ack-lost': withPrune(applyAckLossArm),
    'fetch-request': withPrune((state, event) => applyFetchRequest(topology, state, event)),
    deliver: withPrune(placeholderReducer),
    'process-done': withPrune((state, event) => applyProcessDone(topology, state, event)),
    commit: withPrune((state, event) => applyCommit(topology, state, event)),
    'segment-roll': withPrune(placeholderReducer),
    'retention-delete': withPrune(placeholderReducer),
    'consumer-join': withPrune((state, event) => applyConsumerJoin(topology, state, event)),
    'consumer-leave': withPrune((state, event) => applyConsumerLeave(topology, state, event)),
    seek: withPrune(applySeekEvent),
    pause: withPrune(applyPauseEvent),
    resume: withPrune(applyResumeEvent),
    'broker-down': withPrune(applyBrokerDown),
    'broker-up': withPrune(applyBrokerUp),
    'join-group': withPrune(applyJoinGroup),
    'sync-group': withPrune(applySyncGroup),
    heartbeat: withPrune(applyHeartbeat),
    'rebalance-complete': withPrune(applyRebalanceComplete),
    'member-timeout': withPrune(applyMemberTimeout),
    'consumer-stall': withPrune(applyConsumerStall),
    'processing-error': withPrune(applyProcessingErrorArm),
    'replica-lag': withPrune(applyReplicaLag),
  }
}

export function createKafkaSimulation(
  options: KafkaSimulationOptions,
): Simulation<KafkaState> & { readonly issues: KafkaValidationIssue[] } {
  const issues = validateKafkaTopology(options.topology, options.script)
  const reducers = createReducers(options.topology)
  const sim = createKernel<KafkaState, KafkaEventType>({
    createState: () => createState(options.topology, options.seed),
    seedEvents: () => seedEvents(options),
    reducers,
    fatal: issues.some((issue) => issue.severity === 'error'),
    maxEvents: options.maxEvents,
  })
  return Object.assign(sim, { issues })
}
