import type { Edge, Node } from '@xyflow/react'
import type { EngineState, ScriptedAction, Topology } from '../../engine'

/**
 * `highlight` carries the active narrative step's `NarrativeStep.highlight` ids, so the
 * canvas can emphasise exactly the nodes the prose is talking about. Ids that match no
 * node are ignored: a lesson may name a node it later removes, and a silent miss is far
 * better than a canvas that throws mid-run. In sandbox mode there is no narrative and the
 * argument is omitted, which marks every node unhighlighted.
 */
export function toFlowNodes(topology: Topology, state: EngineState, highlight: string[] = []): Node[] {
  const emphasised = new Set(highlight)

  const publishers = topology.publishers.map<Node>((p) => ({
    id: p.id,
    type: 'publisher',
    position: p.position,
    data: { label: p.label, highlighted: emphasised.has(p.id) },
  }))

  const exchanges = topology.exchanges.map<Node>((e) => ({
    id: e.id,
    type: 'exchange',
    position: e.position,
    data: { label: e.label, exchangeType: e.type, highlighted: emphasised.has(e.id) },
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
      highlighted: emphasised.has(q.id),
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
      highlighted: emphasised.has(c.id),
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

export function toFlowEdges(topology: Topology, script: ScriptedAction[] = []): Edge[] {
  const edges: Edge[] = []

  // The topology never models publisher -> exchange, so it has to be inferred. The
  // script says exactly which exchanges a publisher targets, and using it instead of
  // a publisher x exchange cross-product matters pedagogically: the cross-product drew
  // a solid `p1->main-ex` on 16-delayed while the entire lesson is that `main-ex` is
  // reachable ONLY by dead-lettering, plus `p1->dlx` on 11/12 (the publisher does not
  // publish into a dead-letter exchange) and `client->replies` on 14 (the client does
  // not publish its own replies).
  //
  // The old heuristic survives for a publisher with no scripted actions — a node just
  // dropped on the Sandbox canvas — so it still shows what it could feed rather than
  // floating disconnected.
  for (const p of topology.publishers) {
    const targets = new Set(script.filter((a) => a.publisherId === p.id).map((a) => a.exchangeId))
    if (targets.size > 0) {
      for (const exchangeId of targets) edges.push(edge(p.id, exchangeId))
      continue
    }
    for (const e of topology.exchanges) {
      if (topology.bindings.some((b) => b.exchangeId === e.id)) edges.push(edge(p.id, e.id))
    }
  }

  // A consumer that acks a message carrying `replyTo` becomes an ad-hoc publisher:
  // the engine's RPC reply (advanced.ts buildReplyEvents) is published with the
  // consumer's own node id as the source, so the message layer needs an edge named
  // `${consumerId}->${replyTo}` to animate over.
  //
  // Which consumer that is cannot be read off the topology, because the topology
  // never says where a request came from — only the script does, via `replyTo`. An
  // earlier version guessed with a consumer x exchange cross-product mirroring the
  // publisher heuristic above; that drew fabricated edges on all sixteen lessons
  // (four of eleven on 11-dlx alone) instead of the single real one on 14-rpc.
  for (const action of script) {
    if (!action.replyTo) continue
    const requestQueues = topology.bindings
      .filter((b) => b.exchangeId === action.exchangeId && b.destinationKind === 'queue')
      .map((b) => b.destinationId)
    for (const c of topology.consumers) {
      if (requestQueues.includes(c.queueId)) edges.push(edge(c.id, action.replyTo))
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
