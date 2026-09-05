import type { Connection, NodeChange } from '@xyflow/react'
import type { KafkaTopology } from '../engine'
import { useKafkaSandbox } from '../sandbox/kafkaStore'

// Plain functions, not hooks: `CanvasView` calls these directly as React Flow event
// handlers (see the `BrokerSandbox.editing` amendment in `src/brokers/types.ts`), so
// they read the sandbox store through `getState()` rather than a bound selector.

// Nodes are always derived from `topology`, so a drag has nowhere to live unless it is
// written back into the sandbox topology here — the next render then reflects it via
// `toFlowNodes`. `_topology` is unused: a node's own id is enough to relocate it. Only
// broker/producer/consumer carry a `position` at all — partition and consumerGroup nodes
// are computed layout (see `ui/toFlow.ts`), so a drag on one of those has nothing to write.
export function onNodesChange(_topology: KafkaTopology, changes: NodeChange[]): void {
  const { updateNode } = useKafkaSandbox.getState()
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      updateNode(change.id, { position: change.position })
    }
  }
}

/**
 * The canvas never renders a standalone "topic" node — only its partitions, whose id is
 * `partitionKey(topic, index)` (`${topic}-${index}`, see `engine/types.ts`). A drag that
 * ends on one of those has to be resolved back to the topic it belongs to before either
 * side of `onConnect` below can act on it. Sorted longest-name-first so an overlapping pair
 * like `orders` and `orders-v2` resolves to the more specific match rather than whichever
 * happened to be declared first.
 */
function topicForPartitionNode(topology: KafkaTopology, nodeId: string): string | undefined {
  const candidates = topology.topics.filter((t) => {
    if (!nodeId.startsWith(`${t.name}-`)) return false
    const rest = nodeId.slice(t.name.length + 1)
    return /^\d+$/.test(rest) && Number(rest) < t.partitions
  })
  candidates.sort((a, b) => b.name.length - a.name.length)
  return candidates[0]?.name
}

// A connection dragged from a producer to one of a topic's partitions records that the
// producer writes to that topic (Sandbox-only bookkeeping — see the why-comment on
// `producerTopics` in `kafkaStore.ts` for why this is not a `KafkaTopology` field). One
// from a consumer to a partition instead adds the topic to that consumer's real
// `subscriptions`. Two brokers connected to each other has no meaning in this topology —
// there is no broker-to-broker edge concept — so it is silently ignored.
export function onConnect(topology: KafkaTopology, connection: Connection): void {
  if (!connection.source || !connection.target) return
  const { addProducerTopic, addConsumerSubscription } = useKafkaSandbox.getState()

  const isBrokerToBroker =
    topology.brokers.some((b) => b.id === connection.source) &&
    topology.brokers.some((b) => b.id === connection.target)
  if (isBrokerToBroker) return

  if (topology.producers.some((p) => p.id === connection.source)) {
    const topic = topicForPartitionNode(topology, connection.target)
    if (topic) addProducerTopic(connection.source, topic)
    return
  }

  if (topology.consumers.some((c) => c.id === connection.source)) {
    const topic = topicForPartitionNode(topology, connection.target)
    if (topic) addConsumerSubscription(connection.source, topic)
  }
}
