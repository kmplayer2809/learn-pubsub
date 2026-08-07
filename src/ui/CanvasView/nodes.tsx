import { Handle, Position, type NodeProps } from '@xyflow/react'

const SHELL = 'rounded-lg border px-3 py-2 text-xs shadow-lg'

export function PublisherNode({ data, selected }: NodeProps) {
  return (
    <div className={`${SHELL} border-sky-500 bg-sky-950 ${selected ? 'ring-2 ring-sky-300' : ''}`}>
      <div className="font-semibold text-sky-200">{String(data.label)}</div>
      <div className="text-[10px] text-sky-400">publisher</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function ExchangeNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-violet-500 bg-violet-950 ${selected ? 'ring-2 ring-violet-300' : ''}`}
      style={{ borderRadius: 999 }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-violet-200">{String(data.label)}</div>
      <div className="text-[10px] text-violet-400">{String(data.exchangeType)} exchange</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function QueueNode({ data, selected }: NodeProps) {
  const depth = Number(data.depth)
  const messages = (data.messages as string[]) ?? []
  return (
    <div className={`${SHELL} border-emerald-500 bg-emerald-950 ${selected ? 'ring-2 ring-emerald-300' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <span className="font-semibold text-emerald-200">{String(data.label)}</span>
        <span className="rounded bg-emerald-800 px-1 text-[10px] text-emerald-100">{depth}</span>
      </div>
      <div className="mt-1 flex gap-[2px]">
        {messages.map((id) => (
          <span key={id} className="h-3 w-2 rounded-sm bg-emerald-400" title={id} />
        ))}
        {depth > messages.length && (
          <span className="ml-1 text-[10px] text-emerald-300">+{depth - messages.length}</span>
        )}
      </div>
      {data.ttlMs !== undefined && (
        <div className="text-[10px] text-amber-300">ttl {String(data.ttlMs)}ms</div>
      )}
      {data.maxLength !== undefined && (
        <div className="text-[10px] text-amber-300">max-length {String(data.maxLength)}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function ConsumerNode({ data, selected }: NodeProps) {
  const crashed = Boolean(data.crashed)
  return (
    <div
      className={`${SHELL} border-amber-500 bg-amber-950 ${selected ? 'ring-2 ring-amber-300' : ''} ${
        crashed ? 'opacity-40 line-through' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold text-amber-200">{String(data.label)}</div>
      <div className="text-[10px] text-amber-400">
        prefetch {String(data.prefetch)} · unacked {String(data.unacked)}
        {data.autoAck ? ' · auto-ack' : ''}
      </div>
    </div>
  )
}

