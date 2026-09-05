import { create } from 'zustand'
import type { KafkaScriptedCommand, KafkaTopology, NodeId } from '../engine'

export function emptyTopology(): KafkaTopology {
  return { brokers: [], topics: [], producers: [], consumers: [], controllerBrokerId: '' }
}

/** `produceManually`'s input — everything a `produce` command needs except `at`, which
 *  the store itself assigns (see the why-comment on `produceManually` below). */
export type ManualProduceInput = {
  producerId: NodeId
  topic: string
  key?: string | null
  value: string | null
  partition?: number
  headers?: Record<string, string>
}

interface KafkaSandboxState {
  topology: KafkaTopology
  script: KafkaScriptedCommand[]
  /**
   * Sandbox-only bookkeeping: which topics a canvas drag has wired a producer to write
   * to. This is deliberately NOT a field on `KafkaTopology` — `KafkaProducerSpec` has no
   * topic list (see the why-comment on `toFlowEdges` in `ui/toFlow.ts`: only a script's own
   * `produce` commands know where a producer actually writes, by design). Keeping this out
   * of `KafkaTopology` means `getTopology()` keeps returning exactly the engine's own shape,
   * unmodified by a UI-only convenience the engine has no use for.
   */
  producerTopics: Record<NodeId, string[]>
  addBroker(position: { x: number; y: number }): void
  addTopic(name: string, partitions: number, replicationFactor: number): void
  addProducer(position: { x: number; y: number }): void
  addConsumer(position: { x: number; y: number }): void
  updateNode(id: NodeId, patch: Record<string, unknown>): void
  setPartitionCount(topicName: string, partitions: number): void
  setReplicationFactor(topicName: string, replicationFactor: number): void
  addProducerTopic(producerId: NodeId, topic: string): void
  addConsumerSubscription(consumerId: NodeId, topic: string): void
  produceManually(command: ManualProduceInput): void
  reset(): void
}

let counter = 0
const mintId = (kind: string) => `${kind}-${++counter}`

export const useKafkaSandbox = create<KafkaSandboxState>((set) => ({
  topology: emptyTopology(),
  script: [],
  producerTopics: {},

  addBroker(position) {
    const id = mintId('broker')
    set((s) => ({
      topology: {
        ...s.topology,
        brokers: [...s.topology.brokers, { id, label: id, position }],
        // The first broker added becomes the controller by default — an empty sandbox
        // otherwise starts with no broker able to satisfy `controllerBrokerId` at all,
        // which trips `unknown-controller` the instant a learner adds anything else.
        controllerBrokerId: s.topology.controllerBrokerId || id,
      },
    }))
  },

  addTopic(name, partitions, replicationFactor) {
    set((s) => ({
      topology: { ...s.topology, topics: [...s.topology.topics, { name, partitions, replicationFactor }] },
    }))
  },

  addProducer(position) {
    const id = mintId('producer')
    set((s) => ({
      topology: {
        ...s.topology,
        producers: [...s.topology.producers, { id, label: id, position, acks: 'all' as const }],
      },
    }))
  },

  addConsumer(position) {
    const id = mintId('consumer')
    set((s) => ({
      topology: {
        ...s.topology,
        consumers: [
          ...s.topology.consumers,
          { id, label: id, position, groupId: 'group-1', subscriptions: [] },
        ],
      },
    }))
  },

  updateNode(id, patch) {
    set((s) => {
      const apply = <T extends { id: string }>(list: T[]) =>
        list.map((item) => (item.id === id ? { ...item, ...patch } : item))
      return {
        topology: {
          ...s.topology,
          brokers: apply(s.topology.brokers),
          producers: apply(s.topology.producers),
          consumers: apply(s.topology.consumers),
        },
      }
    })
  },

  setPartitionCount(topicName, partitions) {
    set((s) => ({
      topology: {
        ...s.topology,
        topics: s.topology.topics.map((t) => (t.name === topicName ? { ...t, partitions } : t)),
      },
    }))
  },

  // Deliberately no clamp against `topology.brokers.length` here: a sandbox learner setting
  // replicationFactor above the broker count is exactly the scenario Lesson-style validation
  // exists to surface. `validateKafkaTopology`'s `replication-factor-too-high` error is the
  // single place that judgment lives — this setter just records what was asked for.
  setReplicationFactor(topicName, replicationFactor) {
    set((s) => ({
      topology: {
        ...s.topology,
        topics: s.topology.topics.map((t) => (t.name === topicName ? { ...t, replicationFactor } : t)),
      },
    }))
  },

  addProducerTopic(producerId, topic) {
    set((s) => {
      const existing = s.producerTopics[producerId] ?? []
      if (existing.includes(topic)) return s
      return { producerTopics: { ...s.producerTopics, [producerId]: [...existing, topic] } }
    })
  },

  addConsumerSubscription(consumerId, topic) {
    set((s) => ({
      topology: {
        ...s.topology,
        consumers: s.topology.consumers.map((c) =>
          c.id === consumerId && !c.subscriptions.includes(topic)
            ? { ...c, subscriptions: [...c.subscriptions, topic] }
            : c,
        ),
      },
    }))
  },

  // `at` is minted here, not supplied by the caller: a manual produce button has no
  // meaningful virtual clock of its own the way a lesson script does, and successive
  // clicks must still land in increasing order or the engine's seeded-event ordering
  // (`seq` tie-break aside) reads as a burst of simultaneous produces instead of a
  // deliberate sequence of clicks.
  produceManually(command) {
    set((s) => {
      const lastAt = s.script.length === 0 ? -100 : Math.max(...s.script.map((c) => c.at))
      return { script: [...s.script, { ...command, kind: 'produce' as const, at: lastAt + 100 }] }
    })
  },

  reset() {
    set({ topology: emptyTopology(), script: [], producerTopics: {} })
  },
}))

// Plain functions, not hooks — see the why-comment on `BrokerSandbox` in
// `src/brokers/types.ts`. `useSimulation` drives `getTopology`/`getScript` through a fixed
// pair of `useSyncExternalStore` calls, so the hook count at that call site must not vary
// with which broker is active; a bound Zustand selector here would break that.
export function getTopology(): KafkaTopology {
  return useKafkaSandbox.getState().topology
}

export function getScript(): KafkaScriptedCommand[] {
  return useKafkaSandbox.getState().script
}

export function subscribe(onStoreChange: () => void): () => void {
  return useKafkaSandbox.subscribe(onStoreChange)
}

export function resetSandbox(): void {
  useKafkaSandbox.getState().reset()
}
