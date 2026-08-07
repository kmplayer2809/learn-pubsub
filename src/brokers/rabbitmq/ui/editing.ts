import { useCallback } from 'react'
import type { Connection, NodeChange } from '@xyflow/react'
import type { Topology } from '../engine'
import { useSandboxStore } from '../sandbox/sandboxStore'

export function useRabbitEditing(topology: Topology) {
  const updateNode = useSandboxStore((s) => s.updateNode)
  const addBinding = useSandboxStore((s) => s.addBinding)

  // Nodes are always derived from `topology` above, so a drag has nowhere to
  // live unless it is written back into the sandbox topology here — the next
  // render then reflects it via `toFlowNodes`.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updateNode(change.id, { position: change.position })
        }
      }
    },
    [updateNode],
  )

  // A connection dragged from an exchange's source handle becomes a binding.
  // One dragged from a queue's source handle to a consumer instead rewires
  // which queue that consumer reads from — the topology has no other way to
  // express "this edge exists" for that pair.
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      if (topology.exchanges.some((e) => e.id === connection.source)) {
        addBinding(connection.source, connection.target, '')
        return
      }
      if (topology.queues.some((q) => q.id === connection.source)) {
        updateNode(connection.target, { queueId: connection.source })
      }
    },
    [topology, addBinding, updateNode],
  )

  return { onNodesChange, onConnect }
}
