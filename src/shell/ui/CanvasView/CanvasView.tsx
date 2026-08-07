import { Background, Controls, ReactFlow, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import type { EngineState, ScriptedAction, Topology } from '../../../brokers/rabbitmq/engine'
import { useAppStore } from '../../store'
import { MessageLayer } from '../canvas/MessageLayer'
import { ConsumerNode, ExchangeNode, PublisherNode, QueueNode } from '../../../brokers/rabbitmq/ui/nodes'
import { toFlowEdges, toFlowNodes } from '../../../brokers/rabbitmq/ui/toFlow'
import { useRabbitEditing } from '../../../brokers/rabbitmq/ui/editing'

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

  const nodes = useMemo(
    () => toFlowNodes(topology, state, highlight).map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [topology, state, highlight, selectedNodeId],
  )
  const edges = useMemo(() => toFlowEdges(topology, script), [topology, script])

  // Task 7 satisfies BrokerSandbox.useEditing with the RabbitMQ implementation directly;
  // Tasks 8-11 route this through the selected BrokerModule instead.
  const { onNodesChange: handleNodesChange, onConnect: handleConnect } = useRabbitEditing(topology)

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
