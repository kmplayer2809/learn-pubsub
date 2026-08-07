import { Background, Controls, ReactFlow, type Connection, type Node, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useMemo } from 'react'
import type { EngineState, ScriptedAction, Topology } from '../../../brokers/rabbitmq/engine'
import { useSandboxStore } from '../../../brokers/rabbitmq/sandbox/sandboxStore'
import { useAppStore } from '../../store'
import { MessageLayer } from '../canvas/MessageLayer'
import { ConsumerNode, ExchangeNode, PublisherNode, QueueNode } from '../../../brokers/rabbitmq/ui/nodes'
import { toFlowEdges, toFlowNodes } from '../../../brokers/rabbitmq/ui/toFlow'

// Defined here rather than exported from nodes.tsx: mixing a components-only
// file with a plain object export breaks React Fast Refresh for that file.
const nodeTypes = {
  publisher: PublisherNode,
  exchange: ExchangeNode,
  queue: QueueNode,
  consumer: ConsumerNode,
}

export function CanvasView({
  topology,
  state,
  script = [],
  highlight,
  editable = false,
}: {
  topology: Topology
  state: EngineState
  /** Needed only to derive RPC reply edges, which the topology cannot express. */
  script?: ScriptedAction[]
  /**
   * Node ids the active narrative step emphasises. Resolved by `App` — the canvas
   * deliberately knows nothing about lessons, and the sandbox has no narrative to
   * resolve, so it passes nothing.
   */
  highlight?: string[]
  /** True in the sandbox: enables dragging nodes and drawing new connections. */
  editable?: boolean
}) {
  const selectNode = useAppStore((s) => s.selectNode)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)
  const updateNode = useSandboxStore((s) => s.updateNode)
  const addBinding = useSandboxStore((s) => s.addBinding)

  const nodes = useMemo(
    () => toFlowNodes(topology, state, highlight).map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [topology, state, highlight, selectedNodeId],
  )
  const edges = useMemo(() => toFlowEdges(topology, script), [topology, script])

  // Nodes are always derived from `topology` above, so a drag has nowhere to
  // live unless it is written back into the sandbox topology here — the next
  // render then reflects it via `toFlowNodes`.
  const handleNodesChange = useCallback(
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
  const handleConnect = useCallback(
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

  return (
    <div className="relative h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node: Node) => selectNode(node.id)}
        onPaneClick={() => selectNode(undefined)}
        nodesDraggable={editable}
        nodesConnectable={editable}
        onNodesChange={editable ? handleNodesChange : undefined}
        onConnect={editable ? handleConnect : undefined}
      >
        <Background color="#1e293b" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <MessageLayer state={state} />
    </div>
  )
}
