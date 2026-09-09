import { Background, Controls, ReactFlow, type Connection, type Node, type NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import type { AnyBrokerModule } from '../../../brokers/types'
import type { KernelState } from '../../kernel/types'
import { useAppStore } from '../../store'
import { MessageLayer } from '../canvas/MessageLayer'

// Hoisted so the default lands in `toEdges`'s `useMemo` dependency list (below) as the
// same reference on every render. A fresh `[]` literal as a default parameter value is
// re-created every render, which would invalidate that memo every time for any caller
// that omits `script` — the same class of bug `useSimulation`'s `EMPTY_SCRIPT` exists to
// avoid for `useSyncExternalStore`.
const EMPTY_SCRIPT: never[] = []

/**
 * React Flow mặc định `minZoom` là 0.5. Một cluster ba broker sáu partition không
 * lọt vào bề ngang 393px ở mức đó, nên người dùng iPhone chỉ thấy một góc canvas
 * và không zoom ra xa hơn được.
 */
export const MIN_ZOOM = 0.25
/** Chừa mép để node ngoài cùng không dính sát viền — hằng số vì cả `fitView` lúc
 *  mount lẫn hai effect fit lại bên dưới đều phải dùng đúng một giá trị. */
export const FIT_VIEW_OPTIONS = { padding: 0.15 }

export function CanvasView({
  broker,
  topology,
  state,
  script = EMPTY_SCRIPT,
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
  const brokerId = useAppStore((s) => s.brokerId)
  const lessonId = useAppStore((s) => s.lessonId)

  // Nodes depend on the live simulation state and rerun every tick; edges depend only
  // on the topology and script, which change on a lesson/sandbox-topology switch — not
  // on every tick. Memoizing them together (the old fused `toFlow`) forced a full edge
  // rebuild every tick and handed React Flow a new `edges` array identity every frame.
  const rawNodes = useMemo(
    () => broker.toNodes(topology, state, highlight),
    [broker, topology, state, highlight],
  )
  const edges = useMemo(() => broker.toEdges(topology, script), [broker, topology, script])
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

  const containerRef = useRef<HTMLDivElement>(null)
  // Typed to the exact node/edge shapes React Flow infers from `nodes`/`edges` below
  // (our mapped nodes make `selected` required, unlike the library's default optional
  // `Node`) — the bare `ReactFlowInstance` default generic rejects `onInit`'s instance.
  const flowRef = useRef<ReactFlowInstance<(typeof nodes)[number], (typeof edges)[number]> | null>(null)

  // Xoay máy, đổi tab ở mobile, hay bàn phím ảo hiện lên đều đổi kích thước
  // container mà không đổi prop nào — không có `ResizeObserver` thì viewport giữ
  // nguyên transform cũ và topology nằm lệch ngoài khung.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      // Gộp nhiều lần báo kích thước trong cùng một frame. `requestAnimationFrame`
      // chứ không phải `setTimeout` — file này ở `src/shell/ui/`, ngoài vùng
      // `purity.test.ts` soi, nhưng không tạo tiền lệ dùng timer trong repo.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => flowRef.current?.fitView(FIT_VIEW_OPTIONS))
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  // Đổi lesson hay đổi broker là đổi hẳn bộ node; viewport cũ gần như chắc chắn
  // sai khung. Cố tình khoá theo `brokerId`/`lessonId` từ store — KHÔNG theo
  // `topology` object reference. Trong Sandbox, `useSandboxStore.updateNode`
  // (src/brokers/rabbitmq/sandbox/sandboxStore.ts) trả về một `topology` mới
  // trên mỗi mutation, và `onNodesChange` (src/brokers/rabbitmq/ui/editing.ts)
  // gọi `updateNode` cho mỗi thay đổi `'position'` — tức mỗi frame con trỏ di
  // chuyển khi kéo node. Nếu effect này khoá theo `topology`, mỗi frame kéo sẽ
  // gọi lại `fitView()`, recenter/rescale viewport ngay giữa lúc React Flow còn
  // đang theo dõi thao tác kéo dựa trên transform mà lệnh đó vừa đổi — kéo node
  // trong Sandbox trở nên không dùng được. `brokerId`/`lessonId` chỉ đổi khi
  // người dùng thực sự chuyển bài/broker, nên không bị churn theo từng lần kéo.
  useEffect(() => {
    flowRef.current?.fitView(FIT_VIEW_OPTIONS)
  }, [brokerId, lessonId])

  return (
    <div ref={containerRef} className="relative h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={broker.nodeTypes}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={MIN_ZOOM}
        onInit={(instance) => {
          flowRef.current = instance
        }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node: Node) => selectNode(node.id)}
        onPaneClick={() => selectNode(undefined)}
        nodesDraggable={editable}
        nodesConnectable={editable}
        onNodesChange={editable ? handleNodesChange : undefined}
        onConnect={editable ? handleConnect : undefined}
      >
        <Background color="rgb(var(--border-subtle))" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <MessageLayer flights={flights} now={state.now} />
    </div>
  )
}
