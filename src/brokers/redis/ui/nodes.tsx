import { Handle, Position, type NodeProps } from '@xyflow/react'

const SHELL = 'rounded-lg border px-3 py-2 text-xs shadow-lg'

// Same convention as RabbitMQ's `nodes.tsx` (src/brokers/rabbitmq/ui/nodes.tsx): a dashed,
// offset, fuchsia outline for the narrative highlight, kept visually separate from the
// solid same-hue `ring-2` used for `selected`. `App.test.tsx` finds highlighted nodes by
// this exact class, so it is not free to drift between brokers.
const HIGHLIGHT = 'outline-dashed outline-2 outline-offset-4 outline-fuchsia-400'

function highlightClass(data: NodeProps['data']): string {
  return data.highlighted ? HIGHLIGHT : ''
}

// cyan/rose: neither hue is used by a RabbitMQ node kind (sky, violet, emerald, amber), and
// the two are far enough apart on the wheel that client and server stay visually distinct
// even next to each other on the canvas.
export function ClientNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-cyan-500 bg-cyan-950 ${selected ? 'ring-2 ring-cyan-300' : ''} ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-cyan-200">{String(data.label)}</div>
      <div className="text-[10px] text-cyan-400">client</div>
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
      className={`${SHELL} border-rose-500 bg-rose-950 ${selected ? 'ring-2 ring-rose-300' : ''} ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-rose-200">{String(data.label)}</div>
      <div className="text-[10px] text-rose-400">{keysCount} keys</div>
      <div className="text-[10px] text-rose-400">
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
      className={`${SHELL} border-amber-500 bg-amber-950 ${selected ? 'ring-2 ring-amber-300' : ''} ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-amber-200">{String(data.label)}</div>
      {isPromotedPrimary ? (
        <div className="text-[10px] text-amber-400">primary (đã được promote)</div>
      ) : (
        <>
          <div className="text-[10px] text-amber-400">lag {String(data.lagMs)}ms</div>
          <div className="text-[10px] text-amber-400">{behind === 0 ? 'đã bắt kịp' : `chậm ${behind} ghi`}</div>
        </>
      )}
    </div>
  )
}

export function SentinelNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-violet-500 bg-violet-950 ${selected ? 'ring-2 ring-violet-300' : ''} ${highlightClass(data)}`}
    >
      <Handle type="source" position={Position.Left} />
      <div className="font-semibold text-violet-200">{String(data.label)}</div>
      <div className="text-[10px] text-violet-400">sentinel</div>
    </div>
  )
}
