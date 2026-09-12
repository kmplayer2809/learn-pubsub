import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { RedisState, RedisTopology } from '../engine'

/**
 * `highlight` carries the active narrative step's `NarrativeStep.highlight` ids (see
 * RabbitMQ's `toFlowNodes` for the identical convention). Ids that match no node are
 * ignored, never thrown on: a lesson may name a node it later removes, and a silent
 * miss is far better than a canvas that crashes mid-run.
 *
 * Node `position` is taken straight from the topology's own spec objects rather than
 * copied into a fresh literal, so it stays referentially stable across ticks — this
 * lands in a `useMemo` in `CanvasView`, and a new position object every render would
 * re-layout the canvas on every frame.
 */
export function toFlowNodes(topology: RedisTopology, state: RedisState, highlight: string[] = []): Node[] {
  const emphasised = new Set(highlight)

  const clients = topology.clients.map<Node>((client) => ({
    id: client.id,
    type: 'client',
    position: client.position,
    data: { label: client.label, highlighted: emphasised.has(client.id) },
  }))

  const server = topology.server
  const serverNode: Node = {
    id: server.id,
    type: 'server',
    position: server.position,
    data: {
      label: server.label,
      keysCount: state.metrics.keysCount,
      memoryUsed: state.metrics.memoryUsed,
      maxmemoryBytes: server.maxmemoryBytes,
      evictionPolicy: server.evictionPolicy,
      highlighted: emphasised.has(server.id),
    },
  }

  const replicaNodes = (topology.replicas ?? []).map<Node>((replica) => ({
    id: replica.id,
    type: 'replica',
    position: replica.position,
    data: {
      label: replica.label,
      lagMs: replica.lagMs,
      appliedWriteCounter: state.replicaState[replica.id]?.appliedWriteCounter ?? 0,
      writeCounter: state.writeCounter,
      highlighted: emphasised.has(replica.id),
      // Once Sentinel has promoted this replica (state.primaryId points at it instead of the
      // original server), the "behind a primary" lag framing is stale — this node IS the
      // primary now. ReplicaNode swaps in a promoted label instead of computing a lag line.
      isPromotedPrimary: state.primaryId !== server.id && state.primaryId === replica.id,
    },
  }))

  const sentinelNodes = (topology.sentinels ?? []).map<Node>((sentinel) => ({
    id: sentinel.id,
    type: 'sentinel',
    position: sentinel.position,
    data: { label: sentinel.label, highlighted: emphasised.has(sentinel.id) },
  }))

  return [...clients, serverNode, ...replicaNodes, ...sentinelNodes]
}

function edge(source: string, target: string): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    animated: false,
    style: { stroke: 'rgb(var(--border-strong))' },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'rgb(var(--border-strong))' },
  }
}

/**
 * One edge per direction, per client: `c1->redis` for the outbound command and
 * `redis->c1` for its reply. Both are required — `MessageLayer` looks an edge up by id
 * to place the animated particle, and the engine mints exactly these two ids for a
 * command/reply pair (see `COMMAND_TRAVEL_MS` and the flight construction in
 * `engine/index.ts`). Dropping either direction leaves half the traffic with nowhere
 * to animate.
 *
 * Takes only the topology, unlike RabbitMQ's `toFlowEdges(topology, script)`: a
 * client's edges to the server never depend on which commands it happens to run.
 * `Amendment 1` covers adapting this at the `BrokerModule` boundary in Task 9 —
 * `toEdges: (topology) => toFlowEdges(topology)` — rather than widening this
 * signature to accept a script it would never read.
 */
export function toFlowEdges(topology: RedisTopology): Edge[] {
  const serverId = topology.server.id
  const edges: Edge[] = []
  for (const client of topology.clients) {
    edges.push(edge(client.id, serverId))
    edges.push(edge(serverId, client.id))
  }
  for (const replica of topology.replicas ?? []) {
    edges.push({
      ...edge(serverId, replica.id),
      style: { stroke: 'rgb(var(--border-strong))', strokeDasharray: '4 4' },
    })
  }
  for (const sentinel of topology.sentinels ?? []) {
    edges.push(edge(sentinel.id, serverId))
  }
  return edges
}
