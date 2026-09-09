import { Handle, Position, type NodeProps } from '@xyflow/react'

const SHELL = 'min-w-[124px] rounded-xl border px-3.5 py-2.5 shadow-node'

// Cùng quy ước với RabbitMQ (`rabbitmq/ui/nodes.tsx`) và Redis (`redis/ui/nodes.tsx`):
// viền nét đứt, cách viền một khoảng, màu fuchsia cho highlight từ narrative, tách biệt
// khỏi `ring-2` liền nét cùng tông dùng cho `selected`. `App.test.tsx` tìm node được
// highlight bằng đúng class này nên không được đổi.
const HIGHLIGHT = 'outline-dashed outline-2 outline-offset-4 outline-highlight'

function highlightClass(data: NodeProps['data']): string {
  return data.highlighted ? HIGHLIGHT : ''
}

// blue/teal/orange/pink/lime: năm tông này không trùng bất kỳ tông nào RabbitMQ (sky,
// violet, emerald, amber) hay Redis (cyan, rose, amber, violet) đã dùng, nên năm loại
// node Kafka luôn phân biệt được bằng mắt kể cả khi đứng cạnh node của broker khác trên
// cùng một canvas. fuchsia bị loại vì nó đã là màu highlight dùng chung.
export function BrokerNode({ data, selected }: NodeProps) {
  const offline = Boolean(data.offline)
  const isController = Boolean(data.isController)
  return (
    <div
      className={`${SHELL} border-role-blue-line bg-role-blue ${selected ? 'ring-2 ring-role-blue-ring' : ''} ${
        offline ? 'opacity-40' : ''
      } ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-blue-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-blue-fg/70">
        {offline ? 'offline' : 'online'}
        {isController ? ' · controller' : ''}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function PartitionNode({ data, selected }: NodeProps) {
  const isrCount = Number(data.isrCount)
  const replicaCount = Number(data.replicaCount)
  return (
    <div
      className={`${SHELL} border-role-teal-line bg-role-teal ${
        selected ? 'ring-2 ring-role-teal-ring' : ''
      } ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <span className="max-w-[200px] truncate text-ui font-semibold text-role-teal-fg">{String(data.label)}</span>
        <span className="rounded bg-surface px-1 text-meta text-role-teal-fg">
          ISR {isrCount}/{replicaCount}
        </span>
      </div>
      <div className="font-mono text-meta text-role-teal-fg/70">
        LEO {String(data.leo)} · HW {String(data.highWatermark)}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// Không có `Handle`: consumer group không phải điểm cuối của cạnh nào — cạnh nối thẳng
// partition <-> consumer (xem `toFlow.ts`), node này chỉ là khung chứa trực quan cho các
// consumer con của nó (`parentId`).
export function ConsumerGroupNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-role-orange-line bg-role-orange ${
        selected ? 'ring-2 ring-role-orange-ring' : ''
      } ${highlightClass(data)}`}
      style={{ borderStyle: 'dashed' }}
    >
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-orange-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-orange-fg/70">consumer group</div>
    </div>
  )
}

export function ConsumerNode({ data, selected }: NodeProps) {
  // `joined` phản ánh `state.consumers[id] !== undefined` — trước sự kiện
  // `consumer-join` đầu tiên, consumer chưa có `ConsumerRuntime` nên chưa có gì để tính
  // lag từ đó; hiện "chưa tham gia" trung thực hơn là hiện `lag 0` giả (trông như đã bắt
  // kịp trong khi thực ra chưa từng đọc).
  const joined = Boolean(data.joined)
  return (
    <div
      className={`${SHELL} border-role-pink-line bg-role-pink ${selected ? 'ring-2 ring-role-pink-ring' : ''} ${
        joined ? '' : 'opacity-40'
      } ${highlightClass(data)}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-pink-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-pink-fg/70">
        {joined ? `lag ${String(data.lag)}` : 'chưa tham gia'}
      </div>
    </div>
  )
}

export function ProducerNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`${SHELL} border-role-lime-line bg-role-lime ${
        selected ? 'ring-2 ring-role-lime-ring' : ''
      } ${highlightClass(data)}`}
    >
      <div className="max-w-[200px] truncate text-ui font-semibold text-role-lime-fg">{String(data.label)}</div>
      <div className="font-mono text-meta text-role-lime-fg/70">producer</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
