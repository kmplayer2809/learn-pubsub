import { Handle, Position, type NodeProps } from '@xyflow/react'

const SHELL = 'min-w-[124px] rounded-xl border px-3.5 py-2.5 shadow-node'

/**
 * The narrative highlight has to read as a different *kind* of state from `selected`,
 * because a node is routinely both at once: the reader clicks the node the prose is
 * pointing at. `selected` is a tight solid `ring-2` in the node's own hue, hugging the
 * border. The highlight is therefore a *dashed* outline in fuchsia — a hue no node kind
 * uses — held 4px clear of the border by `outline-offset`. Different shape (dashed vs
 * solid), different hue, different distance, so the two never merge into one thicker
 * band: a selected + highlighted node shows its hue ring hugging the border with the
 * fuchsia dashes floating outside it.
 *
 * `outline` is deliberately used rather than a second ring: Tailwind's ring utilities
 * share one box-shadow slot, so a ring-based highlight would overwrite `selected`.
 * These are plain utility classes on the node's own div, not React Flow's own elements,
 * so no `!important` cascade fight (see the note in `src/index.css`).
 */
const HIGHLIGHT = 'outline-dashed outline-2 outline-offset-4 outline-highlight'

function highlightClass(data: NodeProps['data']): string {
  return data.highlighted ? HIGHLIGHT : ''
}

export function PublisherNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-role-sky-line bg-role-sky ${selected ? 'ring-2 ring-role-sky-ring' : ''} ${highlightClass(data)}`}
    >
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-sky-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-sky-fg/70">publisher</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function ExchangeNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-role-violet-line bg-role-violet ${
        selected ? 'ring-2 ring-role-violet-ring' : ''
      } ${highlightClass(data)}`}
      style={{ borderRadius: 999 }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-violet-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-violet-fg/70">{String(data.exchangeType)} exchange</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function QueueNode({ data, selected }: NodeProps) {
  const depth = Number(data.depth)
  const messages = (data.messages as string[]) ?? []
  return (
    <div
      className={`${SHELL} border-role-emerald-line bg-role-emerald ${
        selected ? 'ring-2 ring-role-emerald-ring' : ''
      } ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <span className="max-w-[200px] truncate text-ui font-semibold text-role-emerald-fg">
          {String(data.label)}
        </span>
        <span className="rounded bg-surface px-1 text-meta text-role-emerald-fg">{depth}</span>
      </div>
      <div className="mt-1 flex gap-[2px]">
        {messages.map((id) => (
          <span key={id} className="h-3 w-2 rounded-sm bg-role-emerald-fg" title={id} />
        ))}
        {depth > messages.length && (
          <span className="ml-1 text-meta text-role-emerald-fg/70">+{depth - messages.length}</span>
        )}
      </div>
      {data.ttlMs !== undefined && <div className="text-meta text-warn-fg">ttl {String(data.ttlMs)}ms</div>}
      {data.maxLength !== undefined && (
        <div className="text-meta text-warn-fg">max-length {String(data.maxLength)}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function ConsumerNode({ data, selected }: NodeProps) {
  const crashed = Boolean(data.crashed)
  return (
    <div
      className={`${SHELL} border-role-amber-line bg-role-amber ${selected ? 'ring-2 ring-role-amber-ring' : ''} ${
        crashed ? 'opacity-40 line-through' : ''
      } ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-amber-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-amber-fg/70">
        prefetch {String(data.prefetch)} · unacked {String(data.unacked)}
        {data.autoAck ? ' · auto-ack' : ''}
      </div>
    </div>
  )
}
