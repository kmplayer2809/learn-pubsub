import type { KafkaScriptedCommand, KafkaState, KafkaTopology } from '../engine'
// `consumerLag` lives in `toFlow.ts` (it feeds the canvas' `ConsumerNode` lag badge) and is
// imported here instead of kept as a second copy: its correctness hinges entirely on
// `resolvePosition`'s contract (see that function's own comment for the Task 7 trap — a
// `noUncheckedIndexedAccess` guard in `consume.ts` that looks like a fallback rule but
// isn't one), and two independent copies of that logic is exactly the divergence hazard
// that already cost this plan a fix round once. One cross-file import inside Kafka's own
// `ui/` directory is cheaper than a second copy nobody notices drifting.
import { consumerLag } from './toFlow'
// The base `Lesson<KafkaTopology, KafkaScriptedCommand>`, not a narrower Kafka lesson
// type — there is none yet; lessons land in Task 9. Same reasoning as RabbitMQ's and
// Redis' `NodeConfig.tsx`: the `BrokerModule` contract's `NodeConfig` slot
// (`src/brokers/types.ts`) is typed against the base generic, and this component never
// reads a Kafka-lesson-only field, only `lesson.topology`.
import type { Lesson } from '../../../shell/lesson/types'

const GRID = 'grid grid-cols-1 gap-x-2 gap-y-1 text-meta text-content-muted sm:grid-cols-2'

export function NodeConfig({
  lesson,
  state,
  nodeId,
}: {
  lesson: Lesson<KafkaTopology, KafkaScriptedCommand>
  state: KafkaState
  nodeId: string
}) {
  const topology = lesson.topology
  const broker = topology.brokers.find((b) => b.id === nodeId)
  const producer = topology.producers.find((p) => p.id === nodeId)
  const consumer = topology.consumers.find((c) => c.id === nodeId)
  // Partition không phải một spec object riêng trong `KafkaTopology` (xem comment trên
  // `toFlow.ts`'s `PARTITION_OFFSET_X`) — id của nó là `partitionKey(topic, index)`, và
  // trạng thái sống của nó chỉ tồn tại trong `state.partitions`, không trong topology.
  const partition = state.partitions[nodeId]

  if (broker) {
    const online = state.brokersOnline[broker.id] ?? true
    // `state.controller`, không `topology.controllerBrokerId` — chúng khởi tạo bằng
    // nhau (`createSimulation` seed từ `topology.controllerBrokerId`) nhưng `state` là
    // nguồn sống; controller election (một plan sau) sẽ chỉ đổi `state.controller`.
    const isController = state.controller.brokerId === broker.id
    return (
      <dl className={GRID}>
        <dt>rack</dt>
        <dd className="text-content">{broker.rack ?? '—'}</dd>
        <dt>trạng thái</dt>
        <dd data-testid="broker-online" className={online ? 'text-content' : 'text-danger-fg'}>
          {online ? 'online' : 'offline'}
        </dd>
        <dt>controller</dt>
        <dd className="text-content">{isController ? `epoch ${state.controller.epoch}` : '—'}</dd>
        <dt>replica.fetch</dt>
        <dd className="text-content">{broker.replicaFetchEveryMs ?? 200}ms</dd>
        <dt>replica.lag.time.max</dt>
        <dd className="text-content">{broker.replicaLagTimeMaxMs ?? 10_000}ms</dd>
      </dl>
    )
  }

  if (partition) {
    const topic = topology.topics.find((t) => t.name === partition.topic)
    return (
      <dl className={GRID}>
        <dt>topic</dt>
        <dd className="truncate text-content">{partition.topic}</dd>
        <dt>leader</dt>
        <dd className="truncate text-content">{partition.leader}</dd>
        <dt>replicas</dt>
        <dd className="truncate text-content">{partition.replicas.join(', ')}</dd>
        <dt>isr</dt>
        <dd className="truncate text-content">{partition.isr.join(', ') || '—'}</dd>
        <dt>replicationFactor</dt>
        <dd className="text-content">{topic?.replicationFactor ?? partition.replicas.length}</dd>
        <dt>min.insync.replicas</dt>
        <dd className="text-content">{topic?.config?.minInsyncReplicas ?? '—'}</dd>
        <dt>log start offset</dt>
        <dd className="text-content">{partition.logStartOffset}</dd>
        <dt>high watermark</dt>
        <dd className="text-ok-fg">{partition.highWatermark}</dd>
        <dt>LEO</dt>
        <dd className="text-role-sky-fg">{partition.leo}</dd>
        <dt>leader epoch</dt>
        <dd className="text-content">{partition.leaderEpoch}</dd>
      </dl>
    )
  }

  if (producer) {
    const runtime = state.producers[producer.id]
    return (
      <dl className={GRID}>
        <dt>acks</dt>
        <dd className="text-content">{producer.acks ?? 'all'}</dd>
        <dt>idempotent</dt>
        <dd className="text-content">{producer.idempotent ? 'true' : 'false'}</dd>
        <dt>transactional.id</dt>
        <dd className="truncate text-content">{producer.transactionalId ?? '—'}</dd>
        <dt>retries</dt>
        <dd className="text-content">{producer.retries ?? '—'}</dd>
        <dt>max.in.flight</dt>
        <dd className="text-content">{producer.maxInFlight ?? 5}</dd>
        <dt>linger.ms</dt>
        <dd className="text-content">{producer.lingerMs ?? '—'}</dd>
        <dt>partitioner</dt>
        <dd className="text-content">{producer.partitioner ?? 'default'}</dd>
        <dt>in-flight requests</dt>
        <dd className="text-content">{runtime?.inFlightRequests ?? 0}</dd>
      </dl>
    )
  }

  if (consumer) {
    const runtime = state.consumers[consumer.id]
    const joined = runtime !== undefined
    return (
      <dl className={GRID}>
        <dt>group.id</dt>
        <dd className="truncate text-content">{consumer.groupId}</dd>
        <dt>subscriptions</dt>
        <dd className="truncate text-content">{consumer.subscriptions.join(', ')}</dd>
        <dt>auto.offset.reset</dt>
        <dd className="text-content">{consumer.autoOffsetReset ?? 'latest'}</dd>
        <dt>isolation.level</dt>
        <dd className="text-content">{consumer.isolationLevel ?? 'read_uncommitted'}</dd>
        <dt>trạng thái</dt>
        <dd className={joined ? 'text-content' : 'text-content-faint'}>
          {joined ? 'đã tham gia' : 'chưa tham gia'}
        </dd>
        {joined && (
          <>
            <dt>lag</dt>
            <dd data-testid="consumer-lag" className="text-warn-fg">
              {consumerLag(topology, state, consumer, runtime)}
            </dd>
            <dt>paused</dt>
            <dd className="truncate text-content">{runtime.paused.join(', ') || '—'}</dd>
          </>
        )}
      </dl>
    )
  }

  return <p className="text-meta text-content-faint">Node này không có cấu hình.</p>
}
