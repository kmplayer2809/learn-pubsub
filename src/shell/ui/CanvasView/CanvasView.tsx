import { Background, Controls, ReactFlow, type Connection, type Node, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useMemo } from 'react'
import type { AnyBrokerModule } from '../../../brokers/types'
import type { KernelState } from '../../kernel/types'
import { useAppStore } from '../../store'
import { MessageLayer } from '../canvas/MessageLayer'

export function CanvasView({
  broker,
  topology,
  state,
  script = [],
  highlight,
  editable = false,
}: {
  broker: AnyBrokerModule
  topology: unknown
  state: KernelState
  /** Needed only to derive RPC reply edges, which the topology cannot express. */
  script?: unknown[]
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

  const { nodes: rawNodes, edges } = useMemo(
    () => broker.toFlow(topology, state, script, highlight),
    [broker, topology, state, script, highlight],
  )
  const nodes = useMemo(
    () => rawNodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [rawNodes, selectedNodeId],
  )
  const flights = useMemo(() => broker.inFlight(state), [broker, state])

  // Called unconditionally to respect the rules of hooks: a broker with no sandbox
  // simply has nothing to call inside (broker.sandbox is undefined), and the result is
  // ignored entirely when `editable` is false. This does not add a hook the module
  // controls the count of — `broker.sandbox?.editing.on...` are plain functions, not
  // hooks, so only the two `useCallback`s below ever run, always, for every broker.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => broker.sandbox?.editing.onNodesChange(topology, changes),
    [broker, topology],
  )
  const handleConnect = useCallback(
    (connection: Connection) => broker.sandbox?.editing.onConnect(topology, connection),
    [broker, topology],
  )

  return (
    <div className="relative h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={broker.nodeTypes}
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
      <MessageLayer flights={flights} now={state.now} />
    </div>
  )
}
