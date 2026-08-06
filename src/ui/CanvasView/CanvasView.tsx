import { Background, Controls, ReactFlow, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import type { EngineState, Topology } from '../../engine'
import { useAppStore } from '../../sim/store'
import { MessageLayer } from '../canvas/MessageLayer'
import { nodeTypes } from './nodes'
import { toFlowEdges, toFlowNodes } from './toFlow'

export function CanvasView({ topology, state }: { topology: Topology; state: EngineState }) {
  const selectNode = useAppStore((s) => s.selectNode)
  const selectedNodeId = useAppStore((s) => s.selectedNodeId)

  const nodes = useMemo(
    () => toFlowNodes(topology, state).map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [topology, state, selectedNodeId],
  )
  const edges = useMemo(() => toFlowEdges(topology), [topology])

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
      >
        <Background color="#1e293b" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <MessageLayer state={state} />
    </div>
  )
}
