import type { Edge, Node } from '@xyflow/react'
import type { EngineState, Topology } from '../../engine'

export function toFlowNodes(topology: Topology, state: EngineState): Node[] {
  const publishers = topology.publishers.map<Node>((p) => ({
    id: p.id,
    type: 'publisher',
    position: p.position,
    data: { label: p.label },
  }))

  const exchanges = topology.exchanges.map<Node>((e) => ({
    id: e.id,
    type: 'exchange',
    position: e.position,
    data: { label: e.label, exchangeType: e.type },
  }))

  const queues = topology.queues.map<Node>((q) => ({
    id: q.id,
    type: 'queue',
    position: q.position,
    data: {
      label: q.label,
      depth: (state.queues[q.id] ?? []).length,
      messages: (state.queues[q.id] ?? []).slice(0, 8).map((m) => m.message.id),
      maxLength: q.maxLength,
      ttlMs: q.messageTtlMs,
      kind: q.kind,
    },
  }))

  const consumers = topology.consumers.map<Node>((c) => ({
    id: c.id,
    type: 'consumer',
    position: c.position,
    data: {
      label: c.label,
      prefetch: c.prefetch,
      unacked: (state.unacked[c.id] ?? []).length,
      autoAck: c.autoAck,
      crashed: state.crashed.includes(c.id),
    },
  }))

  return [...publishers, ...exchanges, ...queues, ...consumers]
}

function edge(source: string, target: string, label?: string, dashed = false): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    label,
    animated: false,
    style: dashed
      ? { stroke: '#f43f5e', strokeDasharray: '6 4' }
      : { stroke: '#475569' },
  }
}

export function toFlowEdges(topology: Topology): Edge[] {
  const edges: Edge[] = []

  // Publishers connect to every exchange a script could target; the topology
  // does not model that link explicitly, so connect each publisher to each exchange
  // that has at least one binding.
  for (const p of topology.publishers) {
    for (const e of topology.exchanges) {
      if (topology.bindings.some((b) => b.exchangeId === e.id)) edges.push(edge(p.id, e.id))
    }
  }

  // A consumer that acks a message carrying `replyTo` becomes an ad-hoc
  // publisher too — the engine's RPC reply (advanced.ts buildReplyEvents)
  // is published with the consumer's own node id as the source. The topology
  // does not say which consumer will do this, so mirror the same heuristic
  // used for real publishers above.
  for (const c of topology.consumers) {
    for (const e of topology.exchanges) {
      if (topology.bindings.some((b) => b.exchangeId === e.id)) edges.push(edge(c.id, e.id, undefined, true))
    }
  }

  for (const binding of topology.bindings) {
    edges.push(edge(binding.exchangeId, binding.destinationId, binding.routingKey))
  }

  for (const consumer of topology.consumers) {
    edges.push(edge(consumer.queueId, consumer.id))
  }

  for (const queue of topology.queues) {
    if (queue.deadLetterExchange) {
      edges.push(edge(queue.id, queue.deadLetterExchange, 'dead-letter', true))
    }
  }

  const seen = new Set<string>()
  return edges.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}
