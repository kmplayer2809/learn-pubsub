import { Handle, Position, type NodeProps } from '@xyflow/react'

const SHELL = 'min-w-[124px] rounded-xl border px-3.5 py-2.5 shadow-node'

// Same convention as RabbitMQ's `nodes.tsx` (src/brokers/rabbitmq/ui/nodes.tsx): a dashed,
// offset, fuchsia outline for the narrative highlight, kept visually separate from the
// solid same-hue `ring-2` used for `selected`. `App.test.tsx` finds highlighted nodes by
// this exact class, so it is not free to drift between brokers.
const HIGHLIGHT = 'outline-dashed outline-2 outline-offset-4 outline-highlight'

function highlightClass(data: NodeProps['data']): string {
  return data.highlighted ? HIGHLIGHT : ''
}

// cyan/rose: neither hue is used by a RabbitMQ node kind (sky, violet, emerald, amber), and
// the two are far enough apart on the wheel that client and server stay visually distinct
// even next to each other on the canvas.
export function ClientNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-role-cyan-line bg-role-cyan ${selected ? 'ring-2 ring-role-cyan-ring' : ''} ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-cyan-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-cyan-fg/70">client</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function ServerNode({ data, selected }: NodeProps) {
  const keysCount = Number(data.keysCount)
  const memoryUsed = Number(data.memoryUsed)
  const maxmemoryBytes = data.maxmemoryBytes as number | undefined
  const evictionPolicy = data.evictionPolicy as string | undefined

  return (
    <div
      className={`${SHELL} border-role-rose-line bg-role-rose ${selected ? 'ring-2 ring-role-rose-ring' : ''} ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-rose-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-rose-fg/70">{keysCount} keys</div>
      <div className="font-mono text-meta text-role-rose-fg/70">
        {/* No limit set: say so explicitly rather than rendering `memoryUsed / undefined`. */}
        {maxmemoryBytes === undefined
          ? `${memoryUsed}B · không giới hạn`
          : `${memoryUsed} / ${maxmemoryBytes}B · ${evictionPolicy ?? 'noeviction'}`}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// amber/violet: the two remaining hues RabbitMQ doesn't use (see the client/server comment
// above — client took cyan, server took rose), keeping all four Redis node kinds visually
// distinct from one another and from any RabbitMQ node on the same screen.
export function ReplicaNode({ data, selected }: NodeProps) {
  const appliedWriteCounter = Number(data.appliedWriteCounter)
  const writeCounter = Number(data.writeCounter)
  const behind = writeCounter - appliedWriteCounter
  const isPromotedPrimary = Boolean(data.isPromotedPrimary)

  return (
    <div
      className={`${SHELL} border-role-amber-line bg-role-amber ${selected ? 'ring-2 ring-role-amber-ring' : ''} ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-amber-fg">{String(data.label)}</div>
      {isPromotedPrimary ? (
        <div className="font-mono text-meta text-role-amber-fg/70">primary (đã được promote)</div>
      ) : (
        <>
          <div className="font-mono text-meta text-role-amber-fg/70">lag {String(data.lagMs)}ms</div>
          <div className="font-mono text-meta text-role-amber-fg/70">
            {behind === 0 ? 'đã bắt kịp' : `chậm ${behind} ghi`}
          </div>
        </>
      )}
    </div>
  )
}

export function SentinelNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-role-violet-line bg-role-violet ${selected ? 'ring-2 ring-role-violet-ring' : ''} ${highlightClass(data)}`}
    >
      <Handle type="source" position={Position.Left} />
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-violet-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-violet-fg/70">sentinel</div>
    </div>
  )
}
