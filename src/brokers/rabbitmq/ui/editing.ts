import type { Connection, NodeChange } from '@xyflow/react'
import type { Topology } from '../engine'
import { useSandboxStore } from '../sandbox/sandboxStore'

// Plain functions, not hooks: `CanvasView` calls these directly as React Flow event
// handlers (see the `BrokerSandbox.editing` amendment in `src/brokers/types.ts`), so
// they read the sandbox store through `getState()` rather than a bound selector.

// Nodes are always derived from `topology`, so a drag has nowhere to live unless it
// is written back into the sandbox topology here — the next render then reflects it
// via `toFlowNodes`. `_topology` is unused: a node's own id is enough to relocate it.
export function onNodesChange(_topology: Topology, changes: NodeChange[]): void {
  const { updateNode } = useSandboxStore.getState()
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      updateNode(change.id, { position: change.position })
    }
  }
}

// A connection dragged from an exchange's source handle becomes a binding. One from a
// queue to a consumer instead rewires which queue that consumer reads from — the
// topology has no other way to express "this edge exists" for that pair.
export function onConnect(topology: Topology, connection: Connection): void {
  if (!connection.source || !connection.target) return
  const { addBinding, updateNode } = useSandboxStore.getState()
  if (topology.exchanges.some((e) => e.id === connection.source)) {
    addBinding(connection.source, connection.target, '')
    return
  }
  if (topology.queues.some((q) => q.id === connection.source)) {
    updateNode(connection.target, { queueId: connection.source })
  }
}
