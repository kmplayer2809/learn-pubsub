import { applyPause, applyResume, applySeek, fetchRecords } from './consume'
import { createPartition } from './log'
import { enqueueRecord, flushBatch, PRODUCE_RESPONSE_TRAVEL_MS } from './produce'
import { partitionKey, sortedPartitionKeys } from './types'
import type {
  ConsumerRuntime,
  GroupMember,
  GroupState,
  KafkaConsumerSpec,
  KafkaEventType,
  KafkaFault,
  KafkaProducerSpec,
  KafkaScriptedCommand,
  KafkaState,
  KafkaTopicSpec,
  KafkaTopology,
  NodeId,
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
      case 'consumer-stall':
      case 'replica-lag':
      case 'processing-error':
      case 'produce-error':
        // Bốn fault này thuộc phần idempotent-producer (Task 11, `produce-error`)
        // hoặc replication (một plan sau) — cùng lý do bỏ qua như ba lệnh
        // transaction ở trên, không phải một lỗ hổng bị quên.
        break
    }
  }

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

// --- Reducers: consumer path -------------------------------------------------

function applyConsumerJoin(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const spec = consumerSpec(topology, consumerId)

  const runtime: ConsumerRuntime = { position: {}, paused: [], lastPollAt: event.at }

  // Group coordinator thật (rebalance, assignor, heartbeat) thuộc một plan sau
  // (§B5.4) — `GroupState`/`GroupMember` ở đây chỉ ghi nhận thành viên một cách
  // trung thực (không bịa một assignment nào `fetchRecords` không hề dùng tới:
  // nó đọc thẳng `consumer.subscriptions` từ topology, không đọc `assignment`).
  const member: GroupMember = {
    memberId: consumerId,
    subscriptions: spec.subscriptions,
    assignment: [],
    lastHeartbeatAt: event.at,
    lastPollAt: event.at,
  }
  const existingGroup = state.groups[spec.groupId]
  const group: GroupState = existingGroup
    ? { ...existingGroup, generationId: existingGroup.generationId + 1, members: [...existingGroup.members, member] }
    : {
        groupId: spec.groupId,
        state: 'Stable',
        generationId: 1,
        leaderMemberId: consumerId,
        assignor: 'range',
        members: [member],
        committedOffsets: {},
        coordinatorBrokerId: topology.controllerBrokerId,
      }

  const [seq, afterSeq] = nextSeq(state)
  const nextState: KafkaState = {
    ...afterSeq,
    consumers: { ...afterSeq.consumers, [consumerId]: runtime },
    groups: { ...afterSeq.groups, [spec.groupId]: group },
    journal: [...afterSeq.journal, { at: event.at, type: 'consumer-join', text: `${consumerId} vào group ${spec.groupId}`, nodeId: consumerId }],
  }

  // `consumer-join` là nơi DUY NHẤT khởi động vòng poll — mọi `fetch-request` sau
  // đó tự hẹn lại chính nó (xem `applyFetchRequest`), không có chỗ nào khác cần
  // seed thêm.
  const firstPoll: SimEvent<KafkaEventType> = { at: event.at, seq, type: 'fetch-request', payload: { consumerId } }
  return { state: nextState, newEvents: [firstPoll] }
}

function applyConsumerLeave(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  if (state.consumers[consumerId] === undefined) return { state, newEvents: [] } // đã rời / chưa từng vào — no-op

  const nextConsumers = { ...state.consumers }
  delete nextConsumers[consumerId]

  // Xoá khỏi `state.consumers` chính là điều khiến `fetch-request` tự hẹn lại VÔ
  // ĐIỀU KIỆN cuối cùng phải dừng — xem gate ở đầu `applyFetchRequest`.
  const spec = consumerSpec(topology, consumerId)
  const group = state.groups[spec.groupId]
  const nextGroups = group
    ? {
        ...state.groups,
        [spec.groupId]: {
          ...group,
          generationId: group.generationId + 1,
          members: group.members.filter((m) => m.memberId !== consumerId),
        },
      }
    : state.groups

  return {
    state: {
      ...state,
      consumers: nextConsumers,
      groups: nextGroups,
      journal: [...state.journal, { at: event.at, type: 'consumer-leave', text: `${consumerId} rời group ${spec.groupId}`, nodeId: consumerId }],
    },
    newEvents: [],
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
  if (state.consumers[consumerId] === undefined) return { state, newEvents: [] }

  const spec = consumerSpec(topology, consumerId)
  const fetched = fetchRecords(state, { consumer: spec, at: event.at })

  const [seq, afterFetchSeq] = nextSeq(fetched.state)
  const nextPoll: SimEvent<KafkaEventType> = { at: event.at + POLL_INTERVAL_MS, seq, type: 'fetch-request', payload: { consumerId } }

  let workingState = afterFetchSeq
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
    const runtime = workingState.consumers[consumerId]
    if (processDone && runtime) {
      workingState = {
        ...workingState,
        consumers: { ...workingState.consumers, [consumerId]: { ...runtime, processingUntil: processDone.at } },
      }
    }
  }

  return { state: workingState, newEvents: [...fetched.newEvents, nextPoll] }
}

function applyProcessDone(state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const count = asNumber(event.payload.count, 'count')

  const runtime = state.consumers[consumerId]
  if (!runtime) return { state, newEvents: [] } // consumer đã rời group giữa lúc đang xử lý — no-op, không lỗi

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

function applyCommit(topology: KafkaTopology, state: KafkaState, event: SimEvent<KafkaEventType>): ReduceResult {
  const consumerId = asString(event.payload.consumerId, 'consumerId')
  const runtime = state.consumers[consumerId]
  if (!runtime) return { state, newEvents: [] }

  const spec = consumerSpec(topology, consumerId)
  const group = state.groups[spec.groupId]
  if (!group) return { state, newEvents: [] }

  // Chỉ commit những partition consumer THỰC SỰ có position — lọc qua
  // `sortedPartitionKeys(state)` thay vì lặp thẳng `Object.keys(runtime.position)`
  // để giữ determinism (§B6), dù committedOffsets là một Record nên thứ tự chèn ở
  // đây không đổi giá trị cuối cùng — chỉ đổi thứ tự journal nếu sau này có ghi
  // journal per-partition.
  const keys = sortedPartitionKeys(state).filter((key) => runtime.position[key] !== undefined)
  const committedOffsets = { ...group.committedOffsets }
  for (const key of keys) {
    const offset = runtime.position[key]
    if (offset === undefined) continue // đã lọc ở trên — chỉ để qua noUncheckedIndexedAccess
    committedOffsets[key] = { offset, committedAt: event.at }
  }

  return {
    state: {
      ...state,
      groups: { ...state.groups, [spec.groupId]: { ...group, committedOffsets } },
      metrics: { ...state.metrics, commits: state.metrics.commits + 1 },
      journal: [...state.journal, { at: event.at, type: 'commit', text: `${consumerId} commit ${keys.length} partition`, nodeId: consumerId }],
    },
    newEvents: [],
  }
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
// Năm nhánh dưới đây là thành viên của `KafkaEventType` (Task 1) nhưng KHÔNG một
// event nào trong wiring hiện tại (Task 1-6) từng sinh ra chúng — `REDUCERS` vẫn
// phải khai đủ vì nó được gõ kiểu `Record<KafkaEventType, Reducer>`, và đó chính
// là lý do union này tồn tại: thiếu một nhánh là lỗi compile, không phải lỗi
// runtime im lặng. Mỗi nhánh chỉ tăng `seq` cho đúng kỷ luật (mọi event đi qua
// kernel đều tiêu một seq) rồi trả nguyên state — không bịa hiệu ứng nào:
//   - `append`: phần ghi log của broker hiện GỘP thẳng vào `flushBatch` (Task 4),
//     gọi từ `batch-flush` ở trên. Event `append` tách riêng để dành cho một plan
//     sau muốn chèn độ trễ giữa "request tới broker" và "broker ghi xong đĩa".
//   - `deliver`: tương tự cho hướng consumer — `fetchRecords` (Task 5) trả record
//     ngay trong `fetch-request`, không qua một chặng mạng tách riêng.
//   - `produce-retry`: Task 11 (idempotent producer) sở hữu — xem brief của nó.
//   - `segment-roll`/`retention-delete`: `rollSegments`/`applyRetention` (Task 3)
//     là hàm thuần đã có và đã test, nhưng chưa được nối vào bất kỳ reducer nào ở
//     plan này — không lesson nào trong phạm vi P1-P3 (basics/producer) cần
//     retention chạy qua một simulation thật.
function placeholderReducer(state: KafkaState, _event: SimEvent<KafkaEventType>): ReduceResult {
  const [, afterSeq] = nextSeq(state)
  return { state: afterSeq, newEvents: [] }
}

// --- Wiring ------------------------------------------------------------------

function createReducers(topology: KafkaTopology): Record<KafkaEventType, Reducer> {
  return {
    'produce-request': withPrune((state, event) => applyProduceRequest(topology, state, event)),
    'batch-flush': withPrune((state, event) => applyBatchFlush(topology, state, event)),
    append: withPrune(placeholderReducer),
    'produce-response': withPrune(applyProduceResponse),
    'produce-retry': withPrune(placeholderReducer),
    'fetch-request': withPrune((state, event) => applyFetchRequest(topology, state, event)),
    deliver: withPrune(placeholderReducer),
    'process-done': withPrune(applyProcessDone),
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
